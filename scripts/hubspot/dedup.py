#!/usr/bin/env python3
"""
HubSpot Dedup Script - Find and merge duplicate contacts.

1. Finds duplicates by normalized name AND LinkedIn URL
2. Keeps the contact with the most data (preferring those with email)
3. Merges any unique fields from duplicates into the keeper, then deletes dupes
4. Cross-references HubSpot contacts against the Master List to flag orphans

Usage:
  python3 dedup.py --dry-run       # Preview only
  python3 dedup.py                 # Execute merges + deletes
  python3 dedup.py --audit-only    # Just cross-ref against Master List, no dedup
"""

import json
import re
import subprocess
import sys
import time
import urllib.request


# ─── Config ──────────────────────────────────────────────────────────────────

AUDIT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx4neUEbEYAA3MsY6TX5mxuT2_pMK6I25s5tZL9CKbsRnvF8Y-5RbGRq2FspmtIDgls/exec'

FIELDS = [
    'email', 'jobtitle', 'company', 'industry', 'city', 'state', 'country',
    'hs_linkedin_url', 'phone', 'website',
    'linkedin_headline', 'school_name', 'school_degree',
    'previous_company_name', 'previous_company_position', 'job_location',
    'linkedin_company_slug',
]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def get_key():
    result = subprocess.run(
        ['doppler', 'secrets', 'get', 'HUBSPOT_CHRT_APP_KEY', '--plain'],
        capture_output=True, text=True, timeout=30
    )
    return result.stdout.strip()


