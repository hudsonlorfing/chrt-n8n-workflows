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
./scripts/n8n-sync.sh preflight

# Sync meeting notes from GitHub to Obsidian
./scripts/sync-meetings.sh
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

### Workflow IDs (n8n Cloud)

| Workflow | ID | Status |
|----------|-----|--------|
| Chrt GitHub Workflow Sync | `r4ICnvhdbQwejSdH` | ✅ Active |
| 1. Lead Ingestion & ICP Scoring | `aLxwvqoSTkZAQ3fq` | ✅ Active |
| 2. LinkedIn Outreach (PhantomBuster) | `kjjYKQEXv67Vl5MS` | ✅ Active |
| 3. Connection Sync → HubSpot | `a56vnrPo9dsg5mmf` | ✅ Active |
| 4. Lead Pipeline Monitor | `dWFsEXELFTJU0W01` | ⚠️ Inactive (debugging) |
| 5. Error Monitor Webhook | `YWP69Qgq0ZlCN7Gj` | ✅ Active |

### Workflows (Hostinger Self-Hosted)

| Workflow | Webhook Path | Status |
|----------|--------------|--------|
| 6. Fireflies Meeting Processor | `/webhook/fireflies-meeting` | 🆕 New |

## Development Workflow

### 1. Making Changes

```bash
# Edit JSON locally, then push to n8n
./scripts/n8n-debug.sh update <file.json> <workflow_id>

# Or edit in n8n UI, then download
./scripts/n8n-sync.sh download
```

### 2. Testing

```bash
./scripts/n8n-debug.sh activate <workflow_id>
./scripts/n8n-debug.sh trigger <workflow_id>  # for webhook workflows
./scripts/n8n-debug.sh list 5 <workflow_id>   # recent executions
./scripts/n8n-debug.sh full <exec_id>          # full execution data
```

### 3. Error Analysis

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
│   ├── chrt-github-workflow-sync.json    # Bidirectional sync (Cloud)
│   ├── 4.-lead-pipeline-monitor.json     # Pipeline automation (Cloud)
│   ├── 5.-error-monitor-webhook.json     # Error notifications (Cloud)
│   ├── 6.-fireflies-meeting-processor.json # Meeting analysis (Hostinger)
│   └── linkedin/
│       ├── 1.-lead-ingestion-&-icp-scoring.json
│       ├── 2.-linkedin-outreach-(phantombuster).json
│       ├── 3.-connection-sync-→-hubspot.json
│       └── 4.-lead-pipeline-monitor.json  (synced copy)
├── scripts/
│   ├── n8n-sync.sh         # Pre-flight & sync operations
│   ├── n8n-debug.sh        # API interaction & debugging
│   ├── auto-debug.sh       # AI-powered error analysis
│   ├── auto-debug-server.js # Local webhook listener
│   └── sync-meetings.sh    # Sync meeting notes to Obsidian
├── test-results/           # Test logs and documentation
├── debug-logs/             # Error analysis outputs (gitignored)
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

- [WORKFLOW-PROCESS.md](WORKFLOW-PROCESS.md) - Full development workflow
- [STATUS.md](STATUS.md) - Current issues and fixes
- [AUTO-DEBUG.md](AUTO-DEBUG.md) - Error analysis system
- [SETUP.md](SETUP.md) - Initial setup instructions
- [FIREFLIES-SETUP.md](FIREFLIES-SETUP.md) - Fireflies meeting processor setup

## Current Session Status

See `SESSION-*.md` files for recent work summaries.

