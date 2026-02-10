# n8n Workflow Development Process

## Pre-Flight Checklist (Run Before Every Session)

Before making ANY changes to workflows, run the sync script:

```bash
cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows
./scripts/n8n-ops/sync.sh preflight
```

This will:
1. Pull latest changes from GitHub
2. Check for uncommitted local changes
3. Fetch latest workflow versions from n8n
4. Check recent executions for errors
5. Display sync status

## Quick Commands

```bash
# Full pre-flight check
./scripts/n8n-ops/sync.sh preflight

# Pull from GitHub only
./scripts/n8n-ops/sync.sh pull

# Sync FROM n8n to local (download latest)
./scripts/n8n-ops/sync.sh download

# Push local changes to n8n
./scripts/n8n-ops/sync.sh push

# Check recent executions for errors
./scripts/n8n-ops/sync.sh errors

# Full status report
./scripts/n8n-ops/sync.sh status
```

## Workflow Development Flow

### 1. Start of Session
```bash
./scripts/n8n-ops/sync.sh preflight
```

### 2. Making Changes
- Edit workflow JSON files locally in Cursor
- Or edit in n8n UI, then download:
  ```bash
  ./scripts/n8n-ops/sync.sh download
  ```

### 3. Testing Changes
```bash
# Update workflow in n8n
./scripts/n8n-ops/debug.sh update <file> <workflow_id>

# Activate for testing
./scripts/n8n-ops/debug.sh activate <workflow_id>

# Trigger via webhook or manual
./scripts/n8n-ops/debug.sh trigger

# Check execution results
./scripts/n8n-ops/debug.sh list 5
./scripts/n8n-ops/debug.sh full <execution_id>
```

### 4. Committing Changes
```bash
git add -A
git commit -m "Description of changes"
git push origin main
```

### 5. End of Session
```bash
./scripts/n8n-ops/sync.sh status
```

## Workflow IDs Reference

| Workflow | ID | Project |
|----------|----|----|
| Chrt GitHub Workflow Sync | `r4ICnvhdbQwejSdH` | ChrtWorkflows |
| 1. Lead Ingestion & ICP Scoring | `aLxwvqoSTkZAQ3fq` | ChrtWorkflows |
| 2. LinkedIn Outreach (PhantomBuster) | `kjjYKQEXv67Vl5MS` | ChrtWorkflows |
| 3. Connection Sync → HubSpot | `a56vnrPo9dsg5mmf` | ChrtWorkflows |
| 4. Lead Pipeline Monitor | `dWFsEXELFTJU0W01` | ChrtWorkflows |
| Waitlist Signup Intake | *(import to get ID)* | ChrtWorkflows |
| Waitlist Qualified Booked | *(import to get ID)* | ChrtWorkflows |

## Waitlist workflows

Waitlist workflows live in `workflows/waitlist/`. They follow the same test-then-production pattern as LinkedIn workflows.

**Webhook paths:**
- Waitlist Signup Intake: `waitlist-signup` (receives Clerk `waitlistEntry.created` webhooks)
- Waitlist Qualified Booked: `waitlist-calendly-booked` (receives Calendly `invitee.created` webhooks)

**Testing:** Isolated in `workflows/waitlist/testing/`. See `workflows/waitlist/testing/README.md` for full setup guide (HubSpot properties, Doppler secrets, Calendly routing form, test curl commands).

**Import to test folder:**
```bash
./scripts/n8n-ops/debug.sh import-to-test workflows/waitlist/testing/waitlist-signup-intake.json
./scripts/n8n-ops/debug.sh import-to-test workflows/waitlist/testing/waitlist-qualified-booked.json
```

Move imported workflows to test folder in n8n UI, then update workflow IDs in this file and CLAUDE.md.

**Push to production (after testing):**
```bash
./scripts/n8n-ops/debug.sh update workflows/waitlist/waitlist-signup-intake.json <WORKFLOW_A_ID>
./scripts/n8n-ops/debug.sh update workflows/waitlist/waitlist-qualified-booked.json <WORKFLOW_B_ID>
```

## LinkedIn workflows: test folder then production

Test LinkedIn workflows (e.g. Doppler-based Connection Sync) in the **Chrt test folder** before updating production.