def hs_request(method, path, key, body=None):
    url = f"https://api.hubapi.com{path}"
    headers = {'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
    data = json.dumps(body).encode('utf-8') if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            bd = resp.read().decode()
            if not bd:
                return {'ok': True}
            return json.loads(bd)
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  API error {e.code}: {err[:200]}")
        return None


def normalize_name(name):
    """Normalize a name for matching (word-boundary-safe suffix removal)."""
    name = name.lower().strip()
    name = re.sub(r'\([^)]*\)', '', name)
    name = re.sub(r'[®™]', '', name)
    name = re.sub(
        r'[,\s]+\b(mba|phd|md|rn|bsn|cptc|lssbb|mha|fache|pmp|cmrp|ctbs|dlm|'
        r'ascp|cm|ms|cls|mt|mls|sbb|rrt|lssgb|bs|jr|sr|iii|ii|do|ma|mpa|msscm|'
        r'cscp|cpm|csp|cpim|lcsw|cltd|ciiscm|msyl|gms-t|crp|cftco)\b[,\s]*',
        ' ', name, flags=re.IGNORECASE
    )
    return ' '.join(name.split()).strip()


def normalize_url(url):
    """Normalize a LinkedIn URL for comparison."""
    url = (url or '').strip().lower().rstrip('/')
    # Strip query params and trailing slashes
    url = url.split('?')[0].rstrip('/')
    return url


def score(c):
    """Score a contact by data completeness (higher = more complete)."""
    p = c.get('properties', {})
    filled = sum(1 for f in FIELDS if (p.get(f) or '').strip())
    has_email = 1 if (p.get('email') or '').strip() else 0
    has_linkedin = 1 if (p.get('hs_linkedin_url') or '').strip() else 0
    return (has_email, has_linkedin, filled)


# ─── Data Loading ────────────────────────────────────────────────────────────

def load_contacts(key):
    """Fetch all HubSpot contacts."""
    props = ','.join(['firstname', 'lastname', 'createdate', 'hs_lead_status'] + FIELDS)
    contacts = []
    after = None
    while True:
        path = f'/crm/v3/objects/contacts?limit=100&properties={props}'
        if after:
            path += f'&after={after}'
        data = hs_request('GET', path, key)
        if not data:
            break
        contacts.extend(data.get('results', []))
        after = data.get('paging', {}).get('next', {}).get('after')
        if not after:
            break
    return contacts


def load_master_list():
    """Fetch connected profiles from audit Apps Script."""
    print("Fetching Master List from audit script...")
    url = AUDIT_SCRIPT_URL + '?includeAll=true'
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
        synced = data.get('syncedProfiles', [])
        unsynced = data.get('unsyncedProfiles', [])
        print(f"  Master List: {len(synced)} synced + {len(unsynced)} unsynced = {len(synced) + len(unsynced)} total")
        return synced + unsynced
    except Exception as e:
        print(f"  ERROR: {e}")
        return []


# ─── Dedup Logic ─────────────────────────────────────────────────────────────

def find_duplicates(contacts):
    """Find duplicate groups by normalized name and LinkedIn URL."""

    # Group by normalized name
    by_name = {}
    for c in contacts:
        p = c.get('properties', {})
        fn = (p.get('firstname') or '').strip()
        ln = (p.get('lastname') or '').strip()
        name = f'{fn} {ln}'.strip()
        norm = normalize_name(name)
        if norm and len(norm) > 2:  # Skip very short names
            by_name.setdefault(norm, []).append(c)

    # Group by LinkedIn URL
    by_url = {}
    for c in contacts:
        p = c.get('properties', {})
        url = normalize_url(p.get('hs_linkedin_url'))
        if url:
            by_url.setdefault(url, []).append(c)

    # Merge duplicate groups: union-find approach
    # Map each contact ID to its duplicate group
    contact_to_group = {}
    group_counter = 0

    def get_group(cid):
        if cid not in contact_to_group:
            nonlocal group_counter
            contact_to_group[cid] = group_counter
            group_counter += 1
        return contact_to_group[cid]

    def merge_groups(cids):
        if len(cids) <= 1:
            return
        groups = [get_group(cid) for cid in cids]
        target = min(groups)
        for cid in list(contact_to_group.keys()):
            if contact_to_group[cid] in groups:
                contact_to_group[cid] = target
        for cid in cids:
            contact_to_group[cid] = target

    # Merge by name
    for norm, group in by_name.items():
        if len(group) > 1:
            merge_groups([c['id'] for c in group])

    # Merge by URL
    for url, group in by_url.items():
        if len(group) > 1:
            merge_groups([c['id'] for c in group])

    # Build final groups
    contacts_by_id = {c['id']: c for c in contacts}
    final_groups = {}
    for cid, gid in contact_to_group.items():
        final_groups.setdefault(gid, []).append(contacts_by_id[cid])

    # Only return groups with 2+ contacts
    return {gid: group for gid, group in final_groups.items() if len(group) > 1}


def process_duplicates(dupes, key, dry_run):
    """Merge and delete duplicate contacts."""
    total_deleted = 0
    total_merged = 0

    for gid, group in sorted(dupes.items()):
        # Sort: best contact first
        group.sort(key=lambda c: (score(c), -int(c['id'])), reverse=True)
        keeper = group[0]
        to_delete = group[1:]

        keeper_props = keeper.get('properties', {})
        keeper_name = f"{(keeper_props.get('firstname') or '')} {(keeper_props.get('lastname') or '')}".strip()

        print(f"=== {keeper_name} ({len(group)} contacts) ===")
        print(f"  Keep: ID {keeper['id']} | score {score(keeper)} | email: {(keeper_props.get('email') or 'none')[:30]} | url: {(keeper_props.get('hs_linkedin_url') or 'none')[:50]}")
        for dup in to_delete:
            dp = dup.get('properties', {})
            dn = f"{(dp.get('firstname') or '')} {(dp.get('lastname') or '')}".strip()
            print(f"  Delete: ID {dup['id']} | score {score(dup)} | email: {(dp.get('email') or 'none')[:30]} | url: {(dp.get('hs_linkedin_url') or 'none')[:50]} | name: {dn}")

        # Merge: fill empty keeper fields from duplicates
        merge_updates = {}
        for dup in to_delete:
            dp = dup.get('properties', {})
            for f in FIELDS:
                if not (keeper_props.get(f) or '').strip() and (dp.get(f) or '').strip() and f not in merge_updates:
                    merge_updates[f] = dp[f].strip()

        if merge_updates:
            total_merged += 1
            if dry_run:
                print(f"  [DRY RUN] Would merge: {list(merge_updates.keys())}")
            else:
                result = hs_request('PATCH', f"/crm/v3/objects/contacts/{keeper['id']}", key, {'properties': merge_updates})
                if result:
                    print(f"  Merged: {list(merge_updates.keys())}")
                time.sleep(0.15)

        # Delete duplicates
        for dup in to_delete:
            total_deleted += 1
            if dry_run:
                print(f"  [DRY RUN] Would delete {dup['id']}")
            else:
                result = hs_request('DELETE', f"/crm/v3/objects/contacts/{dup['id']}", key)
                if result:
                    print(f"  Deleted {dup['id']}")
                time.sleep(0.15)

        print()

    return total_merged, total_deleted


# ─── Master List Cross-Reference ────────────────────────────────────────────

def cross_reference(contacts, master_profiles):
    """Compare HubSpot contacts against Master List."""

    # Build Master List lookups
    master_by_name = {}
    master_by_url = {}
    for p in master_profiles:
        name = (p.get('fullName') or '').strip()
        norm = normalize_name(name)
        if norm:
            master_by_name[norm] = p
        url = normalize_url(p.get('defaultProfileUrl'))
        if url:
            master_by_url[url] = p

    # Check each HubSpot contact
    in_master = []
    not_in_master = []

    for c in contacts:
        p = c.get('properties', {})
        fn = (p.get('firstname') or '').strip()
        ln = (p.get('lastname') or '').strip()
        name = f"{fn} {ln}".strip()
        norm = normalize_name(name)
        url = normalize_url(p.get('hs_linkedin_url'))
        status = (p.get('hs_lead_status') or '').strip()

        matched = norm in master_by_name or url in master_by_url

        if matched:
            in_master.append(c)
        else:
            not_in_master.append(c)

    print(f"\n{'='*60}")
    print("MASTER LIST CROSS-REFERENCE")
    print(f"{'='*60}")
    print(f"  HubSpot contacts: {len(contacts)}")
    print(f"  Master List profiles: {len(master_profiles)}")
    print(f"  In both: {len(in_master)}")
    print(f"  HubSpot only (not in Master List): {len(not_in_master)}")

    if not_in_master:
        print(f"\n  --- HubSpot contacts NOT in Master List ({len(not_in_master)}) ---")
        for c in not_in_master:
            p = c.get('properties', {})
            fn = (p.get('firstname') or '').strip()
            ln = (p.get('lastname') or '').strip()
            co = (p.get('company') or '').strip()
            status = (p.get('hs_lead_status') or '').strip()
            url = (p.get('hs_linkedin_url') or '').strip()
            print(f"  {fn + ' ' + ln:35s} | {co:30s} | {status:15s} | {url[:50]}")

    # Check Master List profiles not in HubSpot
    hs_by_name = set()
    hs_by_url = set()
    for c in contacts:
        p = c.get('properties', {})
        fn = (p.get('firstname') or '').strip()
        ln = (p.get('lastname') or '').strip()
        norm = normalize_name(f"{fn} {ln}".strip())
        if norm:
            hs_by_name.add(norm)
        url = normalize_url(p.get('hs_linkedin_url'))
        if url:
            hs_by_url.add(url)

    master_not_in_hs = []
    for p in master_profiles:
        name = (p.get('fullName') or '').strip()
        norm = normalize_name(name)
        url = normalize_url(p.get('defaultProfileUrl'))
        if norm not in hs_by_name and url not in hs_by_url:
            master_not_in_hs.append(p)

    if master_not_in_hs:
        print(f"\n  --- Master List profiles NOT in HubSpot ({len(master_not_in_hs)}) ---")
        for p in master_not_in_hs[:30]:
            name = (p.get('fullName') or '').strip()
            co = (p.get('company') or '').strip()
            url = (p.get('defaultProfileUrl') or '').strip()
            print(f"  {name:35s} | {co:30s} | {url[:50]}")
        if len(master_not_in_hs) > 30:
            print(f"  ... and {len(master_not_in_hs) - 30} more")

    return not_in_master, master_not_in_hs


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv
    audit_only = '--audit-only' in sys.argv

    key = get_key()

    if dry_run:
        print("*** DRY RUN — no changes will be made ***\n")

    # Load data
    print("Fetching HubSpot contacts...")
    contacts = load_contacts(key)
    print(f"  Total contacts: {len(contacts)}\n")

    master_profiles = load_master_list()

    if not audit_only:
        # Step 1: Find and process duplicates
        print(f"\n{'='*60}")
        print("DEDUP")
        print(f"{'='*60}")
        dupes = find_duplicates(contacts)
        print(f"  Duplicate groups found: {len(dupes)}\n")

        if dupes:
            merged, deleted = process_duplicates(dupes, key, dry_run)
            print(f"Summary: Merged data into {merged} keepers. Deleted {deleted} duplicates.")
            if not dry_run:
                # Reload contacts after dedup
                print("\nReloading contacts after dedup...")
                contacts = load_contacts(key)
                print(f"  Total contacts after dedup: {len(contacts)}")
        else:
            print("  No duplicates found!\n")

    # Step 2: Cross-reference with Master List
    not_in_master, master_not_in_hs = cross_reference(contacts, master_profiles)

    if dry_run:
        print("\n*** DRY RUN — re-run without --dry-run to apply dedup ***")


if __name__ == '__main__':
    main()
