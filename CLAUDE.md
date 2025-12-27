# CLAUDE.md - n8n Workflow Project Context

> **Parent Context:** See `_Shared/CLAUDE.md` in the Business repo root for overall workspace context, agent skills, and general conventions.

## Quick Start

```bash
# ALWAYS run this before starting any work
cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows
./scripts/n8n-sync.sh preflight
```

## Project Configuration

| Setting | Value |
|---------|-------|
| n8n URL | https://chrt.app.n8n.cloud |
| Project ID | `O7lTivDfRl72aS23` |
| GitHub Repo | hudsonlorfing/chrt-n8n-workflows |

### Workflow IDs

| Workflow | ID | Status |
|----------|-----|--------|
| Chrt GitHub Workflow Sync | `r4ICnvhdbQwejSdH` | ✅ Active |
| 1. Lead Ingestion & ICP Scoring | `aLxwvqoSTkZAQ3fq` | ✅ Active |
| 2. LinkedIn Outreach (PhantomBuster) | `kjjYKQEXv67Vl5MS` | ✅ Active |
| 3. Connection Sync → HubSpot | `a56vnrPo9dsg5mmf` | ✅ Active |
| 4. Lead Pipeline Monitor | `dWFsEXELFTJU0W01` | ⚠️ Inactive (debugging) |
| 5. Error Monitor Webhook | `YWP69Qgq0ZlCN7Gj` | ✅ Active |

## Common Commands

### Development Workflow

```bash
# Edit JSON locally, then push to n8n
./scripts/n8n-debug.sh update <file.json> <workflow_id>

# Or edit in n8n UI, then download
./scripts/n8n-sync.sh download

# Test workflow
./scripts/n8n-debug.sh activate <workflow_id>
./scripts/n8n-debug.sh trigger <workflow_id>  # for webhook workflows
./scripts/n8n-debug.sh list 5 <workflow_id>   # recent executions
./scripts/n8n-debug.sh full <exec_id>          # full execution data
```

### Error Analysis

```bash
# Check all workflows for errors
./scripts/auto-debug.sh check

# Analyze specific execution with Claude AI
./scripts/auto-debug.sh analyze <execution_id>
```

## Project Structure

```
chrt-n8n-workflows/
├── workflows/
│   ├── chrt-github-workflow-sync.json    # Bidirectional sync
│   ├── 4.-lead-pipeline-monitor.json     # Pipeline automation
│   ├── 5.-error-monitor-webhook.json     # Error notifications
│   └── linkedin/
│       ├── 1.-lead-ingestion-&-icp-scoring.json
│       ├── 2.-linkedin-outreach-(phantombuster).json
│       ├── 3.-connection-sync-→-hubspot.json
│       └── 4.-lead-pipeline-monitor.json  (synced copy)
├── scripts/
│   ├── n8n-sync.sh         # Pre-flight & sync operations
│   ├── n8n-debug.sh        # API interaction & debugging
│   ├── auto-debug.sh       # AI-powered error analysis
│   └── auto-debug-server.js # Local webhook listener
├── test-results/           # Test logs and documentation
├── debug-logs/             # Error analysis outputs (gitignored)
└── .env                    # N8N_API_KEY, N8N_BASE_URL (gitignored)
```

## Architecture Decisions

### Sync Workflow
- Uses GitHub Trees API for recursive file listing
- Tag-based folder routing (`linkedin` tag → `workflows/linkedin/`)
- `onError: continueErrorOutput` on all GitHub nodes for resilience

### Lead Ingestion
- JavaScript Code node with `Set` for O(1) deduplication
- Dynamic batch sizing via webhook parameter (10 manual, 240 automated)
- Waits for both sheets before deduplication

### Error Monitoring
- Filters out manual triggers automatically
- Attempts local debugger first, falls back to logging
- Returns debug command in webhook response

## Environment Variables

Required in `.env`:
```
N8N_API_KEY=your-api-key-here
N8N_BASE_URL=https://chrt.app.n8n.cloud
```

## Common Issues

| Issue | Solution |
|-------|----------|
| "request/body must NOT have additional properties" | `n8n-debug.sh update` strips read-only properties |
| Webhook timeout (524) | Workflow continues in background, check n8n UI |
| Git auth errors | SSH for local Git, PAT for n8n sync workflow |

## Related Files

- [WORKFLOW-PROCESS.md](WORKFLOW-PROCESS.md) - Full development workflow
- [STATUS.md](STATUS.md) - Current issues and fixes
- [AUTO-DEBUG.md](AUTO-DEBUG.md) - Error analysis system
- [SESSION-*.md](SESSION-2024-12-26.md) - Session summaries
