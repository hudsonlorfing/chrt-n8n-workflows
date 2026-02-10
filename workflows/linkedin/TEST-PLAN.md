# V2 Workflow Test Plan — Sequential Execution

All 8 workflows tested one by one. Complete each test and confirm before moving to the next.

## Pre-flight Checklist

- [ ] All 8 workflows are in the v2 n8n folder (`2jLRsHZHvwPztxt4`)
- [ ] Apps Script deployments are live:
  - ICP Scoring (async): `AKfycbzN2kwN4O6QgDpkLVZkyfW4y1zckE4cOOS9hlrle8hMnYLDPOUsmbII59-_9zjqGjM55Q` — used by 1.0
  - Batch Update (outreach): `AKfycbwNmYEcjOQd0Nj0Qr0cS6oZ3E15Th0E4WxTu0vV_lHHZ-fMd_B-xgSBxeYBupxGJDDl2A` — used by 2.2
  - connectionFrom Update: `AKfycby1Hm9osn5EZzMx5_ndmb6-BzSqT53pWFuFpXBB7_0h9gD3b4c4cI8wY2ydIrY30fIKxw` — used by 4.2
- [ ] `DOPPLER_SERVICE_KEY` is set in the ICP Scoring Apps Script project
- [ ] Google Sheets credentials (`hf9VoWnqYNXhUZsn`) are accessible from the v2 workflows
- [ ] PhantomBuster credentials (`UYQpQC8SBIqIkifM`) are accessible from the v2 workflows
- [ ] HubSpot credentials (`3JZVnZQkHgMfXMRx`) are accessible from the v2 workflows
- [ ] Slack credentials are accessible from 2.2 (for critical error alerts)
- [ ] **All 8 workflows are INACTIVE** (we test via manual trigger or curl)

## Webhook Path Reference

| Workflow | Path | Full URL |
|----------|------|----------|
| 1.0 | `lead-ingestion` | `https://chrt.app.n8n.cloud/webhook/lead-ingestion` |
| 1.0 (Wait) | `webhook-waiting/b3a4c5d6-e7f8-4901-abcd-123456789012` | *(Apps Script calls this)* |
| 2.2 | `outreach-results` | `https://chrt.app.n8n.cloud/webhook/outreach-results` |
| 3.2 | `connection-sync-process` | `https://chrt.app.n8n.cloud/webhook/connection-sync-process` |
| 3.3 | `connection-sync-hubspot` | `https://chrt.app.n8n.cloud/webhook/connection-sync-hubspot` |
| 4.1 | `pipeline-monitor-crawl` | `https://chrt.app.n8n.cloud/webhook/pipeline-monitor-crawl` |
| 4.2 | `pipeline-results` | `https://chrt.app.n8n.cloud/webhook/pipeline-results` |

## n8n ID Reference

| # | n8n ID | Name |
|---|--------|------|
| 1.0 | `f4PepQxbygW1QeWZ` | 1.0 Lead Ingestion & ICP Scoring [V2] |
| 2.1 | `nfB8uIOOktCneJ2M` | 2.1 LinkedIn Outreach - Send [V2] |
| 2.2 | `X2cJpTw9nj4D9GiO` | 2.2 LinkedIn Outreach - Results [V2] |
| 3.1 | `Qts1zslbqxab1aHc` | 3.1 Connection Sync - Launch [V2] |
| 3.2 | `EjNGBdN420LQmX2M` | 3.2 Connection Sync - Process [V2] |
| 3.3 | `wKYz16GbzqWTh2DK` | 3.3 Connection Sync - HubSpot [V2] |
| 4.1 | `OVjPWkmSVnXYlQDP` | 4.1 Pipeline Monitor - Launch [V2] |
| 4.2 | `A35Yu92OFuYKvEtR` | 4.2 Pipeline Monitor - Results [V2] |

---

## Test 1: WF 1.0 — Lead Ingestion & ICP Scoring

**What it does:** Reads New Leads sheet, dedupes against Master List, sends batch to Apps Script for async Claude ICP scoring, waits for callback, reports results.

**Dependencies:** Apps Script (ICP Scoring), Google Sheets, Claude API (via Doppler)

