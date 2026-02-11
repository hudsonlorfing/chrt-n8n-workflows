# CLAUDE.md - n8n Workflow Development Context

> **Parent Context:** See `_Shared/CLAUDE.md` in the Business repo root for overall workspace context, agent skills, and general conventions.

## Project Overview

This repository contains version-controlled n8n workflow JSON files for Chrt's automation system. We run **two n8n instances**:

| Instance | URL | Purpose |
|----------|-----|---------|
| **n8n Cloud** | https://chrt.app.n8n.cloud | LinkedIn lead gen, GitHub sync |
| **Hostinger VPS** | https://srv1230891.hstgr.cloud | Fireflies, meetings, file operations |

## Quick Start

```bash
# ALWAYS run this before starting any work
cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows
./scripts/n8n-ops/sync.sh preflight

# Sync meeting notes from GitHub to Obsidian
./scripts/legacy/sync-meetings.sh
```

## Key Configuration

### n8n Cloud (LinkedIn Workflows)

| Setting | Value |
|---------|-------|
| n8n URL | https://chrt.app.n8n.cloud |
| Project ID | `O7lTivDfRl72aS23` |
| GitHub Repo | hudsonlorfing/chrt-n8n-workflows |

### Hostinger VPS (Meeting/File Workflows)

| Setting | Value |
|---------|-------|
| VPS URL | https://srv1230891.hstgr.cloud |
| Plan | KVM 2 (8GB RAM, 2 vCPU) |
| Meeting Repo | hudsonlorfing/meeting-notes |
| SSH Access | `ssh hostinger-n8n` or `ssh root@srv1230891.hstgr.cloud` |
| n8n Data Dir | /root/.n8n |

#### SSH Configuration

We use a dedicated key for the VPS. Add to `~/.ssh/config`:
```
Host hostinger-n8n
    HostName srv1230891.hstgr.cloud
    User root
    Port 22
    IdentityFile ~/.ssh/hostinger_n8n
```

**Note:** Create the key with `ssh-keygen -t ed25519 -f ~/.ssh/hostinger_n8n -C "hostinger-n8n"`. Load in the agent when needed: `ssh-add ~/.ssh/hostinger_n8n` (passphrase stored in 1Password as "Hostinger_SSH_New").

### Workflow IDs (n8n Cloud)

**LinkedIn Pipeline (V2 — split, wait-node-free):**

| Workflow | ID | Status |
|----------|-----|--------|
| 1.0 Lead Ingestion & ICP Scoring [V2] | `f4PepQxbygW1QeWZ` | ✅ Active |
| 2.1 LinkedIn Outreach - Send [V2] | `nfB8uIOOktCneJ2M` | ✅ Active |
| 2.2 LinkedIn Outreach - Results [V2] | `X2cJpTw9nj4D9GiO` | ✅ Active |
| 3.1 Connection Sync - Launch [V2] | `Qts1zslbqxab1aHc` | ✅ Active |
| 3.2 Connection Sync - Process [V2] | `EjNGBdN420LQmX2M` | ✅ Active |
| 3.3 Connection Sync - HubSpot [V2] | `wKYz16GbzqWTh2DK` | ⚠️ Inactive |
| 4.1 Pipeline Monitor - Launch [V2] | `OVjPWkmSVnXYlQDP` | ✅ Active |
| 4.2 Pipeline Monitor - Results [V2] | `A35Yu92OFuYKvEtR` | ✅ Active |

**Maintenance & Meetings:**

| Workflow | ID | Status |
|----------|-----|--------|
| Chrt GitHub Workflow Sync | `r4ICnvhdbQwejSdH` | ✅ Active |
| 5. Error Monitor Webhook | `YWP69Qgq0ZlCN7Gj` | ⚠️ Error Trigger |
| 6. Fireflies Meeting Processor | `D8nDH8ECyadToNHp` | ✅ Active |
| 7. Slack Interaction Handler | `0PjeQ9VgbUgE5lnD` | ✅ Active |
| 8. Slack Follow-Up Agent | `9t7EPqjlUUirs2fw` | ⚠️ Inactive (needs Slack Events API) |
| 9. Google Sheets Reader (Claude Tool) | `w8FzfVMwIFAhUwNG` | ✅ Active |

**Other:**

