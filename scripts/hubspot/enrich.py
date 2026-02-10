#!/usr/bin/env python3
"""
HubSpot Enrichment Script

Enriches all CONNECTED HubSpot contacts with data from:
1. Master List (via audit Apps Script) - jobtitle, company, industry, location, linkedin URL
2. Profile Scraper CSV - professional email, detailed company/industry data
3. Creates new contacts for unsynced connected profiles
4. Identifies profiles needing profile scraper run

Usage:
  # Dry run (no changes):
  python3 hubspot-enrich.py --dry-run

  # Full run:
  python3 hubspot-enrich.py

  # Also launch profile scraper for profiles missing email:
  python3 hubspot-enrich.py --launch-scraper

  # Clean up sample/test contacts:
  python3 hubspot-enrich.py --cleanup
"""

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from collections import defaultdict

# ─── Configuration ──────────────────────────────────────────────────────────

AUDIT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx4neUEbEYAA3MsY6TX5mxuT2_pMK6I25s5tZL9CKbsRnvF8Y-5RbGRq2FspmtIDgls/exec'
PROFILE_SCRAPER_CSV = os.path.expanduser('~/Downloads/result (3).csv')
HOLDING_SHEET_ID = '1xPgob7BwDoDGAOtDPBTvKzhQHl2FUZkJhJG0gEHWdgo'
PB_SCRAPER_AGENT_ID = '3627182471241497'

SAMPLE_CONTACT_IDS = ['349443912391', '349444344526']  # HubSpot sample contacts
TEST_CONTACT_IDS = ['401413975786']  # Test contacts

# HubSpot property mapping from Master List fields
MASTER_LIST_TO_HS = {
    'jobTitle': 'jobtitle',
    'company': 'company',
    'industry': 'industry',         # Master List 'industry' field
    'defaultProfileUrl': 'hs_linkedin_url',
}

# Valid HubSpot industry enum values (complete list)
HUBSPOT_INDUSTRY_ENUMS = [
    'ACCOUNTING', 'AIRLINES_AVIATION', 'ALTERNATIVE_DISPUTE_RESOLUTION', 'ALTERNATIVE_MEDICINE',
    'ANIMATION', 'APPAREL_FASHION', 'ARCHITECTURE_PLANNING', 'ARTS_AND_CRAFTS', 'AUTOMOTIVE',
    'AVIATION_AEROSPACE', 'BANKING', 'BIOTECHNOLOGY', 'BROADCAST_MEDIA', 'BUILDING_MATERIALS',
    'BUSINESS_SUPPLIES_AND_EQUIPMENT', 'CAPITAL_MARKETS', 'CHEMICALS', 'CIVIC_SOCIAL_ORGANIZATION',
    'CIVIL_ENGINEERING', 'COMMERCIAL_REAL_ESTATE', 'COMPUTER_NETWORK_SECURITY', 'COMPUTER_GAMES',
    'COMPUTER_HARDWARE', 'COMPUTER_NETWORKING', 'COMPUTER_SOFTWARE', 'INTERNET', 'CONSTRUCTION',
    'CONSUMER_ELECTRONICS', 'CONSUMER_GOODS', 'CONSUMER_SERVICES', 'COSMETICS', 'DAIRY',
    'DEFENSE_SPACE', 'DESIGN', 'EDUCATION_MANAGEMENT', 'E_LEARNING',
    'ELECTRICAL_ELECTRONIC_MANUFACTURING', 'ENTERTAINMENT', 'ENVIRONMENTAL_SERVICES',
    'EVENTS_SERVICES', 'EXECUTIVE_OFFICE', 'FACILITIES_SERVICES', 'FARMING', 'FINANCIAL_SERVICES',
    'FINE_ART', 'FISHERY', 'FOOD_BEVERAGES', 'FOOD_PRODUCTION', 'FUND_RAISING', 'FURNITURE',
    'GAMBLING_CASINOS', 'GLASS_CERAMICS_CONCRETE', 'GOVERNMENT_ADMINISTRATION',
    'GOVERNMENT_RELATIONS', 'GRAPHIC_DESIGN', 'HEALTH_WELLNESS_AND_FITNESS', 'HIGHER_EDUCATION',
    'HOSPITAL_HEALTH_CARE', 'HOSPITALITY', 'HUMAN_RESOURCES', 'IMPORT_AND_EXPORT',
    'INDIVIDUAL_FAMILY_SERVICES', 'INDUSTRIAL_AUTOMATION', 'INFORMATION_SERVICES',
    'INFORMATION_TECHNOLOGY_AND_SERVICES', 'INSURANCE', 'INTERNATIONAL_AFFAIRS',
    'INTERNATIONAL_TRADE_AND_DEVELOPMENT', 'INVESTMENT_BANKING', 'INVESTMENT_MANAGEMENT',
    'JUDICIARY', 'LAW_ENFORCEMENT', 'LAW_PRACTICE', 'LEGAL_SERVICES', 'LEGISLATIVE_OFFICE',
    'LEISURE_TRAVEL_TOURISM', 'LIBRARIES', 'LOGISTICS_AND_SUPPLY_CHAIN',
    'LUXURY_GOODS_JEWELRY', 'MACHINERY', 'MANAGEMENT_CONSULTING', 'MARITIME', 'MARKET_RESEARCH',
    'MARKETING_AND_ADVERTISING', 'MECHANICAL_OR_INDUSTRIAL_ENGINEERING', 'MEDIA_PRODUCTION',
    'MEDICAL_DEVICES', 'MEDICAL_PRACTICE', 'MENTAL_HEALTH_CARE', 'MILITARY', 'MINING_METALS',
    'MOTION_PICTURES_AND_FILM', 'MUSEUMS_AND_INSTITUTIONS', 'MUSIC', 'NANOTECHNOLOGY',
    'NEWSPAPERS', 'NON_PROFIT_ORGANIZATION_MANAGEMENT', 'OIL_ENERGY', 'ONLINE_MEDIA',
    'OUTSOURCING_OFFSHORING', 'PACKAGE_FREIGHT_DELIVERY', 'PACKAGING_AND_CONTAINERS',
    'PAPER_FOREST_PRODUCTS', 'PERFORMING_ARTS', 'PHARMACEUTICALS', 'PHILANTHROPY', 'PHOTOGRAPHY',
    'PLASTICS', 'POLITICAL_ORGANIZATION', 'PRIMARY_SECONDARY_EDUCATION', 'PRINTING',
    'PROFESSIONAL_TRAINING_COACHING', 'PROGRAM_DEVELOPMENT', 'PUBLIC_POLICY',
    'PUBLIC_RELATIONS_AND_COMMUNICATIONS', 'PUBLIC_SAFETY', 'PUBLISHING', 'RAILROAD_MANUFACTURE',
    'RANCHING', 'REAL_ESTATE', 'RECREATIONAL_FACILITIES_AND_SERVICES', 'RELIGIOUS_INSTITUTIONS',
    'RENEWABLES_ENVIRONMENT', 'RESEARCH', 'RESTAURANTS', 'RETAIL', 'SECURITY_AND_INVESTIGATIONS',
    'SEMICONDUCTORS', 'SHIPBUILDING', 'SPORTING_GOODS', 'SPORTS', 'STAFFING_AND_RECRUITING',
    'SUPERMARKETS', 'TELECOMMUNICATIONS', 'TEXTILES', 'THINK_TANKS', 'TOBACCO',
    'TRANSLATION_AND_LOCALIZATION', 'TRANSPORTATION_TRUCKING_RAILROAD', 'UTILITIES',
    'VENTURE_CAPITAL_PRIVATE_EQUITY', 'VETERINARY', 'WAREHOUSING', 'WHOLESALE',
    'WINE_AND_SPIRITS', 'WIRELESS', 'WRITING_AND_EDITING', 'MOBILE_GAMES',
]
HUBSPOT_INDUSTRY_SET = set(HUBSPOT_INDUSTRY_ENUMS)