### Setup
1. Add 2 test leads to the "New Leads" sheet with unique fake URLs:
   - `https://www.linkedin.com/in/v2-test-lead-001/` — fill in realistic name/title/company
   - `https://www.linkedin.com/in/v2-test-lead-002/` — fill in realistic name/title/company
2. Confirm these URLs do NOT exist in the "Master List"
3. Set Dashboard `kylePreProcessed` and `hudsonPreProcessed` both to `50` (below 100 → skip crawl trigger, so WF 4.1 is not fired)

### Execute
1. Open WF 1.0 (`f4PepQxbygW1QeWZ`) in n8n editor
2. Click **"Test workflow"** (manual trigger)

### Expected Flow
```
Run Manually → Determine Batch Size (10) → Read New Leads + Read Master List
→ Wait for Both Sheets → Dedupe New Leads (2 unique)
→ Has Leads to Process? (TRUE) → Limit (2 items)
→ Prepare Payload (leads + callbackUrl)
→ Score and Ingest via Apps Script (immediate ACK: { ok: true, jobId, status: 'queued' })
→ Wait for Scoring (PAUSES — execution shows "waiting")
    [background: Apps Script processJob() scores 2 leads via Claude, appends to Master List, deletes from New Leads, POSTs results to callbackUrl]
→ Wait for Scoring (RESUMES)
→ Parse Response ({ success: true, processed: 2, appended: 2, deleted: 2 })
→ Final Status
```

### Check
- [ ] `Determine Batch Size` output: `{ batchSize: 10, source: 'manual' }`
- [ ] `Prepare Payload` output includes both `leads` (array of 2) and `callbackUrl`
- [ ] `Score and Ingest` returns immediately with `{ ok: true, jobId: '...', status: 'queued' }`
- [ ] Execution pauses at `Wait for Scoring` (shows "waiting" status)
- [ ] Within ~30-60 seconds, execution resumes
- [ ] `Parse Response` shows `processed: 2, appended: 2, deleted: 2, aiErrors: 0`
- [ ] **Google Sheets:** New Leads — 2 test rows deleted
- [ ] **Google Sheets:** Master List — 2 test rows appended with `score`, `segment`, `reason`, `adj industry`
- [ ] **Google Sheets:** Jobs sheet — new row with status `complete`

### If Wait never resumes (>2 min)
- Check Apps Script execution log (Apps Script editor > Executions)
- Check Jobs sheet for status (`pending`? `processing`? `failed`?)
- Check if callbackUrl is reachable

### Cleanup
- Delete the 2 test rows from Master List
- *(leave Jobs sheet entry for reference)*

### Result: [ ] PASS / [ ] FAIL — Notes: ___

---

## Test 2: WF 4.1 — Pipeline Monitor Launch

**What it does:** Reads Dashboard metrics, decides if more leads are needed, picks a crawl URL, launches PhantomBuster Search Export.

**Dependencies:** Google Sheets (Dashboard, People to Crawl), PhantomBuster, Doppler (LinkedIn cookies)

### Setup
1. Confirm "Dashboard" sheet has `kyleTargets` < 240 and `kylePreProcessed` > 100 (so it will try to crawl for Kyle)
2. Confirm "People to Crawl" sheet has at least one URL with an empty or old `lastCrawled` date
3. **Do NOT activate this workflow** — we test via manual trigger

### Execute
1. Open WF 4.1 (`OVjPWkmSVnXYlQDP`) in n8n editor
2. Click **"Test workflow"**

### Expected Flow
```
Schedule Kyle → Set profile Kyle + Fetch Doppler cookies
→ Profile + Doppler → Build profile items with cookies → Take one profile
→ Read Dashboard Metrics → Parse Dashboard Metrics
→ Need more leads? (TRUE) → Read People to Crawl
→ Analyze URLs & Select Next → Has URL to Process? (TRUE)
→ Launch Search Export Phantom → Done - PB Launched
```

### Check
- [ ] `Parse Dashboard Metrics` shows correct counts
- [ ] `Need more leads?` takes TRUE branch
- [ ] `Analyze URLs & Select Next` picks a URL
- [ ] `Launch Search Export Phantom` successfully launches PB (returns containerId)
- [ ] `Done - PB Launched` shows success message with containerId
- [ ] PhantomBuster dashboard shows the agent running