| Workflow | ID | Status |
|----------|-----|--------|
| AI Agent workflow | `w5oCLzSqMM4qoxoX` | ⚠️ Inactive |
| Linq Blue Text Sequence | `jjbHuN9sXpjnMhUx` | ⚠️ Inactive |

### Waitlist Pipeline (n8n Cloud)

Two event-driven workflows for the Clerk waitlist → PostHog → HubSpot → Calendly → Linq pipeline.

| Workflow | ID | File | Webhook Path | Status |
|----------|-----|------|-------------|--------|
| Waitlist Signup Intake | `ClxQn8wYxggtgGzy` | `workflows/waitlist/waitlist-signup-intake.json` | `waitlist-signup` | ⬜ Inactive |
| Waitlist Qualified Booked | `FCxwjiZP1CS49w25` | `workflows/waitlist/waitlist-qualified-booked.json` | `waitlist-calendly-booked` | ⬜ Inactive |

**Secrets (Doppler chrt/prd):** `CLERK_WEBHOOK_SECRET`, `POSTHOG_PROJECT_API_KEY`, `POSTHOG_HOST`, `LINQ_INTEGRATION_TOKEN` (deferred).

**Testing:** Isolated in `workflows/waitlist/testing/`. Import with `import-to-test`, move to test folder in n8n UI. See `workflows/waitlist/testing/README.md` for full setup guide including HubSpot custom properties, Calendly routing form, and test commands.

**HubSpot custom properties required:** `clerk_waitlist_id`, `waitlist_status`, `waitlist_signup_date`, `reason_for_interest`, `qualification_form_completed`, `qualification_form_date`, `calendly_event_url`, `chrt_segment` (Dropdown: Shipper/Courier/Forwarder/Other), `chrt_lead_source` (Dropdown: LinkedIn/Waitlist/Referral/Conference/Other). See testing README for details.

**Segment Classification:** WF 3.3 classifies contacts into `chrt_segment` via: (1) Master List segment lookup via `segment-lookup.js` Apps Script, (2) Claude AI fallback using `$vars.ANTHROPIC_API_KEY` n8n variable. WF waitlist defaults to `Other`. Backfill via `scripts/hubspot/enrich.py --backfill-segment`.

### Workflows (Hostinger Self-Hosted)

| Workflow | Webhook Path | Status |
|----------|--------------|--------|
| Fireflies (VPS copy) | `/webhook/fireflies-meeting` | 🆕 Planned |

### PhantomBuster agent IDs (LinkedIn)

See [docs/linkedin-phantoms.md](docs/linkedin-phantoms.md) for agent IDs (Connections Export, Profile Scraper, Search Export, hudsonConnectExport). Profile switching validation: [docs/linkedin-validation.md](docs/linkedin-validation.md).

## Development Workflow

### 1. Making Changes

```bash
# Edit JSON locally, then push to n8n
./scripts/n8n-ops/debug.sh update <file.json> <workflow_id>

# Or edit in n8n UI, then download
./scripts/n8n-ops/sync.sh download
```

### 2. Testing

```bash
./scripts/n8n-ops/debug.sh activate <workflow_id>
./scripts/n8n-ops/debug.sh trigger <workflow_id>  # for webhook workflows
./scripts/n8n-ops/debug.sh list 5 <workflow_id>   # recent executions
./scripts/n8n-ops/debug.sh full <exec_id>          # full execution data
```

### 3. Error Analysis

```bash
# Check all workflows for errors
./scripts/legacy/auto-debug.sh check

# Analyze specific execution with Claude AI
./scripts/legacy/auto-debug.sh analyze <execution_id>
```

## Project Structure

