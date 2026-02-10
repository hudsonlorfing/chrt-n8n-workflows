#!/usr/bin/env python3
"""
Batch Profile Scraper Launcher

Pushes LinkedIn profile URLs to the PhantomBuster profile scraper in batches.
Reads from scraper-urls-needed.csv, writes a batch of URLs to the HoldingSheet,
launches PhantomBuster, and waits for completion before the next batch.

Usage:
  # Preview what would be sent (no changes):
  python3 batch-scraper.py --dry-run

  # Send batch 1 (profiles 1-10):
  python3 batch-scraper.py --batch 1

  # Send batch 2 (profiles 11-20):
  python3 batch-scraper.py --batch 2

  # Custom batch size (default 10):
  python3 batch-scraper.py --batch 1 --size 5

  # Show all batches and status:
  python3 batch-scraper.py --status

  # Run next unprocessed batch automatically:
  python3 batch-scraper.py --next
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import time
import urllib.request


# ─── Config ──────────────────────────────────────────────────────────────────

URLS_FILE = os.path.join(os.path.dirname(__file__), 'scraper-urls-needed.csv')
PROGRESS_FILE = os.path.join(os.path.dirname(__file__), 'scraper-batch-progress.json')
HOLDING_SHEET_ID = '1xPgob7BwDoDGAOtDPBTvKzhQHl2FUZkJhJG0gEHWdgo'
HOLDING_SHEET_URL = f'https://docs.google.com/spreadsheets/d/{HOLDING_SHEET_ID}/edit?gid=0#gid=0'
HOLDING_SHEET_WRITER_URL = 'https://script.google.com/macros/s/AKfycbwisRXZyVgX0ia_aRndo6frEpyQEMZcq7Xqoz9lENlZm3RTI-G4Ejpn9GvLc649ECs/exec'
PB_AGENT_ID = '3627182471241497'
PB_API_URL = 'https://api.phantombuster.com/api/v2/agents/launch'
DEFAULT_BATCH_SIZE = 10


# ─── Helpers ─────────────────────────────────────────────────────────────────

def get_secret(name):
    """Fetch a secret from Doppler."""
    result = subprocess.run(
        ['doppler', 'secrets', 'get', name, '--plain'],
        capture_output=True, text=True, timeout=30
    )
    val = result.stdout.strip()
    if not val:
        print(f"ERROR: Could not fetch {name} from Doppler")
        sys.exit(1)
    return val


def load_urls():
    """Load profile URLs from the CSV file."""
    if not os.path.exists(URLS_FILE):
        print(f"ERROR: URLs file not found at {URLS_FILE}")
        print("Run enrich.py first to generate the list.")
        sys.exit(1)

    profiles = []
    with open(URLS_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            url = (row.get('linkedInProfileUrl') or '').strip()
            name = (row.get('fullName') or '').strip()
            hs_id = (row.get('hubspotId') or '').strip()
            if url:
                profiles.append({'url': url, 'name': name, 'hs_id': hs_id})
    return profiles


def load_progress():
    """Load batch progress tracker."""
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, 'r') as f:
            return json.loads(f.read())
    return {'completed_batches': [], 'last_batch': 0}


def save_progress(progress):
    """Save batch progress tracker."""
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(progress, f, indent=2)


def write_urls_to_sheet(urls):
    """Write URLs to the HoldingSheet via Apps Script (clears sheet first, then writes)."""
    print(f"  Writing {len(urls)} URLs to HoldingSheet via Apps Script...")

    if not HOLDING_SHEET_WRITER_URL:
        print("  ERROR: HOLDING_SHEET_WRITER_URL is not set.")
        print("  Deploy scripts/apps-script/holding-sheet-writer.js and set the URL above.")
        # Fallback: write to local CSV
        batch_file = os.path.join(os.path.dirname(__file__), 'current-batch.csv')
        with open(batch_file, 'w') as f:
            f.write('linkedInProfileUrl\n')
            for u in urls:
                f.write(f"{u}\n")
        print(f"  Fallback: saved URLs to {batch_file}")
        print(f"  Paste into: {HOLDING_SHEET_URL}")
        return False

    payload = json.dumps({'urls': urls}).encode('utf-8')
    req = urllib.request.Request(
        HOLDING_SHEET_WRITER_URL,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode())
            if result.get('ok'):
                print(f"  ✓ Wrote {result.get('count')} URLs to HoldingSheet")
                return True
            else:
                print(f"  ERROR from Apps Script: {result.get('error')}")
                return False
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  ERROR writing to sheet: {e.code} - {err[:300]}")
        return False
    except Exception as e:
        print(f"  ERROR writing to sheet: {e}")
        return False


def launch_phantombuster(pb_key, num_profiles):
    """Launch the PhantomBuster profile scraper agent."""
    print(f"  Launching PhantomBuster agent {PB_AGENT_ID} for {num_profiles} profiles...")

    # Fetch LinkedIn session cookie from Doppler
    session_cookie = get_secret('LINKEDIN_HUDSON_SESSION_COOKIE')
    user_agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'

    payload = {
        "id": PB_AGENT_ID,
        "manualLaunch": True,
        "bonusArgument": {
            "sessionCookie": session_cookie,
            "userAgent": user_agent,
            "spreadsheetUrl": HOLDING_SHEET_URL,
            "columnName": "linkedInProfileUrl",
            "emailChooser": "phantombuster",
            "emailDiscovery": True,
            "enrichWithCompanyData": True,
            "numberOfAddsPerLaunch": num_profiles,
        }
    }

    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        PB_API_URL,
        data=data,
        headers={
            'X-Phantombuster-Key': pb_key,
            'Content-Type': 'application/json',
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
            container_id = result.get('containerId', 'unknown')
            print(f"  Launched! Container ID: {container_id}")
            return container_id
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  ERROR launching PhantomBuster: {e.code} - {err[:300]}")
        return None


def check_agent_status(pb_key):
    """Check if the PhantomBuster agent is currently running."""
    req = urllib.request.Request(
        f'https://api.phantombuster.com/api/v2/agents/fetch?id={PB_AGENT_ID}',
        headers={'X-Phantombuster-Key': pb_key},
        method='GET'
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
            status = result.get('lastStatus', 'unknown')
            return status
    except Exception as e:
        print(f"  Could not check agent status: {e}")
        return 'unknown'


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Batch Profile Scraper Launcher')
    parser.add_argument('--batch', type=int, help='Batch number to process (1-indexed)')
    parser.add_argument('--size', type=int, default=DEFAULT_BATCH_SIZE, help=f'Batch size (default: {DEFAULT_BATCH_SIZE})')
    parser.add_argument('--dry-run', action='store_true', help='Preview only, no changes')
    parser.add_argument('--status', action='store_true', help='Show batch status')
    parser.add_argument('--next', action='store_true', help='Run the next unprocessed batch')
    parser.add_argument('--launch', action='store_true', help='Actually launch PhantomBuster (otherwise just writes URLs)')
    args = parser.parse_args()

    profiles = load_urls()
    progress = load_progress()
    batch_size = args.size
    total_batches = (len(profiles) + batch_size - 1) // batch_size

    print(f"{'='*60}")
    print(f"Batch Profile Scraper")
    print(f"{'='*60}")
    print(f"  Total profiles needing scraper: {len(profiles)}")
    print(f"  Batch size: {batch_size}")
    print(f"  Total batches: {total_batches}")
    print(f"  Completed batches: {len(progress['completed_batches'])}")
    print()

    # ── Status mode ──
    if args.status:
        for b in range(1, total_batches + 1):
            start = (b - 1) * batch_size
            end = min(b * batch_size, len(profiles))
            batch = profiles[start:end]
            status = "DONE" if b in progress['completed_batches'] else "pending"
            names = ', '.join(p['name'] for p in batch[:3])
            if len(batch) > 3:
                names += f', ... +{len(batch)-3} more'
            print(f"  Batch {b:3d}: [{status:7s}] {len(batch):3d} profiles | {names}")
        return

    # ── Determine which batch to run ──
    if args.next:
        batch_num = progress['last_batch'] + 1
        if batch_num > total_batches:
            print("All batches complete!")
            return
        print(f"Running next batch: {batch_num}")
    elif args.batch:
        batch_num = args.batch
    elif not args.dry_run:
        print("Specify --batch N, --next, or --status")
        return
    else:
        # Dry run: show all batches
        for b in range(1, min(total_batches + 1, 6)):
            start = (b - 1) * batch_size
            end = min(b * batch_size, len(profiles))
            batch = profiles[start:end]
            print(f"  Batch {b}:")
            for p in batch:
                print(f"    {p['name']:35s} | {p['url'][:55]}")
        if total_batches > 5:
            print(f"  ... {total_batches - 5} more batches")
        return

    if batch_num < 1 or batch_num > total_batches:
        print(f"ERROR: Batch {batch_num} out of range (1-{total_batches})")
        return

    if batch_num in progress['completed_batches']:
        print(f"WARNING: Batch {batch_num} already completed. Use --batch {batch_num} to re-run anyway.")
        # Don't block re-runs, just warn

    # ── Get the batch ──
    start = (batch_num - 1) * batch_size
    end = min(batch_num * batch_size, len(profiles))
    batch = profiles[start:end]

    print(f"\n── Batch {batch_num} of {total_batches} ({len(batch)} profiles) ──")
    for p in batch:
        print(f"  {p['name']:35s} | {p['url'][:55]}")

    if args.dry_run:
        print(f"\n*** DRY RUN — no changes made ***")
        return

    # ── Write URLs to holding sheet ──
    urls = [p['url'] for p in batch]
    sheet_ok = write_urls_to_sheet(urls)

    if not sheet_ok and not args.launch:
        print(f"\n  Sheet write failed. Fix HOLDING_SHEET_WRITER_URL and retry:")
        print(f"    python3 batch-scraper.py --batch {batch_num} --launch")
        return

    if args.launch:
        if not sheet_ok:
            print("\n  ERROR: Cannot launch PhantomBuster — URLs not written to sheet.")
            print("  Fix the HOLDING_SHEET_WRITER_URL or manually paste URLs, then retry with --launch.")
            return

        # Get PhantomBuster API key
        pb_key = get_secret('PHANTOMBUSTER_API_KEY')

        # Check if agent is already running
        status = check_agent_status(pb_key)
        if status == 'running':
            print("\n  WARNING: PhantomBuster agent is currently running!")
            print("  Wait for it to finish before launching another batch.")
            return

        # Launch PhantomBuster
        container_id = launch_phantombuster(pb_key, len(batch))
        if container_id:
            # Update progress
            if batch_num not in progress['completed_batches']:
                progress['completed_batches'].append(batch_num)
            progress['last_batch'] = batch_num
            save_progress(progress)
            print(f"\n  ✓ Batch {batch_num} launched!")
            print(f"  Container: {container_id}")
            print(f"  When complete, results will be sent to WF 3.3 webhook")
            print(f"  Then run: python3 batch-scraper.py --next --launch")
    else:
        if sheet_ok:
            print(f"\n  ✓ URLs pushed to HoldingSheet")
            print(f"  Next steps:")
            print(f"    1. Launch PhantomBuster manually, OR re-run with --launch flag:")
            print(f"       python3 batch-scraper.py --batch {batch_num} --launch")
            print(f"    2. Wait for completion, then run next batch:")
            print(f"       python3 batch-scraper.py --next --launch")

        # Update progress
        if batch_num not in progress['completed_batches']:
            progress['completed_batches'].append(batch_num)
        progress['last_batch'] = batch_num
        save_progress(progress)


if __name__ == '__main__':
    main()
