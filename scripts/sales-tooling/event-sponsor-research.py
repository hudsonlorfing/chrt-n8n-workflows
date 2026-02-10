#!/usr/bin/env python3
"""
Event Sponsor Research & Outreach Automation

Takes an event sponsor page URL, extracts company data, checks against HubSpot,
builds Sales Navigator 2nd-degree connection URLs, generates prioritized outreach
tasks, and scores contacts with ICP criteria.

Usage:
  # Scrape sponsors and check HubSpot (dry run):
  python3 event-sponsor-research.py --url https://aircargoconference.com/sponsors/ --dry-run

  # Full run (creates companies + tasks in HubSpot):
  python3 event-sponsor-research.py --url https://aircargoconference.com/sponsors/

  # From a CSV instead of scraping:
  python3 event-sponsor-research.py --csv sponsors.csv

  # Score contacts at existing companies:
  python3 event-sponsor-research.py --url https://aircargoconference.com/sponsors/ --score-contacts

  # Conference prep: create tasks for existing contacts + geo query + AI seed ranking:
  python3 event-sponsor-research.py --csv sponsors.csv --conference-tasks --geo-query --geo-city Orlando --ai-seeds

  # Just print company list grouped by tier for Sales Nav filter building:
  python3 event-sponsor-research.py --csv sponsors.csv --company-list
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
import urllib.parse
from html.parser import HTMLParser


# ─── Configuration ──────────────────────────────────────────────────────────

SEED_RANKING_PROMPT = """You are an expert B2B networking analyst. Given a list of contacts we are already connected with on LinkedIn and a list of sponsor companies at a conference, identify the TOP 10 contacts most likely to have 2nd-degree connections to decision-makers at the sponsor companies.

Consider:
1. Industry overlap — contacts in similar industries (logistics, healthcare, aerospace, supply chain) are more connected
2. Seniority — VPs, Directors, C-suite tend to have broader networks
3. Company size & reputation — contacts at larger or well-known companies have wider networks
4. Geographic proximity — contacts near the conference city are more likely to know local attendees
5. Role relevance — operations, logistics, supply chain roles cross-pollinate across companies

Return a JSON array of exactly 10 objects, ranked by likelihood of having the most 2nd-degree connections across sponsor companies:
[{"contactId": "...", "name": "...", "reasoning": "one sentence explaining why"}]

## OUR CONTACTS
{contacts_json}

## CONFERENCE SPONSOR COMPANIES
{sponsors_json}

## CONFERENCE LOCATION
{conference_city}

Return ONLY the JSON array, no other text.
"""

ICP_PROMPT_TEMPLATE = """Score this LinkedIn profile 0-10 for Chrt, a B2B SaaS for time-critical logistics. Return JSON only:
{"score": <0-10>, "segment": "<Shipper-Healthcare|Shipper-Aerospace|Courier|Forwarder|Skip>", "reason": "<one sentence>", "hubspotIndustry": "<HUBSPOT_INDUSTRY_ENUM>"}

For hubspotIndustry, map the LinkedIn industry to the closest HubSpot enum from: AIRLINES_AVIATION, AVIATION_AEROSPACE, BIOTECHNOLOGY, DEFENSE_SPACE, HOSPITAL_HEALTH_CARE, HEALTH_WELLNESS_AND_FITNESS, IMPORT_AND_EXPORT, LOGISTICS_AND_SUPPLY_CHAIN, MARITIME, MECHANICAL_OR_INDUSTRIAL_ENGINEERING, MEDICAL_DEVICES, MEDICAL_PRACTICE, PACKAGE_FREIGHT_DELIVERY, PHARMACEUTICALS, TRANSPORTATION_TRUCKING_RAILROAD, WAREHOUSING, WHOLESALE. Use exact enum values only.

## ICP CRITERIA

### SHIPPER-HEALTHCARE (7-10)
Titles: CSCO, Director, VP Supply Chain, VP Lab Ops, Director Logistics/Transportation/Courier Ops, Supply Chain Manager, Director Field Ops, Case Logistics Manager
Companies: Regional health systems, genetics/specialty labs, pharma/biotech, OPOs, tissue/blood banks, med device
Signals: "logistics" "supply chain" "courier" "specimen" in headline | 200-10K employees | Regional focus

### SHIPPER-AEROSPACE (7-10)
Titles: VP/SVP Supply Chain, Director, Director AOG Ops, VP Aftermarket/Customer Support, Materials Manager, CPO
Companies: MRO facilities, aircraft component mfg, engine MROs, airline maintenance
Signals: "AOG" "MRO" "aviation" "aerospace" | Aftermarket focus | Emergency parts

