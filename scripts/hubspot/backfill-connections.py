#!/usr/bin/env python3
"""
Backfill chrt_linkedin_connections for all HubSpot contacts.

Uses the segment-lookup.js Apps Script (which reads kyleConnectDate/hudsonConnectDate
from the Master List) to determine which profiles are connected to each contact,
then patches HubSpot with the multi-select value (e.g. "kyle;hudson").

Usage:
  python3 backfill-connections.py --dry-run   # preview
  python3 backfill-connections.py             # apply
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
import ssl

# ─── Configuration ──────────────────────────────────────────────────────────

SEGMENT_LOOKUP_URL = 'https://script.google.com/macros/s/AKfycbyCSJgwmOIRCVVRnSNlNyhzVXiXChkcvTcN8AyTFMvC0lZggut7CDERUp3n4f_uPi5J/exec'
HS_BASE = 'https://api.hubapi.com'

# ─── Helpers ────────────────────────────────────────────────────────────────

def get_hs_key():
    result = subprocess.run(
        ['doppler', 'secrets', 'get', 'HUBSPOT_CHRT_APP_KEY', '--plain'],
        capture_output=True, text=True
    )
    key = result.stdout.strip()
    if not key:
        print("ERROR: Could not get HUBSPOT_CHRT_APP_KEY from Doppler")
        sys.exit(1)
    return key


def hs_get(path, key):
    url = HS_BASE + path
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {key}')
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def hs_patch(contact_id, properties, key, dry_run=False):
    if dry_run:
        return True
    url = f'{HS_BASE}/crm/v3/objects/contacts/{contact_id}'
    body = json.dumps({'properties': properties}).encode()
    req = urllib.request.Request(url, data=body, method='PATCH')
    req.add_header('Authorization', f'Bearer {key}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"  HubSpot PATCH error for {contact_id}: {e}")
        return False


def fetch_connections(urls):
    """Call segment-lookup.js to get connection data for a batch of URLs."""
    ctx = ssl.create_default_context()
    body = json.dumps({'urls': urls}).encode()
    req = urllib.request.Request(SEGMENT_LOOKUP_URL, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')

    # Follow redirects (Apps Script redirects)
    import http.client
    opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler)

    try:
        with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
            data = json.loads(resp.read().decode())
        if data.get('ok'):
            return data.get('connections', {})
        else:
            print(f"  Segment lookup error: {data.get('error', 'unknown')}")
            return {}
    except Exception as e:
        print(f"  Segment lookup failed: {e}")
        return {}


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv

    print("=" * 60)
    print("Backfill chrt_linkedin_connections")
    print("=" * 60)
    if dry_run:
        print("*** DRY RUN MODE — no changes will be made ***\n")

    key = get_hs_key()

    # 1. Fetch all HubSpot contacts
    print("Fetching HubSpot contacts...")
    props = 'firstname,lastname,hs_linkedin_url,chrt_linkedin_connections,chrt_segment'
    contacts = []
    after = None
    while True:
        path = f'/crm/v3/objects/contacts?limit=100&properties={props}'
        if after:
            path += f'&after={after}'
        data = hs_get(path, key)
        contacts.extend(data.get('results', []))
        after = data.get('paging', {}).get('next', {}).get('after')
        if not after:
            break
    print(f"  Loaded {len(contacts)} contacts")

    # 2. Build URL → contact map
    url_to_contacts = {}  # url → list of (contact_id, name, current_value)
    for c in contacts:
        p = c.get('properties', {})
        url = (p.get('hs_linkedin_url') or '').strip()
        if not url:
            continue
        name = f"{p.get('firstname', '') or ''} {p.get('lastname', '') or ''}".strip()
        current = (p.get('chrt_linkedin_connections') or '').strip()
        segment = (p.get('chrt_segment') or '').strip()
        cid = c['id']
        if url not in url_to_contacts:
            url_to_contacts[url] = []
        url_to_contacts[url].append({'id': cid, 'name': name, 'current': current, 'segment': segment})

    all_urls = list(url_to_contacts.keys())
    print(f"  {len(all_urls)} contacts have LinkedIn URLs")

    # 3. Batch lookup connections from Master List (via segment-lookup.js)
    print("\nFetching connection data from Master List...")
    batch_size = 200
    all_connections = {}
    for i in range(0, len(all_urls), batch_size):
        batch = all_urls[i:i + batch_size]
        print(f"  Batch {i // batch_size + 1}: {len(batch)} URLs...", end=' ')
        conns = fetch_connections(batch)
        all_connections.update(conns)
        print(f"found {len(conns)} with connections")
        if i + batch_size < len(all_urls):
            time.sleep(1)  # rate limit

    print(f"  Total connections found: {len(all_connections)}")

    # 4. Patch HubSpot contacts
    print(f"\n── Backfilling chrt_linkedin_connections ──")
    updated = 0
    already_set = 0
    no_connection = 0
    errors = 0

    for url, contact_list in url_to_contacts.items():
        connected_profiles = all_connections.get(url, [])
        # HubSpot option values are capitalized (Kyle, Hudson)
        capitalized = sorted([p.capitalize() for p in connected_profiles])
        new_value = ';'.join(capitalized) if capitalized else ''

        for contact in contact_list:
            if not new_value:
                no_connection += 1
                continue

            if contact['current'] == new_value:
                already_set += 1
                continue

            prefix = "[DRY RUN] " if dry_run else ""
            print(f"  {prefix}Updated {contact['name']} ({contact['id']}): "
                  f"chrt_linkedin_connections={new_value} (was: '{contact['current']}') "
                  f"[{contact['segment']}]")

            ok = hs_patch(contact['id'], {'chrt_linkedin_connections': new_value}, key, dry_run)
            if ok:
                updated += 1
            else:
                errors += 1

            if not dry_run and updated % 10 == 0:
                time.sleep(0.2)  # rate limit

    # 5. Summary
    print(f"\n  Results:")
    print(f"    Updated: {updated}")
    print(f"    Already set: {already_set}")
    print(f"    No connection data: {no_connection}")
    print(f"    Errors: {errors}")

    # 6. Show courier breakdown
    print(f"\n── Courier Connection Breakdown ──")
    kyle_couriers = []
    hudson_couriers = []
    both_couriers = []
    unmatched_couriers = []

    for url, contact_list in url_to_contacts.items():
        connected = [p.lower() for p in all_connections.get(url, [])]
        for contact in contact_list:
            if contact['segment'] != 'Courier':
                continue
            info = {'name': contact['name'], 'id': contact['id']}
            if 'kyle' in connected and 'hudson' in connected:
                both_couriers.append(info)
            elif 'kyle' in connected:
                kyle_couriers.append(info)
            elif 'hudson' in connected:
                hudson_couriers.append(info)
            else:
                unmatched_couriers.append(info)

    print(f"  Kyle's couriers: {len(kyle_couriers)}")
    for c in kyle_couriers:
        print(f"    {c['name']}")
    print(f"  Hudson's couriers: {len(hudson_couriers)}")
    for c in hudson_couriers:
        print(f"    {c['name']}")
    print(f"  Both connected: {len(both_couriers)}")
    for c in both_couriers:
        print(f"    {c['name']}")
    print(f"  No connection data: {len(unmatched_couriers)}")
    for c in unmatched_couriers:
        print(f"    {c['name']}")

    if dry_run:
        print(f"\n*** DRY RUN — re-run without --dry-run to apply ***")


if __name__ == '__main__':
    main()