### Note
This test fires a real PhantomBuster crawl. The results will be handled by WF 4.2 (Test 3). If you want to avoid a real PB run, check the "Need more leads?" logic by setting Dashboard values so it takes the FALSE branch (e.g., `kyleTargets` > 240), confirm it hits "Done - Skipped", then adjust values for a real run.

### Result: [ ] PASS / [ ] FAIL — Notes: ___

---

## Test 3: WF 4.2 — Pipeline Monitor Results

**What it does:** Receives PB webhook when Search Export finishes, fetches JSON results, dedupes against Master List + New Leads, appends unique profiles to New Leads, updates connectionFrom via Apps Script.

**Dependencies:** PhantomBuster (results from Test 2 or container `8302276183039757`), Google Sheets, Apps Script (connectionFrom)

### Setup — Option A: Use Test 2 results
- After Test 2's PB agent finishes, configure the PB agent to send a webhook to `https://chrt.app.n8n.cloud/webhook/pipeline-results`
- Or manually POST the webhook (see Execute below)

### Setup — Option B: Use existing test container
- Container `8302276183039757` has existing crawl data

### Execute
1. **Activate** WF 4.2 (`A35Yu92OFuYKvEtR`) so its webhook is listening
2. POST to the webhook:
```bash
curl -X POST "https://chrt.app.n8n.cloud/webhook/pipeline-results" \
  -H "Content-Type: application/json" \
  -d '{"containerId": "8302276183039757", "agentId": "YOUR_AGENT_ID", "profile": "kyle"}'
```
3. Or wait for PB to call the webhook after Test 2 finishes

### Expected Flow
```
PB Webhook → Parse Webhook Context → Get Phantom Output → Has JSON URL? (TRUE)
→ Fetch Phantom JSON → Parse Phantom Output
→ [Read Master List → Tag Master List] + [Read New Leads → Tag New Leads]
→ Merge Lists → Dedupe Against Master + New Leads
→ [Path A: unique profiles → Prepare for Append → Append to New Leads]
  + [Path B: profiles to update → Prepare connectionFrom Payload → Batch Update connectionFrom]
→ Wait for both paths → Prepare Crawl Date Update → Respond to Webhook
```

### Check
- [ ] Webhook triggers the workflow
- [ ] `Get Phantom Output` retrieves PB results
- [ ] `Dedupe Against Master + New Leads` correctly identifies unique vs existing
- [ ] Unique profiles appended to New Leads sheet
- [ ] connectionFrom updates sent to Apps Script (check response: `{ ok: true }`)
- [ ] Webhook responds successfully (200)

### Cleanup
- **Deactivate** WF 4.2 after testing

### Result: [ ] PASS / [ ] FAIL — Notes: ___

---

## Test 4: WF 2.1 — LinkedIn Outreach Send

**What it does:** Reads "Ready" leads from Master List, sorts by score, applies per-profile daily limit (ramp-up for Hudson), writes to HoldingSheet, launches PhantomBuster SendConnectionList.

**Dependencies:** Google Sheets (Master List with "Ready" leads, HoldingSheet), PhantomBuster, Doppler

### Setup
1. Confirm Master List has leads with `status = "Ready"` and no `kyleSentDate`/`hudsonSentDate`
2. If Test 1 and Test 3 ran successfully, there should be fresh leads available
3. Confirm HoldingSheet is empty (or has no leftover data)

### Execute
1. Open WF 2.1 (`nfB8uIOOktCneJ2M`) in n8n editor
2. Click **"Test workflow"** (will run the Kyle schedule path by default)

### Expected Flow
```
Schedule Kyle → Fetch Doppler cookies + Set profile Kyle
→ selectProfile → Profile + Doppler → Build profile items with cookies
→ Take one profile → Get Ready Leads → Inject profile
→ Filter Ready Leads (status=Ready, no kyleSentDate)
→ Sort by Score (Highest First) → Prepare limit (10 for Kyle)
→ Limit to 10/run → Append to HoldingSheet
→ Pass One → PhantomBuster: SendConnectionList → Done - PB Launched
```