1. **Import to Chrt project (for testing)**  
   Creates new workflow(s) in the Chrt project; you then move them into the test folder in the n8n UI.
   ```bash
   ./scripts/n8n-ops/debug.sh import-to-test
   ```
   Or a single file:
   ```bash
   ./scripts/n8n-ops/debug.sh import-to-test workflows/linkedin/3.2-connection-sync-process.json
   ```

2. **Move to test folder**  
   Open the test folder and move each imported workflow into it (n8n API does not set folderId):
   - **Test folder**: https://chrt.app.n8n.cloud/projects/O7lTivDfRl72aS23/folders/B94lBTvcz1TgfA0l/workflows

3. **In each test workflow**  
   Set the **Doppler API** credential on the “Fetch Doppler cookies” node (Connection Sync), then run tests (see step 4).

4. **Keep everything in the test folder**  
   While testing, use only the **test** workflow IDs so updates and executions stay in the test folder (no new workflows in the broader project):
   - **Push local changes to test folder:**  
     `./scripts/n8n-ops/debug.sh update-linkedin-test` — updates the workflows already in the test folder. **Prefers** files in `workflows/linkedin/testing/` when present (isolated edits), else uses main folder.
   - **Run tests:**  
     `./scripts/n8n-ops/debug.sh run-linkedin-test` — triggers Connection Sync (test) via webhook `connection-sync-test`; executions stay in the test folder. **Test workflow must be active** so it receives the webhook.  
     To list recent test executions: `WORKFLOW_ID=wjlyzhs95MWvnTAt ./scripts/n8n-ops/debug.sh list 5`
   - Do **not** run `import-to-test` again during testing (that would create new workflows in the project). Use `update-linkedin-test` for any local edits.

5. **When ready, promote to main and push to production**  
   Copy testing folder to main (overwrites production workflow files with correct ids), then update production in n8n:
   ```bash
   ./scripts/n8n-ops/debug.sh promote-linkedin-to-main
   ./scripts/n8n-ops/debug.sh push-linkedin-to-prod
   ```
   This updates workflow `a56vnrPo9dsg5mmf` (Connection Sync), `dWFsEXELFTJU0W01` (Lead Pipeline Monitor), and `kjjYKQEXv67Vl5MS` (2. LinkedIn Outreach) when their files exist in main. Activate in n8n if needed.

### Testing folder (isolated edits, like a branch)

- **Repo path:** `workflows/linkedin/testing/` — work on workflow JSON here so the **main** folder stays untouched until you promote.
- **Preflight:** Pull the latest from n8n before editing: `./scripts/n8n-ops/debug.sh download wjlyzhs95MWvnTAt`, then copy to `workflows/linkedin/testing/3.-connection-sync-→-hubspot.json` (or save there directly). Edit in the testing folder.
- **Push to n8n test:** `update-linkedin-test` uses files in `workflows/linkedin/testing/` when they exist, so your isolated changes go to the n8n test folder only.
- **Finalize:** When tests pass, run `promote-linkedin-to-main` then `push-linkedin-to-prod`. See `workflows/linkedin/testing/README.md`.

**Test folder workflow IDs** (use these for all testing so executions stay in the test folder):

| Workflow | Test ID |
|----------|---------|
| 1. Lead Ingestion & ICP Scoring (TEST) | `MQantT1gLLP8NEn4` |
| 2. LinkedIn Outreach (PhantomBuster) [TEST] | `RdeXvr6pEAFkOpwN` |
| 3. Connection Sync → HubSpot | `wjlyzhs95MWvnTAt` |
| 4. Lead Pipeline Monitor (TEST) | `atJokUdeDsap4lJO` |

When test copies exist in the n8n test folder, `update-linkedin-test` updates those test workflows (set `LEAD_INGESTION_TEST_ID` and/or `PIPELINE_MONITOR_TEST_ID` in `scripts/n8n-ops/debug.sh`). Promote/push updates workflow 1, 3, and 4 when their testing files exist. Lead Pipeline Monitor (production) uses the same two-schedule + Doppler pattern (Kyle/Hudson) as Connection Sync: Schedule Kyle (6:00 AM), Schedule Hudson (6:05 AM), Set profile nodes, Fetch Doppler cookies, Profile + Doppler merge, Build profile items, Take one profile, then Read Dashboard Metrics and the rest of the flow.