```
chrt-n8n-workflows/
├── workflows/
│   ├── maintenance/                       # Sync, error monitoring
│   │   ├── chrt-github-workflow-sync.json
│   │   └── 5.-error-monitor-webhook.json
│   ├── meetings/                          # Meeting processing pipeline
│   │   ├── 6.-fireflies-meeting-processor.json
│   │   └── 7.-slack-interaction-handler.json
│   ├── tools/                             # Utility workflows
│   │   ├── 8.-google-sheets-reader-(claude-tool).json
│   │   └── shedpro-ai-data-discovery.json
│   ├── waitlist/                          # Waitlist pipeline
│   │   ├── waitlist-signup-intake.json
│   │   ├── waitlist-qualified-booked.json
│   │   └── testing/
│   └── linkedin/                          # V2 split workflows (active)
│       ├── 1.0-lead-ingestion-icp-scoring.json
│       ├── 2.1-linkedin-outreach-send.json
│       ├── 2.2-linkedin-outreach-results.json
│       ├── 3.1-connection-sync-launch.json
│       ├── 3.2-connection-sync-process.json
│       ├── 3.3-connection-sync-hubspot.json
│       ├── 4.1-pipeline-monitor-launch.json
│       ├── 4.2-pipeline-monitor-results.json
│       ├── README.md
│       ├── TEST-PLAN.md
│       └── archive/                       # Old monolithic workflows
├── scripts/
│   ├── apps-script/        # Google Apps Scripts (deployed to GAS)
│   │   ├── hubspot-audit.js
│   │   ├── lead-ingestion.js
│   │   ├── pipeline-dedupe.js
│   │   ├── ready-leads.js
│   │   ├── batch-update.js
│   │   └── connection-from-update.js
│   ├── hubspot/            # HubSpot Python tools
│   │   ├── enrich.py
│   │   ├── dedup.py
│   │   └── scraper-urls-needed.csv
│   ├── n8n-ops/            # n8n API & sync operations
│   │   ├── sync.sh
│   │   └── debug.sh
│   ├── sales-tooling/      # Event research, outreach automation
│   │   ├── event-sponsor-research.py
│   │   └── aircargo-2026-sponsors.csv
│   ├── tests/              # Test scripts
│   ├── autofix-service/    # AI error analysis service
│   └── legacy/             # Old/one-off utilities
├── configs/                # AI apps, workspaces, profiles
├── docs/                   # All documentation
├── executions/             # Saved execution dumps
├── test-results/           # Test logs and documentation
└── .env                    # N8N_API_KEY, N8N_BASE_URL (gitignored)
```

## Architecture Decisions

### Sync Workflow Design
- Uses GitHub Trees API for recursive file listing (replaced loop-based approach)
- Tag-based folder routing (`linkedin` tag → `workflows/linkedin/`)
- `onError: continueErrorOutput` on all GitHub nodes for resilience

### Lead Ingestion Optimization
- Replaced SQL-based Merge node with JavaScript Code node
- Uses `Set` for O(1) deduplication lookups
- Dynamic batch sizing via webhook parameter

### Error Monitoring
- Webhook filters out manual triggers automatically
- Attempts local debugger first, falls back to logging
- Returns debug command in response for manual follow-up

### Fireflies Meeting Processor (Hostinger)
- Receives webhooks from Fireflies.ai when transcription completes
- Slack prompts for workspace selection and meeting context
- Gemini AI analyzes transcript and creates structured note
- Commits to `meeting-notes` GitHub repo
- Local `sync-meetings.sh` pulls to Obsidian vaults

## Environment Variables

Required in `.env`:
```
N8N_API_KEY=your-api-key-here
N8N_BASE_URL=https://chrt.app.n8n.cloud
```

## Common Issues

### "request/body must NOT have additional properties"
The n8n API rejects read-only properties. The `n8n-debug.sh update` command automatically strips these.

### Webhook timeout (524)
Long-running workflows may timeout but continue executing. Check n8n UI for actual status.

### Git auth errors
SSH is configured for local Git operations. PAT is used only by the n8n sync workflow.

## Related Documentation

- [docs/WORKFLOW-PROCESS.md](docs/WORKFLOW-PROCESS.md) - Full development workflow
- [docs/STATUS.md](docs/STATUS.md) - Current issues and fixes
- [docs/AUTO-DEBUG.md](docs/AUTO-DEBUG.md) - Error analysis system
- [docs/PROJECT-CLAUDE-AUTOFIX.md](docs/PROJECT-CLAUDE-AUTOFIX.md) - Claude Code auto-fix system (planned)
- [docs/SETUP.md](docs/SETUP.md) - Initial setup instructions
- [docs/VPS-RESETUP.md](docs/VPS-RESETUP.md) - Doppler and Hostinger VPS re-setup (new machine)
- [docs/FIREFLIES-SETUP.md](docs/FIREFLIES-SETUP.md) - Fireflies meeting processor setup

## Current Session Status

See `SESSION-*.md` files for recent work summaries.