### Check
- [ ] `Get Ready Leads` returns leads from Master List
- [ ] `Filter Ready Leads` correctly filters to unsent-by-Kyle leads
- [ ] `Sort by Score` orders highest first
- [ ] `Prepare limit` shows correct max (10 for Kyle, ramp for Hudson)
- [ ] `Append to HoldingSheet` writes profile URLs to the sheet
- [ ] `PhantomBuster: SendConnectionList` launches successfully (returns containerId)
- [ ] `Done - PB Launched` shows success with profile, containerId

### Note
This sends real LinkedIn connection requests. If you want a dry run, deactivate or disconnect the PhantomBuster node and check that everything up to "Pass One" works correctly.

### Result: [ ] PASS / [ ] FAIL — Notes: ___

---

## Test 5: WF 2.2 — LinkedIn Outreach Results

**What it does:** Receives PB webhook when SendConnectionList finishes, fetches results JSON, checks for critical errors (session expired, disconnected), batch-updates Master List via Apps Script, clears HoldingSheet.

**Dependencies:** PhantomBuster (results from Test 4), Apps Script (batch update), Google Sheets, Slack (for critical alerts)

### Setup
- After Test 4's PB agent finishes, configure it to webhook `https://chrt.app.n8n.cloud/webhook/outreach-results`
- Or manually POST (see Execute)

### Execute
1. **Activate** WF 2.2 (`X2cJpTw9nj4D9GiO`) so its webhook is listening
2. Wait for PB to call the webhook, or manually POST:
```bash
curl -X POST "https://chrt.app.n8n.cloud/webhook/outreach-results" \
  -H "Content-Type: application/json" \
  -d '{"containerId": "CONTAINER_FROM_TEST_4", "agentId": "YOUR_AGENT_ID", "profile": "kyle"}'
```

### Expected Flow
```
PB Webhook → Parse Webhook → Fetch PB Result → Parse Result
→ Critical Error? (FALSE — no session/disconnect errors)
→ Fetch PB Results JSON → Prepare Updates
→ Batch Update Master List (Apps Script: sets kyleSentDate + inviteResults)
→ Clear HoldingSheet → Respond to Webhook
```

### Check
- [ ] Webhook triggers the workflow
- [ ] `Parse Result` correctly identifies no critical errors
- [ ] `Fetch PB Results JSON` retrieves the full JSON
- [ ] `Prepare Updates` maps results to Master List updates
- [ ] `Batch Update Master List` Apps Script returns `{ ok: true }`
- [ ] Master List rows updated with `kyleSentDate` and `inviteResults`
- [ ] HoldingSheet is cleared
- [ ] Webhook responds 200

### Error Path Test (Optional)
To test the critical error path, manually POST a fake webhook with error data:
```bash
curl -X POST "https://chrt.app.n8n.cloud/webhook-test/outreach-results" \
  -H "Content-Type: application/json" \
  -d '{"containerId": "fake", "status": "error", "error": "Disconnected by LinkedIn"}'
```
- [ ] `Critical Error?` takes TRUE branch
- [ ] Slack alert fires
- [ ] Workflow stops cleanly

### Cleanup
- **Deactivate** WF 2.2 after testing

### Result: [ ] PASS / [ ] FAIL — Notes: ___

---

## Test 6: WF 3.1 — Connection Sync Launch

**What it does:** Launches PhantomBuster Connection Export agent to export LinkedIn connections for a profile (Kyle or Hudson).

**Dependencies:** PhantomBuster, Doppler (LinkedIn cookies)

### Execute
1. Open WF 3.1 (`Qts1zslbqxab1aHc`) in n8n editor
2. Click **"Test workflow"** (runs Kyle schedule path)

### Expected Flow
```
Schedule Kyle → Fetch Doppler cookies + Set profile Kyle
→ selectProfile → Profile + Doppler → Build profile items with cookies
→ Take one profile → Launch Connection Export → Done - Export Launched
```

### Check
- [ ] `Launch Connection Export` successfully launches PB agent (returns containerId + agentId)
- [ ] `Done - Export Launched` shows success message
- [ ] PhantomBuster dashboard shows the Connection Export agent running

### Note
This exports real LinkedIn connections. The PB agent takes ~2-5 minutes. Results feed into WF 3.2.

### Result: [ ] PASS / [ ] FAIL — Notes: ___

---

## Test 7: WF 3.2 — Connection Sync Process