# Cache file for AI-mapped industry values (avoids repeat API calls)
INDUSTRY_CACHE_FILE = os.path.join(os.path.dirname(__file__), 'industry-map-cache.json')


def _load_industry_cache():
    """Load cached industry mappings from disk."""
    if os.path.exists(INDUSTRY_CACHE_FILE):
        with open(INDUSTRY_CACHE_FILE, 'r') as f:
            return json.loads(f.read())
    return {}


def _save_industry_cache(cache):
    """Save industry cache to disk."""
    with open(INDUSTRY_CACHE_FILE, 'w') as f:
        json.dump(cache, f, indent=2, sort_keys=True)


def _get_anthropic_key():
    """Fetch Anthropic API key from Doppler."""
    try:
        result = subprocess.run(
            ['doppler', 'secrets', 'get', 'ANTHROPIC_API_KEY', '--plain'],
            capture_output=True, text=True, timeout=30
        )
        return result.stdout.strip()
    except Exception:
        return ''


def _ai_map_industries(raw_values):
    """Use Claude to map a batch of LinkedIn industry values to HubSpot enums.

    Args:
        raw_values: list of unique raw industry strings to map

    Returns:
        dict mapping raw_value → HubSpot enum string
    """
    if not raw_values:
        return {}

    api_key = _get_anthropic_key()
    if not api_key:
        print("  WARNING: No ANTHROPIC_API_KEY — falling back to best-guess mapping")
        return {}

    enum_list = ', '.join(HUBSPOT_INDUSTRY_ENUMS)
    industries_list = '\n'.join(f'  {i+1}. "{v}"' for i, v in enumerate(raw_values))

    prompt = f"""Map each LinkedIn industry value to the single closest HubSpot industry enum.

VALID HUBSPOT ENUMS:
{enum_list}

LINKEDIN INDUSTRIES TO MAP:
{industries_list}

Return ONLY a JSON object mapping each input string to its HubSpot enum. Use exact enum values only.
Example: {{"Hospital & Health Care": "HOSPITAL_HEALTH_CARE", "Airlines/Aviation": "AIRLINES_AVIATION"}}

If no good match exists, use the closest reasonable one. Every input MUST have a mapping."""

    payload = {
        'model': 'claude-sonnet-4-20250514',
        'max_tokens': 2048,
        'messages': [{'role': 'user', 'content': prompt}],
    }

    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=data,
        headers={
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode())
            text = result['content'][0]['text']
            # Extract JSON from response (handle markdown code blocks)
            if '```' in text:
                text = text.split('```')[1]
                if text.startswith('json'):
                    text = text[4:]
                text = text.strip()
            mapping = json.loads(text)
            # Validate all values are real enums
            validated = {}
            for k, v in mapping.items():
                if v in HUBSPOT_INDUSTRY_SET:
                    validated[k] = v
                else:
                    print(f"  WARNING: Claude returned invalid enum '{v}' for '{k}' — skipping")
            return validated
    except Exception as e:
        print(f"  ERROR calling Claude for industry mapping: {e}")
        return {}