### COURIER (6-10)
Titles: Owner/CEO/Founder, Director, Operations Manager, Dispatch Manager, Fleet Manager, GM
Companies: Medical couriers, same-day/time-critical, cold chain specialists, regional networks
Signals: "medical courier" "same-day" "cold chain" | 10-500 employees | Owner/operator
Avoid: FedEx/UPS employees, DoorDash/Uber Eats, Amazon DSPs

### FORWARDER/AGENT (5-10)
Titles: Operations Manager, Station Manager, Logistics Manager, Director, Network Manager
Companies: Freight forwarders, 3PLs with last-mile, same-day logistics specialists

## SCORING: 10=Perfect fit, 8-9=Excellent, 6-7=Good, 4-5=Marginal, 1-3=Poor, 0=Skip

## LEAD DATA
Name: {fullName}
Title: {title}
Company: {companyName}
Industry: {industry}
Location: {location}
Summary: {summary}
"""


# ─── Helpers ────────────────────────────────────────────────────────────────

def get_doppler_key(name):
    """Fetch a secret from Doppler."""
    try:
        result = subprocess.run(
            ['doppler', 'secrets', 'get', name, '--plain'],
            capture_output=True, text=True, timeout=30
        )
        return result.stdout.strip()
    except Exception:
        return ''


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
            raw = resp.read().decode()
            if not raw:
                return {'ok': True, 'status': resp.status}
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"  HubSpot API error {e.code}: {error_body[:200]}")
        return None


def fetch_page(url):
    """Fetch a web page and return its HTML."""
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode('utf-8', errors='replace')


def normalize_domain(url_or_domain):
    """Extract clean domain from URL or domain string."""
    if not url_or_domain:
        return ''
    d = url_or_domain.lower().strip()
    d = re.sub(r'^https?://', '', d)
    d = re.sub(r'^www\.', '', d)
    d = d.split('/')[0]
    return d


def extract_linkedin_company_id(linkedin_url):
    """Extract numeric company ID from LinkedIn company URL if available."""
    if not linkedin_url:
        return None
    # Try to extract from /company/12345 format
    m = re.search(r'/company/(\d+)', linkedin_url)
    if m:
        return m.group(1)
    return None


def build_sales_nav_url(linkedin_company_id):
    """Build a Sales Navigator 2nd-degree connection search URL."""
    if not linkedin_company_id:
        return None
    return (
        f"https://www.linkedin.com/sales/search/people?"
        f"filters=List("
        f"(type:CURRENT_COMPANY,values:List((id:{linkedin_company_id},selectionType:INCLUDED))),"
        f"(type:NETWORK,values:List((id:S,selectionType:INCLUDED)))"
        f")"
    )


# ─── Step 1: Data Extraction ───────────────────────────────────────────────

class SponsorPageParser(HTMLParser):
    """Extract sponsor names and tiers from an event sponsor page."""
    
    def __init__(self):
        super().__init__()
        self.sponsors = []
        self._current_tier = 'Unknown'
        self._in_heading = False
        self._in_link = False
        self._current_text = ''
        self._current_href = ''
        self._tag_stack = []
    
    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        self._tag_stack.append(tag)
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5'):
            self._in_heading = True
            self._current_text = ''
        if tag == 'a':
            self._current_href = attrs_dict.get('href', '')
        if tag == 'img':
            alt = attrs_dict.get('alt', '').strip()
            if alt and len(alt) > 2 and alt.lower() not in ('logo', 'sponsor', 'image', 'photo'):
                self.sponsors.append({
                    'name': alt,
                    'tier': self._current_tier,
                    'source_url': self._current_href,
                })
    
    def handle_data(self, data):
        text = data.strip()
        if self._in_heading and text:
            self._current_text += text
    
    def handle_endtag(self, tag):
        if self._tag_stack:
            self._tag_stack.pop()
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5') and self._in_heading:
            self._in_heading = False
            text = self._current_text.strip().lower()
            for tier in ['platinum', 'diamond', 'gold', 'silver', 'bronze', 'host', 'title', 'friend']:
                if tier in text:
                    self._current_tier = tier.capitalize()
                    break


def scrape_sponsors(url):
    """Scrape sponsor page for company names and tiers."""
    print(f"Scraping sponsors from {url}...")
    html = fetch_page(url)
    
    parser = SponsorPageParser()
    parser.feed(html)
    
    # Deduplicate by name
    seen = set()
    unique = []
    for s in parser.sponsors:
        name_key = s['name'].lower().strip()
        if name_key not in seen:
            seen.add(name_key)
            unique.append(s)
    
    print(f"  Found {len(unique)} sponsors")
    for s in unique[:10]:
        print(f"    {s['tier']:12s} | {s['name']}")
    if len(unique) > 10:
        print(f"    ... and {len(unique) - 10} more")
    
    return unique


def load_sponsors_csv(csv_path):
    """Load sponsors from a CSV file (columns: name, tier, domain, linkedin_url)."""
    print(f"Loading sponsors from {csv_path}...")
    sponsors = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            sponsors.append({
                'name': row.get('name', '').strip(),
                'tier': row.get('tier', 'Unknown').strip(),
                'domain': row.get('domain', '').strip(),
                'linkedin_url': row.get('linkedin_url', '').strip(),
            })
    print(f"  Loaded {len(sponsors)} sponsors")
    return sponsors


# ─── Step 2: HubSpot Verification & Dedup ──────────────────────────────────

def search_hs_company_by_domain(domain, key):
    """Search HubSpot for a company by domain."""
    if not domain:
        return None
    body = {
        "filterGroups": [{
            "filters": [{
                "propertyName": "domain",
                "operator": "EQ",
                "value": domain
            }]
        }],
        "properties": [
            "name", "domain", "linkedin_company_page", "industry",
            "hs_num_associated_contacts", "lifecyclestage"
        ],
        "limit": 1
    }
    result = hs_request('POST', '/crm/v3/objects/companies/search', key, body)
    if result and result.get('total', 0) > 0:
        return result['results'][0]
    return None


def search_hs_company_by_linkedin(linkedin_url, key):
    """Search HubSpot for a company by LinkedIn URL."""
    if not linkedin_url:
        return None
    body = {
        "filterGroups": [{
            "filters": [{
                "propertyName": "linkedin_company_page",
                "operator": "CONTAINS_TOKEN",
                "value": linkedin_url.split('/company/')[-1].rstrip('/') if '/company/' in linkedin_url else linkedin_url
            }]
        }],
        "properties": [
            "name", "domain", "linkedin_company_page", "industry",
            "hs_num_associated_contacts", "lifecyclestage"
        ],
        "limit": 1
    }
    result = hs_request('POST', '/crm/v3/objects/companies/search', key, body)
    if result and result.get('total', 0) > 0:
        return result['results'][0]
    return None


def get_company_contacts(company_id, key):
    """Get contacts associated with a company."""
    # First get associations
    assoc = hs_request('GET', f'/crm/v3/objects/companies/{company_id}/associations/contacts', key)
    if not assoc or not assoc.get('results'):
        return []
    
    contact_ids = [r['id'] for r in assoc['results'][:20]]
    contacts = []
    for cid in contact_ids:
        c = hs_request('GET', f'/crm/v3/objects/contacts/{cid}?properties=firstname,lastname,email,phone,jobtitle,hs_linkedin_url', key)
        if c:
            contacts.append(c)
        time.sleep(0.1)
    return contacts


def create_hs_company(name, domain, tier, event_name, key, dry_run=False):
    """Create a new company in HubSpot."""
    payload = {
        'properties': {
            'name': name,
            'domain': domain,
            'lifecyclestage': 'lead',
            'hs_lead_status': 'NEW',
        }
    }
    # Remove empty values
    payload['properties'] = {k: v for k, v in payload['properties'].items() if v}
    
    if dry_run:
        return {'id': 'DRY_RUN', 'properties': payload['properties']}
    
    result = hs_request('POST', '/crm/v3/objects/companies', key, payload)
    time.sleep(0.15)
    return result


# ─── Conference Task Creation ───────────────────────────────────────────────

def create_conference_prep_task(contact, company_name, conference_name, hs_key, dry_run=False):
    """Create a Conference Prep HubSpot task for a known contact."""
    props = contact.get('properties', {})
    fn = (props.get('firstname') or '').strip()
    ln = (props.get('lastname') or '').strip()
    full_name = f"{fn} {ln}".strip() or 'Unknown'
    title = props.get('jobtitle', '')
    company = company_name
    linkedin_url = props.get('hs_linkedin_url', '')

    subject = f"Conference Prep: {full_name} - {conference_name}"
    body = (
        f"{full_name} ({title} at {company}) is connected to you on LinkedIn. "
        f"Tagged for {conference_name}.\n\n"
        f"LinkedIn: {linkedin_url}\n\n"
        f"Draft message:\n"
        f"Hey {fn}, I'll be at {conference_name} next week -- would love to chat "
        f"about how Chrt is helping companies like {company} streamline time-critical "
        f"logistics. Open to grabbing coffee or a quick meeting?"
    )

    payload = {
        'properties': {
            'hs_task_subject': subject,
            'hs_task_body': body,
            'hs_task_type': 'LINKEDIN_MESSAGE',
            'hs_task_priority': 'HIGH',
            'hs_task_status': 'NOT_STARTED',
            'hs_timestamp': str(int(time.time() * 1000)),
        }
    }

    if dry_run:
        print(f"  [DRY RUN] Would create task: {subject}")
        return {'id': 'DRY_RUN'}

    result = hs_request('POST', '/crm/v3/objects/tasks', hs_key, payload)
    if result and result.get('id'):
        # Associate task with contact
        hs_request('PUT',
                   f"/crm/v3/objects/tasks/{result['id']}/associations/contacts/{contact['id']}/task_to_contact",
                   hs_key)
        time.sleep(0.15)
        print(f"  Created task: {subject}")
    return result


def search_hs_contacts_by_city(cities, hs_key, max_results=100):
    """Search HubSpot contacts by city (multiple cities supported)."""
    all_contacts = []
    for city in cities:
        body = {
            "filterGroups": [{
                "filters": [{
                    "propertyName": "city",
                    "operator": "EQ",
                    "value": city
                }]
            }],
            "properties": [
                "firstname", "lastname", "email", "phone", "jobtitle",
                "hs_linkedin_url", "company", "city", "state"
            ],
            "limit": max_results
        }
        result = hs_request('POST', '/crm/v3/objects/contacts/search', hs_key, body)
        if result and result.get('results'):
            for c in result['results']:
                c['_search_city'] = city
                all_contacts.append(c)
        time.sleep(0.12)

    # Deduplicate by contact ID
    seen = set()
    unique = []
    for c in all_contacts:
        if c['id'] not in seen:
            seen.add(c['id'])
            unique.append(c)
    return unique


def get_all_company_contacts(company_ids, hs_key):
    """Get all contacts across multiple companies for seed ranking."""
    all_contacts = []
    for company_id in company_ids:
        contacts = get_company_contacts(company_id, hs_key)
        for c in contacts:
            c['_company_id'] = company_id
            all_contacts.append(c)
        time.sleep(0.12)
    return all_contacts


def rank_seeds_with_ai(contacts, sponsors, conference_city, anthropic_key):
    """Use Claude to rank top 10 seed contacts for Sales Nav crawls."""
    # Format contacts for the prompt
    contacts_data = []
    for c in contacts:
        props = c.get('properties', {})
        contacts_data.append({
            'contactId': c['id'],
            'name': f"{props.get('firstname', '')} {props.get('lastname', '')}".strip(),
            'title': props.get('jobtitle', ''),
            'company': props.get('company', ''),
            'city': props.get('city', ''),
            'linkedin': props.get('hs_linkedin_url', ''),
        })

    # Format sponsors for the prompt
    sponsors_data = [{'name': s['name'], 'tier': s.get('tier', 'Unknown')} for s in sponsors]

    prompt = SEED_RANKING_PROMPT.format(
        contacts_json=json.dumps(contacts_data[:100], indent=2) if len(contacts_data) > 100 else json.dumps(contacts_data, indent=2),
        sponsors_json=json.dumps(sponsors_data, indent=2),
        conference_city=conference_city,
    )

    body = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}]
    }

    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=json.dumps(body).encode('utf-8'),
        headers={
            'x-api-key': anthropic_key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode())
        text = result.get('content', [{}])[0].get('text', '')
        # Extract JSON array from response
        json_match = re.search(r'\[.*\]', text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except Exception as e:
        print(f"    AI seed ranking error: {e}")

    return []


# ─── Step 3: Sales Navigator Intelligence ──────────────────────────────────

def build_sales_nav_company_url(linkedin_url):
    """Build Sales Nav 2nd-degree search URL from LinkedIn company URL."""
    company_id = extract_linkedin_company_id(linkedin_url)
    if company_id:
        return build_sales_nav_url(company_id)
    
    # If URL is slug-based (e.g., /company/delta-cargo), use the slug
    if linkedin_url and '/company/' in linkedin_url:
        slug = linkedin_url.split('/company/')[-1].rstrip('/')
        if slug:
            # Build URL that works with company name slug too
            return (
                f"https://www.linkedin.com/sales/search/people?"
                f"filters=List("
                f"(type:CURRENT_COMPANY,values:List((id:{slug},selectionType:INCLUDED))),"
                f"(type:NETWORK,values:List((id:S,selectionType:INCLUDED)))"
                f")"
            )
    return None


# ─── Step 4: Task Generation ───────────────────────────────────────────────

def create_hs_task(company_id, company_name, task_type, title, body_text, priority, key, dry_run=False):
    """Create a task in HubSpot Sales Workspace."""
    payload = {
        'properties': {
            'hs_task_subject': title,
            'hs_task_body': body_text,
            'hs_task_type': task_type,          # CALL, EMAIL, LINKEDIN_MESSAGE, TODO
            'hs_task_priority': priority,        # HIGH, MEDIUM, LOW
            'hs_task_status': 'NOT_STARTED',
            'hs_timestamp': str(int(time.time() * 1000)),
        }
    }
    
    if dry_run:
        print(f"  [DRY RUN] Would create task: {title}")
        return {'id': 'DRY_RUN'}
    
    result = hs_request('POST', '/crm/v3/objects/tasks', key, payload)
    if result and result.get('id'):
        # Associate task with company
        hs_request('PUT',
                   f"/crm/v3/objects/tasks/{result['id']}/associations/companies/{company_id}/task_to_company",
                   key)
        time.sleep(0.15)
    return result


# ─── Step 5: ICP Scoring ───────────────────────────────────────────────────

def score_contact_with_llm(contact_data, anthropic_key):
    """Score a contact using Claude API with ICP criteria."""
    prompt = ICP_PROMPT_TEMPLATE.format(
        fullName=contact_data.get('fullName', ''),
        title=contact_data.get('title', ''),
        companyName=contact_data.get('companyName', ''),
        industry=contact_data.get('industry', ''),
        location=contact_data.get('location', ''),
        summary=contact_data.get('summary', ''),
    )
    
    body = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 256,
        "messages": [{"role": "user", "content": prompt}]
    }
    
    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=json.dumps(body).encode('utf-8'),
        headers={
            'x-api-key': anthropic_key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        method='POST'
    )
    
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
        text = result.get('content', [{}])[0].get('text', '')
        # Extract JSON from response
        json_match = re.search(r'\{[^}]+\}', text)
        if json_match:
            return json.loads(json_match.group())
    except Exception as e:
        print(f"    LLM scoring error: {e}")
    
    return None


# ─── Main Pipeline ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Event Sponsor Research & Outreach Automation')
    parser.add_argument('--url', help='Event sponsor page URL to scrape')
    parser.add_argument('--csv', help='CSV file with sponsor data (columns: name, tier, domain, linkedin_url)')
    parser.add_argument('--event-name', default='AirCargo Conference 2026', help='Event name for tagging')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    parser.add_argument('--score-contacts', action='store_true', help='Also score contacts with ICP criteria')
    parser.add_argument('--create-tasks', action='store_true', help='Create outreach tasks in HubSpot')
    parser.add_argument('--conference-tasks', action='store_true',
                        help='Create Conference Prep tasks for existing contacts at sponsor companies')
    parser.add_argument('--geo-query', action='store_true',
                        help='Search HubSpot for contacts in the conference city area')
    parser.add_argument('--geo-city', default='Orlando',
                        help='Conference city for geo query (default: Orlando)')
    parser.add_argument('--ai-seeds', action='store_true',
                        help='Use Claude AI to rank top 10 seed contacts for Sales Nav crawls')
    parser.add_argument('--company-list', action='store_true',
                        help='Print sponsor companies grouped by tier for Sales Nav filter')
    args = parser.parse_args()

    if not args.url and not args.csv:
        parser.error('Provide either --url or --csv')

    print("=" * 70)
    print(f"Event Sponsor Research: {args.event_name}")
    print("=" * 70)
    if args.dry_run:
        print("*** DRY RUN — no changes will be made ***\n")

    # ── Load secrets ──
    hs_key = get_doppler_key('HUBSPOT_CHRT_APP_KEY')
    if not hs_key:
        print("ERROR: Could not fetch HUBSPOT_CHRT_APP_KEY from Doppler")
        sys.exit(1)
    
    anthropic_key = ''
    if args.score_contacts or args.ai_seeds:
        anthropic_key = get_doppler_key('ANTHROPIC_API_KEY')
        if not anthropic_key:
            print("WARNING: Could not fetch ANTHROPIC_API_KEY — scoring/AI seeds disabled")
            args.score_contacts = False
            args.ai_seeds = False

    # ── Step 1: Get sponsor data ──
    if args.csv:
        sponsors = load_sponsors_csv(args.csv)
    else:
        sponsors = scrape_sponsors(args.url)

    if not sponsors:
        print("No sponsors found. Exiting.")
        sys.exit(0)

    # ── Step 2: HubSpot verification ──
    print(f"\n{'─' * 50}")
    print(f"Checking {len(sponsors)} sponsors against HubSpot...")
    print(f"{'─' * 50}")

    existing = []
    new_companies = []
    
    for s in sponsors:
        name = s['name']
        domain = normalize_domain(s.get('domain', ''))
        linkedin_url = s.get('linkedin_url', '')
        
        # Search by domain first, then LinkedIn
        hs_company = None
        if domain:
            hs_company = search_hs_company_by_domain(domain, hs_key)
        if not hs_company and linkedin_url:
            hs_company = search_hs_company_by_linkedin(linkedin_url, hs_key)
        
        if hs_company:
            props = hs_company.get('properties', {})
            s['hs_id'] = hs_company['id']
            s['hs_name'] = props.get('name', '')
            s['hs_domain'] = props.get('domain', '')
            s['hs_linkedin'] = props.get('linkedin_company_page', '')
            s['hs_industry'] = props.get('industry', '')
            s['hs_contacts'] = props.get('hs_num_associated_contacts', '0')
            existing.append(s)
            print(f"  EXISTING  {name:40s} | {s['tier']:10s} | ID: {hs_company['id']}")
        else:
            new_companies.append(s)
            print(f"  NEW       {name:40s} | {s['tier']:10s}")
        
        time.sleep(0.12)  # Rate limit

    print(f"\n  Existing in HubSpot: {len(existing)}")
    print(f"  New companies:       {len(new_companies)}")

    # ── Create new companies ──
    if new_companies:
        print(f"\n{'─' * 50}")
        print(f"Creating {len(new_companies)} new companies in HubSpot...")
        print(f"{'─' * 50}")
        
        created_count = 0
        for s in new_companies:
            domain = normalize_domain(s.get('domain', ''))
            result = create_hs_company(s['name'], domain, s['tier'], args.event_name, hs_key, args.dry_run)
            if result and result.get('id'):
                s['hs_id'] = result['id']
                created_count += 1
                if not args.dry_run:
                    print(f"  Created {s['name']} (ID: {result['id']})")
            else:
                if not args.dry_run:
                    print(f"  FAILED: {s['name']}")
        
        print(f"  Created: {created_count}")

    # ── Step 3: Sales Navigator URLs ──
    print(f"\n{'─' * 50}")
    print("Building Sales Navigator 2nd-degree search URLs...")
    print(f"{'─' * 50}")
    
    nav_count = 0
    for s in existing:
        linkedin_url = s.get('hs_linkedin', '') or s.get('linkedin_url', '')
        nav_url = build_sales_nav_company_url(linkedin_url)
        if nav_url:
            s['sales_nav_url'] = nav_url
            nav_count += 1
    
    print(f"  Built {nav_count} Sales Navigator URLs out of {len(existing)} existing companies")

    # ── Step 4: Task generation ──
    if args.create_tasks:
        print(f"\n{'─' * 50}")
        print("Generating HubSpot Sales Workspace tasks...")
        print(f"{'─' * 50}")
        
        task_count = 0
        for s in existing:
            if not s.get('hs_id'):
                continue
            
            # Check for contacts with phone numbers
            contacts = get_company_contacts(s['hs_id'], hs_key)
            has_phone = any(
                (c.get('properties', {}).get('phone') or '').strip()
                for c in contacts
            )
            
            nav_url = s.get('sales_nav_url', 'N/A — LinkedIn URL missing')
            tier_info = f"[{s['tier']} Sponsor]" if s.get('tier') != 'Unknown' else ''
            
            if has_phone:
                # HIGH PRIORITY — Call
                title = f"Priority Outreach: {s['name']} Sponsor"
                body_text = (
                    f"{tier_info} Sponsor at {args.event_name}. "
                    f"Phone number available on contact record. "
                    f"Check for 2nd-degree connections: {nav_url}"
                )
                create_hs_task(s['hs_id'], s['name'], 'CALL', title, body_text, 'HIGH',
                               hs_key, args.dry_run)
            else:
                # MEDIUM PRIORITY — LinkedIn/Email
                title = f"Digital Outreach: {s['name']}"
                body_text = (
                    f"{tier_info} Sponsor at {args.event_name}. "
                    f"No phone on file. Use Sales Nav to find 2nd-degree connections: {nav_url}"
                )
                create_hs_task(s['hs_id'], s['name'], 'LINKEDIN_MESSAGE', title, body_text, 'MEDIUM',
                               hs_key, args.dry_run)
            
            task_count += 1
            time.sleep(0.12)
        
        print(f"  Created {task_count} tasks")

    # ── Step 5: ICP Scoring ──
    if args.score_contacts:
        print(f"\n{'─' * 50}")
        print("Scoring contacts with ICP criteria...")
        print(f"{'─' * 50}")
        
        scored = 0
        for s in existing:
            if not s.get('hs_id'):
                continue
            
            contacts = get_company_contacts(s['hs_id'], hs_key)
            for c in contacts:
                props = c.get('properties', {})
                fn = (props.get('firstname') or '').strip()
                ln = (props.get('lastname') or '').strip()
                contact_data = {
                    'fullName': f"{fn} {ln}".strip(),
                    'title': props.get('jobtitle', ''),
                    'companyName': s.get('hs_name', s['name']),
                    'industry': s.get('hs_industry', ''),
                    'location': '',
                    'summary': '',
                }
                
                score_result = score_contact_with_llm(contact_data, anthropic_key)
                if score_result:
                    scored += 1
                    score = score_result.get('score', 0)
                    segment = score_result.get('segment', 'Skip')
                    reason = score_result.get('reason', '')
                    hs_industry = score_result.get('hubspotIndustry', '')
                    
                    print(f"  {contact_data['fullName']:30s} | Score: {score:2d} | {segment:20s} | {reason[:50]}")
                    
                    # Update contact in HubSpot
                    if not args.dry_run and score >= 5:
                        updates = {}
                        if hs_industry:
                            updates['industry'] = hs_industry
                        if updates:
                            hs_request('PATCH', f"/crm/v3/objects/contacts/{c['id']}", hs_key,
                                       {'properties': updates})
                
                time.sleep(1.5)  # Rate limit for Claude API
        
        print(f"  Scored: {scored} contacts")

    # ── Step 6: Conference Prep Tasks for Existing Contacts ──
    conference_task_count = 0
    if args.conference_tasks:
        print(f"\n{'─' * 50}")
        print(f"Creating Conference Prep tasks for existing contacts at sponsor companies...")
        print(f"{'─' * 50}")

        for s in existing:
            if not s.get('hs_id'):
                continue
            contacts = get_company_contacts(s['hs_id'], hs_key)
            for c in contacts:
                create_conference_prep_task(c, s.get('hs_name', s['name']), args.event_name, hs_key, args.dry_run)
                conference_task_count += 1
                time.sleep(0.12)

        print(f"  Created {conference_task_count} Conference Prep tasks for sponsor contacts")

    # ── Step 7: Geographic Proximity Query ──
    geo_task_count = 0
    if args.geo_query:
        print(f"\n{'─' * 50}")
        print(f"Searching HubSpot contacts near {args.geo_city}...")
        print(f"{'─' * 50}")

        # Define nearby cities for common conference locations
        nearby_cities_map = {
            'Orlando': ['Orlando', 'Kissimmee', 'Winter Park', 'Lake Buena Vista', 'Sanford', 'Altamonte Springs'],
            'Las Vegas': ['Las Vegas', 'Henderson', 'North Las Vegas', 'Paradise'],
            'Chicago': ['Chicago', 'Evanston', 'Oak Park', 'Naperville', 'Schaumburg'],
            'Miami': ['Miami', 'Miami Beach', 'Fort Lauderdale', 'Hollywood', 'Coral Gables'],
            'Dallas': ['Dallas', 'Fort Worth', 'Plano', 'Irving', 'Arlington'],
        }
        cities = nearby_cities_map.get(args.geo_city, [args.geo_city])
        print(f"  Searching cities: {', '.join(cities)}")

        geo_contacts = search_hs_contacts_by_city(cities, hs_key)
        print(f"  Found {len(geo_contacts)} contacts in the area")

        # Create Conference Prep tasks for geo contacts (skip if already created for sponsor contacts)
        sponsor_contact_ids = set()
        if args.conference_tasks:
            for s in existing:
                if s.get('hs_id'):
                    for c in get_company_contacts(s['hs_id'], hs_key):
                        sponsor_contact_ids.add(c['id'])

        for c in geo_contacts:
            if c['id'] in sponsor_contact_ids:
                continue  # Already created task from sponsor step
            props = c.get('properties', {})
            company = props.get('company', 'Unknown Company')
            city = props.get('city', args.geo_city)
            create_conference_prep_task(c, company, args.event_name, hs_key, args.dry_run)
            geo_task_count += 1
            time.sleep(0.12)

        print(f"  Created {geo_task_count} Conference Prep tasks for geo-targeted contacts")

    # ── Step 8: AI Seed Ranking ──
    if args.ai_seeds:
        print(f"\n{'─' * 50}")
        print("Ranking top 10 seed contacts for Sales Navigator crawls...")
        print(f"{'─' * 50}")

        # Collect all contacts from existing sponsor companies
        company_ids = [s['hs_id'] for s in existing if s.get('hs_id')]
        all_contacts = get_all_company_contacts(company_ids, hs_key)
        print(f"  Collected {len(all_contacts)} contacts from {len(company_ids)} sponsor companies")

        if all_contacts and anthropic_key:
            ranked = rank_seeds_with_ai(all_contacts, sponsors, args.geo_city, anthropic_key)
            if ranked:
                print(f"\n  TOP 10 SEED CONTACTS FOR SALES NAV CRAWLS:")
                print(f"  {'─' * 60}")
                for i, seed in enumerate(ranked, 1):
                    print(f"  {i:2d}. {seed.get('name', 'N/A')}")
                    print(f"      Reason: {seed.get('reasoning', 'N/A')}")
                    # Find matching contact for LinkedIn URL
                    for c in all_contacts:
                        if c['id'] == seed.get('contactId'):
                            linkedin = c.get('properties', {}).get('hs_linkedin_url', '')
                            if linkedin:
                                print(f"      LinkedIn: {linkedin}")
                            break
                print(f"  {'─' * 60}")
            else:
                print("  AI ranking returned no results")
        else:
            print("  No contacts available for ranking (or missing API key)")

    # ── Step 9: Company List by Tier ──
    if args.company_list:
        print(f"\n{'─' * 50}")
        print("SPONSOR COMPANIES GROUPED BY TIER")
        print("(Copy-paste into Sales Navigator company filter)")
        print(f"{'─' * 50}")

        tier_order = ['Platinum', 'Diamond', 'Title', 'Host', 'Gold', 'Silver', 'Bronze', 'Unknown']
        all_sponsors_sorted = sorted(existing + new_companies, key=lambda x: (
            tier_order.index(x.get('tier', 'Unknown')) if x.get('tier', 'Unknown') in tier_order else 99,
            x['name']
        ))

        current_tier = None
        for s in all_sponsors_sorted:
            tier = s.get('tier', 'Unknown')
            if tier != current_tier:
                current_tier = tier
                print(f"\n  === {tier.upper()} ===")
            status = '✓ In HubSpot' if s.get('hs_name') else '○ New'
            print(f"    {s['name']:40s} {status}")

        print(f"\n  Total: {len(all_sponsors_sorted)} companies")

    # ── Output report ──
    print(f"\n{'=' * 70}")
    print("REPORT")
    print(f"{'=' * 70}")
    
    output_file = os.path.join(os.path.dirname(__file__), 'sponsor-report.csv')
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            'Company', 'Tier', 'Status', 'HubSpot ID', 'Domain',
            'LinkedIn URL', 'Sales Nav 2nd Degree URL', 'Contacts Count', 'Industry'
        ])
        
        all_sponsors = existing + new_companies
        for s in sorted(all_sponsors, key=lambda x: (
            {'Platinum': 0, 'Diamond': 1, 'Gold': 2, 'Silver': 3, 'Bronze': 4, 'Title': 0, 'Host': 0}.get(x.get('tier', ''), 5),
            x['name']
        )):
            writer.writerow([
                s['name'],
                s.get('tier', ''),
                'Existing' if s.get('hs_name') else 'New',
                s.get('hs_id', ''),
                s.get('hs_domain', s.get('domain', '')),
                s.get('hs_linkedin', s.get('linkedin_url', '')),
                s.get('sales_nav_url', ''),
                s.get('hs_contacts', '0'),
                s.get('hs_industry', ''),
            ])
    
    print(f"  Total sponsors:      {len(all_sponsors)}")
    print(f"  Existing in HubSpot: {len(existing)}")
    print(f"  New companies:       {len(new_companies)}")
    print(f"  Sales Nav URLs:      {nav_count}")
    if args.conference_tasks:
        print(f"  Conference tasks (sponsors): {conference_task_count}")
    if args.geo_query:
        print(f"  Conference tasks (geo):      {geo_task_count}")
    print(f"  Report saved to:     {output_file}")
    
    if args.dry_run:
        print("\n*** DRY RUN — re-run without --dry-run to apply changes ***")


if __name__ == '__main__':
    main()