**What it does:** Receives PB webhook when Connection Export finishes, fetches results, compares with pending leads in Master List, finds new connections, launches Email Scraper PB for connected profiles.

**Dependencies:** PhantomBuster (results from Test 6), Google Sheets (Master List with sent leads), PhantomBuster (Email Scraper agent)

### Setup
- Master List should have leads with `kyleSentDate` set but no `kyleConnectDate` (from Tests 4/5)
- After Test 6's PB agent finishes, configure it to webhook `https://chrt.app.n8n.cloud/webhook/connection-sync-process`

### Execute
1. **Activate** WF 3.2 (`EjNGBdN420LQmX2M`)
2. Wait for PB to call the webhook, or manually POST:
```bash
curl -X POST "https://chrt.app.n8n.cloud/webhook/connection-sync-process" \
  -H "Content-Type: application/json" \
  -d '{"containerId": "CONTAINER_FROM_TEST_6", "agentId": "CONNECTION_EXPORT_AGENT_ID", "profile": "kyle"}'
```

### Expected Flow
```
PB Webhook → Parse Webhook Context
→ [Get Connection Export Output → Fetch Connection Export JSON]
  + [Get Pending Leads → Filter Pending (Sent, Not Connected)]
→ Merge Export + Pending → Find New Connections → Extract Connected URLs
→ Has New Connections?
  → TRUE: Clear Scraper Sheet → Append URLs to Scraper Sheet → Wait for Sheet Ready
           → Launch Profile Scraper with Email → Done - Email Scraper Launched → Respond
  → FALSE: Respond - No Connections
```

### Check
- [ ] Webhook triggers the workflow
- [ ] `Get Connection Export Output` + `Fetch Connection Export JSON` retrieve results
- [ ] `Get Pending Leads` reads Master List; `Filter Pending` finds sent-but-not-connected
- [ ] `Find New Connections` cross-references export with pending list
- [ ] If new connections found:
  - [ ] URLs written to EmailScraper sheet
  - [ ] Email Scraper PB launched
- [ ] If no new connections: workflow exits cleanly
- [ ] Webhook responds 200

### Cleanup
- **Deactivate** WF 3.2 after testing

### Result: [ ] PASS / [ ] FAIL — Notes: ___

---

## Test 8: WF 3.3 — Connection Sync HubSpot

**What it does:** Receives PB webhook when Email Scraper finishes, fetches enriched profile data (with emails), responds immediately, then syncs each contact to HubSpot in a loop (search/create company, search/create/update contact, associate), updates Master List.