def map_industry(raw_industry, _cache={}):
    """Map a LinkedIn/free-text industry value to a HubSpot enum value.

    Uses a local cache + AI mapping for unknown values.
    Call resolve_industry_cache() first to batch-resolve all unknowns via one API call.
    """
    if not raw_industry:
        return ''
    # Already a valid HubSpot enum?
    if raw_industry in HUBSPOT_INDUSTRY_SET:
        return raw_industry
    # Check in-memory cache (populated by resolve_industry_cache)
    if raw_industry in _cache:
        return _cache[raw_industry]
    # Return empty — caller should have called resolve_industry_cache() first
    return ''


def resolve_industry_cache(raw_values):
    """Batch-resolve all unique industry values: load cache, call AI for unknowns, save cache.

    Call this once before using map_industry() so all values are pre-resolved.
    """
    if not raw_values:
        return

    cache = _load_industry_cache()
    unique = set(v for v in raw_values if v and v not in HUBSPOT_INDUSTRY_SET)
    uncached = [v for v in unique if v not in cache]

    print(f"  Industry mapping: {len(unique)} unique values, {len(unique) - len(uncached)} cached, {len(uncached)} need AI mapping")

    if uncached:
        # Batch in groups of 50 to stay within context limits
        for i in range(0, len(uncached), 50):
            batch = uncached[i:i+50]
            print(f"  Calling Claude to map {len(batch)} industry values...")
            ai_results = _ai_map_industries(batch)
            cache.update(ai_results)
            # For any that Claude didn't map, leave them out
            unmapped = [v for v in batch if v not in ai_results]
            if unmapped:
                print(f"  WARNING: {len(unmapped)} values unmapped: {unmapped[:5]}")

        _save_industry_cache(cache)
        print(f"  Cache saved ({len(cache)} total entries)")

    # Populate map_industry's in-memory cache
    map_industry.__defaults__[0].update(cache)


# ─── Helpers ────────────────────────────────────────────────────────────────

def get_hubspot_key():
    """Fetch HubSpot API key from Doppler."""
    try:
        result = subprocess.run(
            ['doppler', 'secrets', 'get', 'HUBSPOT_CHRT_APP_KEY', '--plain'],
            capture_output=True, text=True, timeout=30
        )
        key = result.stdout.strip()
        if not key:
            print("ERROR: Could not fetch HUBSPOT_CHRT_APP_KEY from Doppler")
            sys.exit(1)
        return key
    except Exception as e:
        print(f"ERROR fetching Doppler key: {e}")
        sys.exit(1)


def hs_request(method, path, key, body=None):
    """Make a HubSpot API request."""
    url = f"https://api.hubapi.com{path}"
    headers = {
        'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
    }
    data = json.dumps(body).encode('utf-8') if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode()
            if not body:
                return {'ok': True, 'status': resp.status}
            return json.loads(body)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"  HubSpot API error {e.code}: {error_body[:200]}")
        return None


def normalize_name(name):
    """Normalize a name for matching."""
    name = name.lower().strip()
    # Remove parenthetical text first (e.g. "(Hess)")
    name = re.sub(r'\([^)]*\)', '', name)
    name = re.sub(r'[®™]', '', name)
    # Strip title suffixes only when they appear as whole words (word boundaries)
    name = re.sub(r'[,\s]+\b(mba|phd|md|rn|bsn|cptc|lssbb|mha|fache|pmp|cmrp|ctbs|dlm|ascp|cm|ms|cls|mt|mls|sbb|rrt|lssgb|bs|jr|sr|iii|ii|do|ma|mpa|msscm|cscp|cpm|csp|cpim)\b[,\s]*', ' ', name, flags=re.IGNORECASE)
    name = ' '.join(name.split()).strip()
    return name


def parse_location(location_str):
    """Parse location string into city, state, country."""
    if not location_str:
        return '', '', ''
    parts = [p.strip() for p in location_str.split(',')]
    if len(parts) >= 3:
        return parts[0], parts[-2], parts[-1]
    elif len(parts) == 2:
        return parts[0], parts[1], ''
    else:
        return location_str, '', ''


# ─── Data Loading ───────────────────────────────────────────────────────────

def load_hubspot_contacts(key):
    """Fetch all HubSpot contacts with relevant properties."""
    print("Fetching all HubSpot contacts...")
    props = ('firstname,lastname,email,jobtitle,company,industry,city,state,country,'
             'hs_linkedin_url,hs_lead_status,phone,website,'
             'linkedin_headline,school_name,school_degree,'
             'previous_company_name,previous_company_position,job_location,linkedin_company_slug')
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

    print(f"  Loaded {len(contacts)} HubSpot contacts")
    return contacts


def load_audit_data():
    """Fetch connected profiles from audit Apps Script."""
    print("Fetching Master List data from audit script (includeAll)...")
    url = AUDIT_SCRIPT_URL + '?includeAll=true'
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
        synced = data.get('syncedProfiles', [])
        unsynced = data.get('unsyncedProfiles', [])
        print(f"  Loaded {len(synced)} synced + {len(unsynced)} unsynced = {len(synced) + len(unsynced)} connected profiles")
        return synced, unsynced
    except Exception as e:
        print(f"  ERROR: {e}")
        return [], []