### Connection Sync: promoted to production 2026-02-02

Connection Sync was promoted to production on **2026-02-02**. The source was the n8n test workflow (ID `wjlyzhs95MWvnTAt`) after reactivating nodes. Production workflow ID: `a56vnrPo9dsg5mmf`. Resume runs follow the [execution 1051 pattern](#resume-run-no-phantombuster-re-runs--execution-1051-pattern) (webhook + deactivated PhantomBuster nodes) documented in the section below.

### 2. LinkedIn Outreach: batch update via Apps Script (TEST in progress)

Workflow 2 (LinkedIn Outreach) was promoted to production on **2026-02-02** (ID: `kjjYKQEXv67Vl5MS`). The **TEST** version (`RdeXvr6pEAFkOpwN`) is being refactored to eliminate all loops:

- **Holding sheet pattern:** Workflow appends all `defaultProfileUrl` values to HoldingSheet Sheet2 (`1xPgob7BwDoDGAOtDPBTvKzhQHl2FUZkJhJG0gEHWdgo`, gid=2051829261), then launches PhantomBuster once reading from Sheet2. No per-item loop.
- **Batch Master List update:** After PB finishes, `Parse Result1` extracts the S3 JSON URL from output, `Fetch PB Results JSON` GETs per-profile results, `Prepare Updates` maps them into a payload, and `Batch Update Master List` POSTs to a **Google Apps Script** web app (see `scripts/apps-script/batch-update.js`). The script finds rows by `defaultProfileUrl` and writes `kyleSentDate`/`hudsonSentDate` + `inviteResults`. No loop in n8n.
- **Master sheet:** Uses **defaultProfileUrl** for matching.
- **Kyle:** 16–22 connection requests per day = **8–11 per run** (2 runs/day). Prepare limit: `8 + Math.floor(Math.random() * 4)`.
- **Hudson:** Ramp from **8–12 per day** at start to **16–22 per day** over 30 days. Per run: 4–6 at start, 8–11 at end (same random pattern). Ramp start date in Prepare limit: 2026-02-10.
- **Apps Script deployment:** Deploy `scripts/apps-script/batch-update.js` as a Google Apps Script web app ("Execute as me", "Anyone" access). Set the deployed URL in the `Batch Update Master List` node's URL field or via `APPS_SCRIPT_BATCH_UPDATE_URL` env var.
- **Profile Not Found (non-critical):** PhantomBuster output like "Profile is unavailable" is classified per-profile in the results JSON. The Apps Script writes the status per row.
- **Test workflow:** `RdeXvr6pEAFkOpwN` (in test folder). Production: `kjjYKQEXv67Vl5MS`.

### Lead Pipeline Monitor: promoted to production 2026-02-02

Lead Pipeline Monitor (two-profile Kyle/Hudson, Doppler cookies, profile-aware dedupe, dashboard metrics) was promoted to production on **2026-02-02**. The source was the n8n test workflow (ID `f49o0W3pVK51PX87`). Production workflow ID: `dWFsEXELFTJU0W01`. The test copy was deleted from the Testing folder in n8n and the local file `workflows/linkedin/testing/4.-lead-pipeline-monitor.json` was removed. To test workflow 4 again in isolation: run `import-to-test` with the main `4.-lead-pipeline-monitor.json`, move the new workflow into the test folder in the n8n UI, set `PIPELINE_MONITOR_TEST_ID` in `scripts/n8n-ops/debug.sh` to the new workflow ID, then work in `workflows/linkedin/testing/` and use `update-linkedin-test`. To delete a test workflow after promoting: `./scripts/n8n-ops/debug.sh delete <workflow_id>`.

### Successful test runs (test folder)

| Execution | Workflow | Status | Date |
|-----------|----------|--------|------|
| 1149 | 1. Lead Ingestion & ICP Scoring (TEST) | success | 2026-02-04 |
| 1145 | 4. Lead Pipeline Monitor (TEST) | success | 2026-02-04 |
| 1232 | 1. Lead Ingestion & ICP Scoring - Apps Script TEST | success | 2026-02-05 |

Full execution data: `./scripts/n8n-ops/debug.sh full 1149` and `full 1145` (with `N8N_API_KEY` set).

### Workflow 1 (Lead Ingestion): Apps Script batch scoring (TEST in progress)

**Workflow 1 (Lead Ingestion & ICP Scoring)** now runs on a **schedule** every 30 minutes and processes **25 profiles per run** to avoid timeouts:

- **Schedule trigger** — Cron `0,30 * * * *` (at :00 and :30 each hour). Each run reads the **Dashboard** sheet (same spreadsheet) for `kylePreProcessed`, `hudsonPreProcessed`, `kyleTargets`, `hudsonTargets`.
- **Guard** — If **both** Kyle and Hudson have pre-processed &lt; 100, the run **skips** (no Read New Leads/Master List, no AI). Otherwise it continues.
- **Crawl: one per run, prefer priority, fallback when maxed out** — Exactly **one** crawl is triggered per run. The **priority** profile (the one with **fewer** targets) is chosen first. When the priority profile is **maxed out** (no additional profiles to process or no URLs to crawl — implemented as priority `targets === 0` or priority `preProcessed >= 100`), workflow 1 triggers the **other** profile’s crawl instead so we still run for the other person. So: **crawl for priority** when priority has targets &lt; 240, preProcessed &lt; 100, **and** targets &gt; 0; **else crawl for other** when the other profile has targets &lt; 240 and preProcessed &lt; 100; otherwise no crawl. Once both have ≥240 targets, no crawl is ever triggered (no over-run).
- **Limit node** — Uses `batchSize` from Determine Batch Size (25 for schedule, 10 for manual, webhook body if provided) instead of a fixed value.
- **Manual and webhook** — Still available; manual uses batch 10, webhook uses `batchSize` from the request body.

**Loop replaced with Apps Script (TEST `Iq6zXDU0cW0xCXOa`):** The old `SplitInBatches` loop (Loop Over Leads1 -> AI ICP Score -> Format -> Wait -> Add to Master List -> Find lead -> Delete new lead) is replaced with: **Prepare Payload** -> **Score and Ingest via Apps Script** (single HTTP POST, 120s timeout) -> **Parse Response** -> Final Status. The Apps Script (`scripts/apps-script/lead-ingestion.js`) handles Claude API scoring (1.5s delay between calls), batch append to Master List, and batch delete from New Leads. Doppler service token stored as Apps Script Property (`DOPPLER_SERVICE_KEY`); script fetches `ANTHROPIC_API_KEY` from Doppler at runtime.

**Note:** The `Trigger workflow 4 crawl` node in workflow 1 is **purposefully disabled** for now. It will be re-enabled once workflow 4's Apps Script changes are tested and stable.

**Workflow 4 loop replaced with Apps Script (TEST `atJokUdeDsap4lJO`):** The old `Loop Over Items` -> `Update connectionFrom to both` -> `Wait1` loop is replaced with: **Prepare connectionFrom Payload** (collects all items) -> **Batch Update connectionFrom** (single HTTP POST, 120s timeout) -> Path B done. The Apps Script (`scripts/apps-script/connection-from-update.js`) finds rows by `defaultProfileUrl` in the specified sheet (Master List or New Leads) and sets `connectionFrom = "both"`. Deploy as a separate Apps Script web app.

**Workflow 4 (Lead Pipeline Monitor)** no longer calls the lead-ingestion webhook after Phantom. Ingestion is driven only by workflow 1’s 30‑min schedule. Workflow 4 has a **new webhook** for workflow 1 to trigger a crawl for a specific profile:

- **Webhook** — `POST /webhook/pipeline-monitor-crawl` with body `{ "profile": "kyle" | "hudson" }`. Runs the same crawl path (Fetch Doppler, Read People to Crawl, Analyze URLs, Launch Phantom, etc.) for that profile only. Used when workflow 1’s **Choose crawl profile** node picks that profile (priority when they have work, or the other profile when priority is maxed out).

### Connection Sync: two schedules, 5 min apart (Kyle then Hudson)

Connection Sync runs **twice per day** with a 5-minute stagger, one execution per profile:

- **Schedule Kyle** — 6:00 PM Mon–Sat (cron `0 18 * * 1-6`) → Set profile Kyle (`profileIndex: 0`) → Fetch Doppler + **Profile + Doppler** (Merge) → Build profile items → **Take one profile** (selects by `profileIndex`) → PhantomBuster (Kyle).
- **Schedule Hudson** — 6:05 PM Mon–Sat (cron `5 18 * * 1-6`) → Set profile Hudson (`profileIndex: 1`) → same path for Hudson.
- **Manual Test Webhook** (`connection-sync-test`) → Set profile for manual (round-robin by day) → same path.

Profile selection uses the **Profile + Doppler** Merge (combine-by-position): trigger output (`profileIndex`) is merged with Doppler response; **Take one profile** reads `$('Profile + Doppler').first().json.profileIndex` and returns that profile (or round-robin by day if missing).

### Resume run (no PhantomBuster re-runs) — execution 1051 pattern

To complete a run using **existing data** without re-launching PhantomBuster agents (e.g. after a timeout or when resuming from Merge Connection + Email Data):

1. **Trigger via webhook** — POST to **test-from-merge** with a `body` array of profile items (connection + email data). Use `./scripts/n8n-ops/debug.sh resume <execution_id> [--exclude-completed]` to extract from a previous execution and POST, or build the payload from execution data (e.g. Merge Connection + Email Data + Find New Connections2 combined; include `profile: "kyle"` or `"hudson"` per item).
2. **Deactivate PhantomBuster nodes** in n8n so the workflow does not launch or wait on agents: **kyleConnectionExport2**, **Launch Profile Scraper with Email**, **Check Email Scraper Status**, **Get Email Scraper Output**, **Check PB Agent Running?**, and related Wait nodes (e.g. **Wait 10 min for Email Scraper**) if you are injecting scraper output via the webhook body. Leave active: **Test Webhook: From Merge**, **Merge Connection + Email Data**, **Prepare HubSpot Data**, **Loop Over Items**, and the rest of the HubSpot/Format Output/Update HubSpot Status1 path.
3. **Reference execution 1051** — Execution 1051 (2026-02-03, success) is the reference run. When PhantomBuster nodes are deactivated, only the path from the webhook through Merge Connection + Email Data → Prepare HubSpot Data → Loop Over Items → … → Format Output → Update HubSpot Status1 runs; no additional PhantomBuster runs are needed unless there was an error in that path. Data flows from the webhook body only.

## V2 Split Workflows (Wait-Node-Free)

All LinkedIn workflows have been split into launch (.1) and results (.2/.3) sub-workflows connected by PhantomBuster webhooks, eliminating all Wait nodes and long polling loops. V2 workflows are the **primary** workflows at `workflows/linkedin/`. Old monolithic workflows are archived in `workflows/linkedin/archive/`.

**V2 test folder in n8n:** `2jLRsHZHvwPztxt4`  
URL: `https://chrt.app.n8n.cloud/projects/O7lTivDfRl72aS23/folders/2jLRsHZHvwPztxt4/workflows`

### V2 Workflow Files

| File | n8n ID | Description |
|------|--------|-------------|
| `1.0-lead-ingestion-icp-scoring.json` | `f4PepQxbygW1QeWZ` | WF1: Read new leads, dedupe, async ICP scoring via Apps Script, wait for callback |
| `2.1-linkedin-outreach-send.json` | `nfB8uIOOktCneJ2M` | WF2 launch: select leads, write to holding sheet, launch PB |
| `2.2-linkedin-outreach-results.json` | `X2cJpTw9nj4D9GiO` | WF2 results: PB webhook → parse → batch update → clear sheet |
| `3.1-connection-sync-launch.json` | `Qts1zslbqxab1aHc` | WF3 launch: launch connection export PB |
| `3.2-connection-sync-process.json` | `EjNGBdN420LQmX2M` | WF3 process: PB webhook → find new connections → launch email scraper |
| `3.3-connection-sync-hubspot.json` | `wKYz16GbzqWTh2DK` | WF3 HubSpot: email scraper webhook → merge data → HubSpot sync |
| `4.1-pipeline-monitor-launch.json` | `OVjPWkmSVnXYlQDP` | WF4 launch: read dashboard, launch PB crawl |
| `4.2-pipeline-monitor-results.json` | `A35Yu92OFuYKvEtR` | WF4 results: PB webhook → process crawl results → update sheets |

### V2 Architecture

```
Original:  Trigger -> ... -> Launch PB -> [Wait 10-20 min] -> Fetch Results -> Process
V2 Split:
  .1 workflow: Trigger -> ... -> Launch PB -> Done (immediate, <30s)
  .2 workflow: PB Webhook -> Fetch Results -> Process -> Done
```

### Workflow 1: Async Apps Script ICP Scoring

Workflow 1 (`Iq6zXDU0cW0xCXOa`) uses an async Apps Script pattern instead of a split:
- `Prepare Payload` includes `callbackUrl` (n8n Wait node resume webhook)
- `Score and Ingest via Apps Script` POSTs leads + callbackUrl to Apps Script
- `Wait for Scoring` node (webhook resume) pauses the workflow
- Apps Script `processJob()` runs in background (30-min limit), POSTs results back to callbackUrl
- Batch cap: 250 leads per run

Apps Script: `scripts/apps-script/lead-ingestion.js` (async mode with Jobs sheet + time-driven trigger).

### Test Container for 4.2

Container `8302276183039757` is available to test 4.2 (pipeline monitor results) with existing crawl data.

## Project Info

- **Project ID**: `O7lTivDfRl72aS23`
- **Project Name**: ChrtWorkflows
- **Test folder** (LinkedIn): https://chrt.app.n8n.cloud/projects/O7lTivDfRl72aS23/folders/B94lBTvcz1TgfA0l/workflows
- **V2 test folder** (LinkedIn): https://chrt.app.n8n.cloud/projects/O7lTivDfRl72aS23/folders/2jLRsHZHvwPztxt4/workflows
- **n8n URL**: https://chrt.app.n8n.cloud
- **GitHub Repo**: https://github.com/hudsonlorfing/chrt-n8n-workflows

## Conflict Resolution

If you see conflicts between local/GitHub/n8n:

1. **n8n has newer changes**: Download from n8n first
   ```bash
   ./scripts/n8n-ops/sync.sh download
   ```

2. **Local has newer changes**: Push to n8n
   ```bash
   ./scripts/n8n-ops/debug.sh update <file> <workflow_id>
   ```

3. **GitHub has newer changes**: Pull first
   ```bash
   git pull origin main
   ```

4. **True conflict**: Compare timestamps and decide which version to keep

## Environment Setup

Required in `.env` file:
```
N8N_API_KEY=your-api-key-here
N8N_BASE_URL=https://chrt.app.n8n.cloud
```

## Best Practices

1. **Always run preflight** before starting work
2. **Tag testing workflows** with `#testing` until production-ready
3. **Deactivate workflows** while making changes
4. **Check executions** after deploying changes
5. **Commit frequently** to avoid losing work
6. **Document changes** in commit messages
7. **Phantom launch = single item:** Any node that feeds a PhantomBuster (or phantom) launch must pass only **one item**; otherwise n8n launches the phantom N times (one per item). Use a "Take one" / Limit (1) or Code returning `[$input.first()]` before the launch node. See `docs/linkedin-phantoms.md` and `.cursor/rules/n8n.mdc`.

## LinkedIn Cookie Refresh Checklist

When Slack shows **"LinkedIn Cookie/Session Error - Update in Doppler"** or PhantomBuster fails with invalid/session errors:

1. **Identify profile** — Message or error indicates which workflow; Connection Sync runs both Kyle and Hudson (check which run failed).
2. **Open browser** for that LinkedIn account (Chrt Gmail → Kyle; personal Gmail → Hudson).
3. **Get `li_at`** — LinkedIn → DevTools → Application → Cookies → `https://www.linkedin.com` → copy **li_at** value.
4. **Update Doppler** — chrt project → prd config: set `LINKEDIN_KYLE_SESSION_COOKIE` or `LINKEDIN_HUDSON_SESSION_COOKIE` to the new value; Save.
5. **Re-run** the workflow (no sync step — workflow pulls cookies from Doppler on each run). See [docs/linkedin-session-cookie.md](docs/linkedin-session-cookie.md) for full steps.