**Dependencies:** PhantomBuster (results from Test 7's Email Scraper), HubSpot API, Google Sheets

**Key v2 improvements over production:**
- Webhook responds IMMEDIATELY before the loop (no timeout risk)
- `Has Company Name?` gate skips company search when company is empty
- `Has Real Email?` gate skips contact search when no email (creates directly by name)
- All 6 HubSpot HTTP nodes have `onError: continueRegularOutput` (loop continues on API errors)

### Setup
- After Test 7's Email Scraper PB finishes, configure it to webhook `https://chrt.app.n8n.cloud/webhook/connection-sync-hubspot`

### Execute
1. **Activate** WF 3.3 (`wKYz16GbzqWTh2DK`)
2. Wait for PB to call the webhook, or manually POST:
```bash
curl -X POST "https://chrt.app.n8n.cloud/webhook/connection-sync-hubspot" \
  -H "Content-Type: application/json" \
  -d '{"containerId": "CONTAINER_FROM_TEST_7_SCRAPER", "agentId": "EMAIL_SCRAPER_AGENT_ID", "profile": "kyle"}'
```

### Expected Flow
```
PB Webhook → Parse Webhook Context → Get Email Scraper Output
→ Has jsonUrl? (TRUE) → Fetch Email Scraper JSON
→ Merge Connection + Email Data → Prepare HubSpot Data
→ Respond to Webhook (IMMEDIATE — returns 200 with profileCount)
→ Loop Over Items (batch size 1):
  → Process Item → Has Company Name?
    → TRUE: Search Company → Company Exists?
      → Yes: Use Existing Company
      → No: Create Company → Store New Company ID
    → FALSE: Skip Company (companyId=null)
  → Merge Company Results → Has Real Email?
    → TRUE: Search Contact → Contact Exists?
      → Yes: Update Contact
      → No: Create Contact
    → FALSE: Create Contact (by name only)
  → Merge Contact Results → Associate Contact → Company
  → Format Output → Update HubSpot Status → Back to Loop
→ Sync Complete
```

### Check
- [ ] Webhook triggers the workflow
- [ ] `Fetch Email Scraper JSON` retrieves enriched profiles
- [ ] `Prepare HubSpot Data` formats correctly
- [ ] **Webhook responds immediately** with `{ ok: true, profileCount: N }` (before loop starts)
- [ ] For profiles WITH company name:
  - [ ] `Has Company Name?` takes TRUE branch
  - [ ] Company searched/created in HubSpot
- [ ] For profiles WITHOUT company name:
  - [ ] `Has Company Name?` takes FALSE (Skip Company)
  - [ ] Company step skipped, companyId = null
- [ ] For profiles WITH real email:
  - [ ] `Has Real Email?` takes TRUE branch
  - [ ] Contact searched by email, then created/updated
- [ ] For profiles WITHOUT email:
  - [ ] `Has Real Email?` takes FALSE branch
  - [ ] Contact created directly by name (no email search)
- [ ] If a HubSpot API call fails (e.g. 409 conflict), loop continues to next profile
- [ ] Master List updated with `hubspotSync` status and `kyleConnectDate`

### Note
This creates/updates real HubSpot records. Review the `Prepare HubSpot Data` output before letting the loop run to confirm the data looks correct. If testing with fake data, you may want to delete test records from HubSpot afterward.

### Cleanup
- **Deactivate** WF 3.3 after testing

### Result: [ ] PASS / [ ] FAIL — Notes: ___

---

## Test Execution Order Summary

Run tests in this order. Each test builds on the previous:

| # | Workflow | Trigger | Depends On | Activates PB? |
|---|----------|---------|------------|---------------|
| 1 | **1.0** Lead Ingestion | Manual (Test workflow) | Apps Script only | No |
| 2 | **4.1** Pipeline Monitor Launch | Manual (Test workflow) | Sheets + PB | Yes — Search Export |
| 3 | **4.2** Pipeline Monitor Results | Webhook (curl or PB callback from #2) | PB results from #2 | No |
| 4 | **2.1** LinkedIn Outreach Send | Manual (Test workflow) | Leads in Master List from #1/#3 | Yes — SendConnectionList |
| 5 | **2.2** LinkedIn Outreach Results | Webhook (curl or PB callback from #4) | PB results from #4 | No |
| 6 | **3.1** Connection Sync Launch | Manual (Test workflow) | PB | Yes — Connection Export |
| 7 | **3.2** Connection Sync Process | Webhook (curl or PB callback from #6) | PB results from #6, sent leads from #4/#5 | Yes — Email Scraper |
| 8 | **3.3** Connection Sync HubSpot | Webhook (curl or PB callback from #7) | PB results from #7 | No |

### Activation Checklist

Before each webhook-triggered test, activate the receiving workflow. After testing, deactivate it.

| When Testing | Activate | Deactivate After |
|-------------|----------|-----------------|
| Test 3 (4.2) | `A35Yu92OFuYKvEtR` | Yes |
| Test 5 (2.2) | `X2cJpTw9nj4D9GiO` | Yes |
| Test 7 (3.2) | `EjNGBdN420LQmX2M` | Yes |
| Test 8 (3.3) | `wKYz16GbzqWTh2DK` | Yes |

---

## Quick Commands

```bash
# Set API key
export N8N_API_KEY="$(doppler secrets get N8N_API_KEY --plain)"

# Activate a workflow
./scripts/n8n-ops/debug.sh activate <workflow_id>

# Deactivate a workflow
./scripts/n8n-ops/debug.sh deactivate <workflow_id>

# Check recent executions for a workflow
WORKFLOW_ID=<workflow_id> ./scripts/n8n-ops/debug.sh list 5

# Get execution summary
./scripts/n8n-ops/debug.sh execution <execution_id>

# Get specific node data (safe for small nodes)
./scripts/n8n-ops/debug.sh node <execution_id> "Node Name"
```