def load_scraper_csv():
    """Load profile scraper CSV results."""
    if not os.path.exists(PROFILE_SCRAPER_CSV):
        print(f"  WARNING: Profile scraper CSV not found at {PROFILE_SCRAPER_CSV}")
        return []

    print(f"Loading profile scraper CSV from {PROFILE_SCRAPER_CSV}...")
    profiles = []
    with open(PROFILE_SCRAPER_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            profiles.append(row)
    print(f"  Loaded {len(profiles)} profile scraper results")
    return profiles


# ─── Enrichment Logic ───────────────────────────────────────────────────────

def build_scraper_lookup(scraper_profiles):
    """Build lookup by normalized name AND LinkedIn URL from profile scraper CSV."""
    by_name = {}
    by_url = {}
    for p in scraper_profiles:
        name = f"{p.get('firstName', '')} {p.get('lastName', '')}".strip()
        norm = normalize_name(name)
        if norm and norm not in by_name:
            by_name[norm] = p
        # Also index by LinkedIn URL for cross-referencing
        url = (p.get('linkedinProfileUrl') or '').strip().lower().rstrip('/')
        if url:
            by_url[url] = p
    return by_name, by_url


def build_master_lookup(synced, unsynced):
    """Build lookup by normalized name from Master List profiles."""
    lookup = {}
    for p in synced + unsynced:
        name = (p.get('fullName') or '').strip()
        norm = normalize_name(name)
        if norm and norm not in lookup:
            lookup[norm] = p
    return lookup


def compute_updates(hs_contact, master_profile, scraper_profile):
    """Compute HubSpot property updates from available data sources."""
    props = hs_contact.get('properties', {})
    updates = {}

    # From Master List
    if master_profile:
        # Job Title
        if not (props.get('jobtitle') or '').strip() and master_profile.get('jobTitle', '').strip():
            updates['jobtitle'] = master_profile['jobTitle'].strip()

        # Company
        if not (props.get('company') or '').strip() and master_profile.get('company', '').strip():
            updates['company'] = master_profile['company'].strip()

        # Industry (use adjIndustry if available, else industry) → map to HubSpot enum
        if not (props.get('industry') or '').strip():
            ind = (master_profile.get('adjIndustry') or master_profile.get('industry') or '').strip()
            if ind:
                updates['industry'] = map_industry(ind)

        # LinkedIn URL
        if not (props.get('hs_linkedin_url') or '').strip() and master_profile.get('defaultProfileUrl', '').strip():
            updates['hs_linkedin_url'] = master_profile['defaultProfileUrl'].strip()

        # Location parsing (state, country from Master List location)
        location = master_profile.get('bestLocation') or master_profile.get('location') or ''
        if location:
            city, state, country = parse_location(location)
            if not (props.get('state') or '').strip() and state:
                updates['state'] = state
            if not (props.get('country') or '').strip() and country:
                updates['country'] = country
            # Update city if it was set to the full location string
            if not (props.get('city') or '').strip() and city:
                updates['city'] = city

    # From Profile Scraper CSV (higher priority for some fields)
    if scraper_profile:
        # Professional email (gold!)
        email = (scraper_profile.get('professionalEmail') or '').strip()
        if email and not (props.get('email') or '').strip():
            updates['email'] = email

        # Job title from scraper (more detailed)
        scraper_title = (scraper_profile.get('linkedinJobTitle') or '').strip()
        if scraper_title and not (props.get('jobtitle') or '').strip() and 'jobtitle' not in updates:
            updates['jobtitle'] = scraper_title

        # Company from scraper
        scraper_company = (scraper_profile.get('companyName') or '').strip()
        if scraper_company and not (props.get('company') or '').strip() and 'company' not in updates:
            updates['company'] = scraper_company

        # Industry from scraper (more detailed) → map to HubSpot enum
        scraper_industry = (scraper_profile.get('companyIndustry') or '').strip()
        if scraper_industry and not (props.get('industry') or '').strip() and 'industry' not in updates:
            updates['industry'] = map_industry(scraper_industry)

        # LinkedIn URL from scraper
        scraper_url = (scraper_profile.get('linkedinProfileUrl') or '').strip()
        if scraper_url and not (props.get('hs_linkedin_url') or '').strip() and 'hs_linkedin_url' not in updates:
            updates['hs_linkedin_url'] = scraper_url

        # Location from scraper
        scraper_loc = (scraper_profile.get('location') or '').strip()
        if scraper_loc:
            city, state, country = parse_location(scraper_loc)
            if not (props.get('state') or '').strip() and state and 'state' not in updates:
                updates['state'] = state
            if not (props.get('country') or '').strip() and country and 'country' not in updates:
                updates['country'] = country

        # ── New enrichment fields from profile scraper ──

        # LinkedIn headline
        headline = (scraper_profile.get('linkedinHeadline') or '').strip()
        if headline and not (props.get('linkedin_headline') or '').strip():
            updates['linkedin_headline'] = headline

        # School
        school = (scraper_profile.get('linkedinSchoolName') or '').strip()
        if school and not (props.get('school_name') or '').strip():
            updates['school_name'] = school

        # School degree
        degree = (scraper_profile.get('linkedinSchoolDegree') or '').strip()
        if degree and not (props.get('school_degree') or '').strip():
            updates['school_degree'] = degree

        # Previous company
        prev_company = (scraper_profile.get('previousCompanyName') or '').strip()
        if prev_company and not (props.get('previous_company_name') or '').strip():
            updates['previous_company_name'] = prev_company

        # Previous position
        prev_position = (scraper_profile.get('linkedinPreviousJobTitle') or '').strip()
        if prev_position and not (props.get('previous_company_position') or '').strip():
            updates['previous_company_position'] = prev_position

        # Job location
        job_loc = (scraper_profile.get('linkedinJobLocation') or '').strip()
        if job_loc and not (props.get('job_location') or '').strip():
            updates['job_location'] = job_loc

        # LinkedIn company slug
        slug = (scraper_profile.get('linkedinCompanySlug') or '').strip()
        if slug and not (props.get('linkedin_company_slug') or '').strip():
            updates['linkedin_company_slug'] = slug

    return updates


def create_contact_payload(master_profile, scraper_profile):
    """Build a new contact payload from Master List + optional scraper data."""
    # Parse name
    full_name = master_profile.get('fullName', '')
    first_name = master_profile.get('firstName', '')
    last_name = master_profile.get('lastName', '')
    if not first_name and full_name:
        parts = full_name.split(' ', 1)
        first_name = parts[0]
        last_name = parts[1] if len(parts) > 1 else ''

    location = master_profile.get('bestLocation') or master_profile.get('location') or ''
    city, state, country = parse_location(location)
    raw_industry = (master_profile.get('adjIndustry') or master_profile.get('industry') or '').strip()

    payload = {
        'firstname': first_name,
        'lastname': last_name,
        'jobtitle': master_profile.get('jobTitle', ''),
        'company': master_profile.get('company', ''),
        'industry': map_industry(raw_industry),
        'city': city or location,
        'state': state,
        'country': country,
        'hs_lead_status': 'CONNECTED',
        'hs_linkedin_url': master_profile.get('defaultProfileUrl', ''),
    }

    # Add email and enrichment fields from scraper if available
    if scraper_profile:
        email = (scraper_profile.get('professionalEmail') or '').strip()
        if email:
            payload['email'] = email

        # New enrichment fields
        headline = (scraper_profile.get('linkedinHeadline') or '').strip()
        if headline:
            payload['linkedin_headline'] = headline

        school = (scraper_profile.get('linkedinSchoolName') or '').strip()
        if school:
            payload['school_name'] = school

        degree = (scraper_profile.get('linkedinSchoolDegree') or '').strip()
        if degree:
            payload['school_degree'] = degree

        prev_company = (scraper_profile.get('previousCompanyName') or '').strip()
        if prev_company:
            payload['previous_company_name'] = prev_company

        prev_position = (scraper_profile.get('linkedinPreviousJobTitle') or '').strip()
        if prev_position:
            payload['previous_company_position'] = prev_position

        job_loc = (scraper_profile.get('linkedinJobLocation') or '').strip()
        if job_loc:
            payload['job_location'] = job_loc

        slug = (scraper_profile.get('linkedinCompanySlug') or '').strip()
        if slug:
            payload['linkedin_company_slug'] = slug

    # Remove empty values
    return {k: v for k, v in payload.items() if v}


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='HubSpot Enrichment Script')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without applying')
    parser.add_argument('--cleanup', action='store_true', help='Remove sample/test contacts')
    parser.add_argument('--launch-scraper', action='store_true', help='Launch profile scraper for profiles missing email')
    parser.add_argument('--fix-industry', action='store_true', help='Fix industry values: map raw LinkedIn to HubSpot enum')
    args = parser.parse_args()

    print("=" * 60)
    print("HubSpot Enrichment Script")
    print("=" * 60)
    if args.dry_run:
        print("*** DRY RUN MODE — no changes will be made ***\n")

    # 1. Load all data
    hs_key = get_hubspot_key()
    hs_contacts = load_hubspot_contacts(hs_key)
    synced_profiles, unsynced_profiles = load_audit_data()
    scraper_profiles = load_scraper_csv()

    # 2. Build lookups
    master_lookup = build_master_lookup(synced_profiles, unsynced_profiles)
    scraper_by_name, scraper_by_url = build_scraper_lookup(scraper_profiles)

    print(f"\nLookup sizes: Master={len(master_lookup)}, Scraper(name)={len(scraper_by_name)}, Scraper(url)={len(scraper_by_url)}")

    # Pre-resolve all industry values via AI (one batched call, cached on disk)
    all_raw_industries = set()
    for c in hs_contacts:
        ind = (c.get('properties', {}).get('industry') or '').strip()
        if ind:
            all_raw_industries.add(ind)
    for p in synced_profiles + unsynced_profiles:
        for key in ('adjIndustry', 'industry'):
            ind = (p.get(key) or '').strip()
            if ind:
                all_raw_industries.add(ind)
    for sp in scraper_profiles:
        ind = (sp.get('companyIndustry') or '').strip()
        if ind:
            all_raw_industries.add(ind)
    resolve_industry_cache(list(all_raw_industries))

    # 3. Build HubSpot contact lookup by normalized name
    hs_by_name = {}
    for c in hs_contacts:
        p = c.get('properties', {})
        fn = (p.get('firstname') or '').strip()
        ln = (p.get('lastname') or '').strip()
        name = f"{fn} {ln}".strip()
        norm = normalize_name(name)
        if norm:
            if norm not in hs_by_name:
                hs_by_name[norm] = c

    # ── Step 0: Fix industry values (map raw LinkedIn → HubSpot enum) ──
    if args.fix_industry:
        print("\n── Fixing industry values (LinkedIn → HubSpot enum) ──")
        industry_fixed = 0
        industry_filled = 0
        industry_already_ok = 0
        industry_empty = 0

        for c in hs_contacts:
            p = c.get('properties', {})
            current_industry = (p.get('industry') or '').strip()
            fn = (p.get('firstname') or '').strip()
            ln = (p.get('lastname') or '').strip()
            name = f"{fn} {ln}".strip()
            norm = normalize_name(name)

            if current_industry:
                # Check if it's already a valid HubSpot enum (all caps + underscores)
                mapped = map_industry(current_industry)
                if mapped != current_industry:
                    # Needs fixing
                    if args.dry_run:
                        print(f"  [DRY RUN] {name}: '{current_industry}' → '{mapped}'")
                    else:
                        result = hs_request('PATCH', f"/crm/v3/objects/contacts/{c['id']}", hs_key,
                                            {'properties': {'industry': mapped}})
                        print(f"  Fixed {name} ({c['id']}): '{current_industry}' → '{mapped}'")
                        time.sleep(0.15)
                    industry_fixed += 1
                else:
                    industry_already_ok += 1
            else:
                # Empty industry - try to fill from master list or scraper
                master = master_lookup.get(norm)
                scraper = scraper_by_name.get(norm)
                if not scraper:
                    hs_url = (p.get('hs_linkedin_url') or '').strip().lower().rstrip('/')
                    if hs_url:
                        scraper = scraper_by_url.get(hs_url)

                raw_ind = ''
                if scraper:
                    raw_ind = (scraper.get('companyIndustry') or '').strip()
                if not raw_ind and master:
                    raw_ind = (master.get('adjIndustry') or master.get('industry') or '').strip()

                if raw_ind:
                    mapped = map_industry(raw_ind)
                    if args.dry_run:
                        print(f"  [DRY RUN] {name}: empty → '{mapped}' (from {'scraper' if scraper else 'master'})")
                    else:
                        result = hs_request('PATCH', f"/crm/v3/objects/contacts/{c['id']}", hs_key,
                                            {'properties': {'industry': mapped}})
                        print(f"  Filled {name} ({c['id']}): → '{mapped}'")
                        time.sleep(0.15)
                    industry_filled += 1
                else:
                    industry_empty += 1

        print(f"\n  Fixed (remapped): {industry_fixed}")
        print(f"  Filled (was empty): {industry_filled}")
        print(f"  Already correct: {industry_already_ok}")
        print(f"  Still empty (no source): {industry_empty}")

        if not args.dry_run and not args.cleanup:
            print("\nDone with industry fix. Use --dry-run to preview other changes.")
            return

    # ── Step A: Clean up sample/test contacts ───────────────────────────
    if args.cleanup:
        print("\n── Cleaning up sample/test contacts ──")
        for cid in SAMPLE_CONTACT_IDS + TEST_CONTACT_IDS:
            if args.dry_run:
                print(f"  [DRY RUN] Would delete contact {cid}")
            else:
                result = hs_request('DELETE', f'/crm/v3/objects/contacts/{cid}', hs_key)
                print(f"  Deleted contact {cid}")
                time.sleep(0.15)

    # ── Step B: Enrich existing CONNECTED contacts ──────────────────────
    print("\n── Enriching existing CONNECTED contacts ──")
    connected_hs = [c for c in hs_contacts
                    if (c.get('properties', {}).get('hs_lead_status') or '') == 'CONNECTED']

    enriched_count = 0
    skipped_count = 0
    no_match_count = 0
    needs_scraper = []

    for c in connected_hs:
        p = c.get('properties', {})
        fn = (p.get('firstname') or '').strip()
        ln = (p.get('lastname') or '').strip()
        name = f"{fn} {ln}".strip()
        norm = normalize_name(name)

        master = master_lookup.get(norm)
        # Look up scraper by name first, then by LinkedIn URL from HubSpot or Master List
        scraper = scraper_by_name.get(norm)
        if not scraper:
            hs_url = (p.get('hs_linkedin_url') or '').strip().lower().rstrip('/')
            if hs_url:
                scraper = scraper_by_url.get(hs_url)
            if not scraper and master:
                master_url = (master.get('defaultProfileUrl') or '').strip().lower().rstrip('/')
                if master_url:
                    scraper = scraper_by_url.get(master_url)

        if not master and not scraper:
            no_match_count += 1
            continue

        updates = compute_updates(c, master, scraper)

        if not updates:
            skipped_count += 1
        else:
            enriched_count += 1
            if args.dry_run:
                print(f"  [DRY RUN] {name}: would update {list(updates.keys())}")
            else:
                # If email update fails (already on another contact), retry without email
                result = hs_request('PATCH', f"/crm/v3/objects/contacts/{c['id']}", hs_key,
                                    {'properties': updates})
                if result is None and 'email' in updates:
                    del updates['email']
                    if updates:
                        result = hs_request('PATCH', f"/crm/v3/objects/contacts/{c['id']}", hs_key,
                                            {'properties': updates})
                fields_updated = list(updates.keys())
                print(f"  Updated {name} ({c['id']}): {fields_updated}")
                time.sleep(0.15)  # Rate limit

        # Track profiles needing email scraper — but ONLY if:
        # 1. No email in HubSpot (even after updates)
        # 2. Profile was NOT already scraped (not in scraper CSV)
        # If scraper already ran and didn't find email, no point re-running
        has_email = bool((p.get('email') or '').strip() or updates.get('email'))
        already_scraped = scraper is not None  # exists in scraper CSV = already ran
        if not has_email and master and not already_scraped:
            needs_scraper.append({
                'name': name,
                'defaultProfileUrl': master.get('defaultProfileUrl', ''),
                'hs_id': c['id'],
            })

    # Count how many have no email but were already scraped (so we skip re-running)
    already_scraped_no_email = 0
    for c in connected_hs:
        p = c.get('properties', {})
        fn = (p.get('firstname') or '').strip()
        ln = (p.get('lastname') or '').strip()
        norm = normalize_name(f"{fn} {ln}".strip())
        has_email = bool((p.get('email') or '').strip())
        if not has_email:
            already_scraped = scraper_by_name.get(norm) is not None
            if not already_scraped:
                hs_url = (p.get('hs_linkedin_url') or '').strip().lower().rstrip('/')
                if hs_url and scraper_by_url.get(hs_url) is not None:
                    already_scraped = True
            if already_scraped:
                already_scraped_no_email += 1

    print(f"\n  Enriched: {enriched_count}")
    print(f"  Already complete: {skipped_count}")
    print(f"  No Master List/Scraper match: {no_match_count}")
    print(f"  Already scraped (no email found): {already_scraped_no_email}")
    print(f"  Need profile scraper (never scraped): {len(needs_scraper)}")

    # ── Step C: Create unsynced profiles in HubSpot ─────────────────────
    print(f"\n── Creating {len(unsynced_profiles)} unsynced profiles in HubSpot ──")
    created_count = 0

    for profile in unsynced_profiles:
        name = (profile.get('fullName') or '').strip()
        norm = normalize_name(name)
        scraper = scraper_by_name.get(norm)
        if not scraper:
            master_url = (profile.get('defaultProfileUrl') or '').strip().lower().rstrip('/')
            if master_url:
                scraper = scraper_by_url.get(master_url)

        # Check if already in HubSpot (edge case)
        if norm in hs_by_name:
            print(f"  SKIP {name}: already in HubSpot (ID: {hs_by_name[norm]['id']})")
            continue

        payload = create_contact_payload(profile, scraper)

        if args.dry_run:
            print(f"  [DRY RUN] Would create: {name} | {payload.get('company', '')} | {payload.get('jobtitle', '')}")
        else:
            result = hs_request('POST', '/crm/v3/objects/contacts', hs_key,
                                {'properties': payload})
            if result and result.get('id'):
                created_count += 1
                print(f"  Created {name} (ID: {result['id']}) | {payload.get('company', '')}")
            else:
                print(f"  FAILED to create {name}")
            time.sleep(0.15)

        # Track if needs scraper — only if not already scraped
        already_scraped = scraper is not None
        if not payload.get('email') and not already_scraped:
            needs_scraper.append({
                'name': name,
                'defaultProfileUrl': profile.get('defaultProfileUrl', ''),
                'hs_id': 'new',
            })

    if not args.dry_run:
        print(f"  Created: {created_count}")

    # ── Step C2: Create/enrich from scraper profiles not yet in HubSpot ──
    # Rebuild HubSpot name + URL lookups (including newly created contacts)
    hs_name_set = set(hs_by_name.keys())
    hs_url_set = set()
    for c in hs_contacts:
        url = (c.get('properties', {}).get('hs_linkedin_url') or '').strip().lower().rstrip('/')
        if url:
            hs_url_set.add(url)

    # Also add URLs from unsynced profiles we just created
    for p in unsynced_profiles:
        url = (p.get('defaultProfileUrl') or '').strip().lower().rstrip('/')
        if url:
            hs_url_set.add(url)
        norm = normalize_name((p.get('fullName') or '').strip())
        if norm:
            hs_name_set.add(norm)

    scraper_created = 0
    scraper_skipped = 0
    print(f"\n── Creating HubSpot contacts from scraper profiles not yet in HubSpot ──")

    for sp in scraper_profiles:
        sp_fn = (sp.get('firstName') or '').strip()
        sp_ln = (sp.get('lastName') or '').strip()
        sp_name = f"{sp_fn} {sp_ln}".strip()
        sp_norm = normalize_name(sp_name)
        sp_url = (sp.get('linkedinProfileUrl') or '').strip().lower().rstrip('/')

        # Skip if already in HubSpot by name or URL
        if sp_norm in hs_name_set:
            scraper_skipped += 1
            continue
        if sp_url and sp_url in hs_url_set:
            scraper_skipped += 1
            continue

        # Build payload from scraper data
        email = (sp.get('professionalEmail') or '').strip()
        location = (sp.get('location') or '').strip()
        city, state, country = parse_location(location)

        payload = {
            'firstname': sp_fn,
            'lastname': sp_ln,
            'hs_lead_status': 'CONNECTED',
            'hs_linkedin_url': (sp.get('linkedinProfileUrl') or '').strip(),
        }

        if email:
            payload['email'] = email
        job_title = (sp.get('linkedinJobTitle') or '').strip()
        if job_title:
            payload['jobtitle'] = job_title
        company = (sp.get('companyName') or '').strip()
        if company:
            payload['company'] = company
        industry = (sp.get('companyIndustry') or '').strip()
        if industry:
            payload['industry'] = map_industry(industry)
        if city:
            payload['city'] = city
        if state:
            payload['state'] = state
        if country:
            payload['country'] = country

        # New enrichment fields
        headline = (sp.get('linkedinHeadline') or '').strip()
        if headline:
            payload['linkedin_headline'] = headline
        school = (sp.get('linkedinSchoolName') or '').strip()
        if school:
            payload['school_name'] = school
        degree = (sp.get('linkedinSchoolDegree') or '').strip()
        if degree:
            payload['school_degree'] = degree
        prev_co = (sp.get('previousCompanyName') or '').strip()
        if prev_co:
            payload['previous_company_name'] = prev_co
        prev_pos = (sp.get('linkedinPreviousJobTitle') or '').strip()
        if prev_pos:
            payload['previous_company_position'] = prev_pos
        job_loc = (sp.get('linkedinJobLocation') or '').strip()
        if job_loc:
            payload['job_location'] = job_loc
        slug = (sp.get('linkedinCompanySlug') or '').strip()
        if slug:
            payload['linkedin_company_slug'] = slug

        # Remove empty values
        payload = {k: v for k, v in payload.items() if v}

        if args.dry_run:
            print(f"  [DRY RUN] Would create from scraper: {sp_name} | {payload.get('company', '')} | {payload.get('jobtitle', '')}")
        else:
            result = hs_request('POST', '/crm/v3/objects/contacts', hs_key,
                                {'properties': payload})
            if result and result.get('id'):
                scraper_created += 1
                print(f"  Created {sp_name} (ID: {result['id']}) | {payload.get('company', '')}")
            else:
                print(f"  FAILED to create {sp_name}")
            time.sleep(0.15)

        # Track in sets to avoid duplicates in this run
        if sp_norm:
            hs_name_set.add(sp_norm)
        if sp_url:
            hs_url_set.add(sp_url)

    print(f"  Created from scraper: {scraper_created if not args.dry_run else 'dry-run'}")
    print(f"  Already in HubSpot: {scraper_skipped}")

    # ── Step D: Profile scraper needs ───────────────────────────────────
    print(f"\n── Profiles needing email scraper ({len(needs_scraper)}) ──")
    for ns in needs_scraper[:20]:
        print(f"  {ns['name']:40s} | {ns['defaultProfileUrl'][:60]}")
    if len(needs_scraper) > 20:
        print(f"  ... and {len(needs_scraper) - 20} more")

    # Also check ALL connected HubSpot contacts for missing email (not just newly created)
    if not needs_scraper:
        # Re-scan all CONNECTED contacts for missing email
        print("\n── Scanning all CONNECTED contacts for missing email ──")
        for c in connected_hs:
            p = c.get('properties', {})
            if (p.get('email') or '').strip():
                continue
            fn = (p.get('firstname') or '').strip()
            ln = (p.get('lastname') or '').strip()
            name = f"{fn} {ln}".strip()
            norm = normalize_name(name)
            master = master_lookup.get(norm)
            linkedin_url = (p.get('hs_linkedin_url') or '').strip()
            if not linkedin_url and master:
                linkedin_url = master.get('defaultProfileUrl', '')
            # Only add if not already scraped
            already_scraped = scraper_by_name.get(norm) is not None
            if not already_scraped and linkedin_url:
                url_norm = linkedin_url.lower().rstrip('/')
                if scraper_by_url.get(url_norm) is not None:
                    already_scraped = True
            if linkedin_url and not already_scraped:
                needs_scraper.append({
                    'name': name,
                    'defaultProfileUrl': linkedin_url,
                    'hs_id': c['id'],
                })
        print(f"  Found {len(needs_scraper)} contacts needing profile scraper (excludes already-scraped)")

    if needs_scraper:
        # Save URLs to a file for easy import
        scraper_urls = [ns['defaultProfileUrl'] for ns in needs_scraper if ns['defaultProfileUrl']]
        output_file = os.path.join(os.path.dirname(__file__), 'scraper-urls-needed.csv')
        with open(output_file, 'w') as f:
            f.write('linkedInProfileUrl,fullName,hubspotId\n')
            for ns in needs_scraper:
                if ns['defaultProfileUrl']:
                    f.write(f"{ns['defaultProfileUrl']},{ns['name']},{ns['hs_id']}\n")
        print(f"  Saved {len(scraper_urls)} URLs to {output_file}")

    if args.launch_scraper and needs_scraper:
        print(f"\n── Launching profile scraper for {len(needs_scraper)} profiles ──")
        scraper_urls = [ns['defaultProfileUrl'] for ns in needs_scraper if ns['defaultProfileUrl']]
        print(f"  Profiles with URLs: {len(scraper_urls)}")

        if scraper_urls and not args.dry_run:
            # Get PhantomBuster API key from Doppler
            try:
                pb_result = subprocess.run(
                    ['doppler', 'secrets', 'get', 'PHANTOMBUSTER_API_KEY', '--plain'],
                    capture_output=True, text=True, timeout=30
                )
                pb_key = pb_result.stdout.strip()
            except Exception:
                pb_key = ''

            if not pb_key:
                print("  WARNING: Could not get PHANTOMBUSTER_API_KEY from Doppler")
                print("  Manual steps needed:")
                print(f"    1. Add URLs from {output_file} to HoldingSheet")
                print(f"    2. Launch PhantomBuster agent {PB_SCRAPER_AGENT_ID}")
            else:
                print(f"  PhantomBuster API key found")
                print(f"  NOTE: URLs need to be added to HoldingSheet ({HOLDING_SHEET_ID}) first")
                print(f"  Then launch agent {PB_SCRAPER_AGENT_ID} via PB dashboard or API")
                print(f"  The scraper webhook will trigger WF 3.3 to push results to HubSpot")
        elif args.dry_run:
            print(f"  [DRY RUN] Would populate HoldingSheet with {len(scraper_urls)} URLs and launch scraper")

    # ── Summary ─────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  HubSpot contacts processed: {len(connected_hs)}")
    print(f"  Enriched with new data: {enriched_count}")
    print(f"  Already complete: {skipped_count}")
    print(f"  No data source match: {no_match_count}")
    print(f"  Unsynced created (Master List): {created_count if not args.dry_run else len(unsynced_profiles)}")
    print(f"  Created from scraper CSV: {scraper_created if not args.dry_run else 'dry-run'}")
    print(f"  Still need email scraper (never scraped): {len(needs_scraper)}")
    if needs_scraper:
        output_file = os.path.join(os.path.dirname(__file__), 'scraper-urls-needed.csv')
        print(f"  Scraper URLs saved to: {output_file}")
    if args.dry_run:
        print("\n*** DRY RUN — re-run without --dry-run to apply changes ***")


if __name__ == '__main__':
    main()
