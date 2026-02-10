# LinkedIn Workflows V2 — Wait-Node-Free Split Workflows

This folder contains **v2** split workflows that eliminate all Wait nodes and long-running processes by splitting each workflow into launch (.1) and process-results (.2/.3) sub-workflows connected by PhantomBuster webhooks or Apps Script callbacks.

## n8n Test Folder

- **n8n folder ID:** `2jLRsHZHvwPztxt4`
- **URL:** `https://chrt.app.n8n.cloud/projects/O7lTivDfRl72aS23/folders/2jLRsHZHvwPztxt4/workflows`

## Workflows

| File | n8n ID | Description |
|------|--------|-------------|
| `1.0-lead-ingestion-icp-scoring.json` | `f4PepQxbygW1QeWZ` | WF1: Read new leads, dedupe, async ICP scoring via Apps Script, wait for callback |
| `2.1-linkedin-outreach-send.json` | `nfB8uIOOktCneJ2M` | WF2 launch: select leads, write to holding sheet, launch PB |
| `2.2-linkedin-outreach-results.json` | `X2cJpTw9nj4D9GiO` | WF2 results: PB webhook -> parse -> batch update -> clear sheet |
| `3.1-connection-sync-launch.json` | `Qts1zslbqxab1aHc` | WF3 launch: launch connection export PB |
| `3.2-connection-sync-process.json` | `EjNGBdN420LQmX2M` | WF3 process: PB webhook -> find new connections -> launch email scraper |
| `3.3-connection-sync-hubspot.json` | `wKYz16GbzqWTh2DK` | WF3 HubSpot: email scraper webhook -> merge data -> HubSpot sync |
| `4.1-pipeline-monitor-launch.json` | `OVjPWkmSVnXYlQDP` | WF4 launch: read dashboard, launch PB crawl |
| `4.2-pipeline-monitor-results.json` | `A35Yu92OFuYKvEtR` | WF4 results: PB webhook -> process crawl results -> update sheets |

## Architecture

Each original workflow is split at the PhantomBuster launch boundary:

```
Original:  Trigger -> ... -> Launch PB -> [Wait 10-20 min] -> Fetch Results -> Process
V2 Split:
  .1 workflow: Trigger -> ... -> Launch PB -> Done (immediate)
  .2 workflow: PB Webhook -> Fetch Results -> Process -> Done
```

**WF 1.0 uses a different async pattern:** Instead of PB webhooks, it sends leads to a Google Apps Script that returns an immediate ACK, processes in the background via a time-driven trigger, and POSTs results back to an n8n Wait node's webhook-resume URL.

PhantomBuster agents are configured to POST a webhook to the .2 workflow URL when they finish. No Wait nodes, no polling loops (except the single Wait node in WF 1.0 for Apps Script callback).

## PhantomBuster Webhook Setup

For each PB agent, configure a webhook notification:
1. Go to PhantomBuster agent settings
2. Under "Notifications", add a webhook URL
3. URL format: `https://chrt.app.n8n.cloud/webhook/{path}`
4. The webhook payload includes `containerId`, `agentId`, and `status`

## Testing

1. Import workflows to test folder: `./scripts/n8n-ops/debug.sh import-to-test workflows/linkedin/<file>.json`
2. Move to test folder in n8n UI
3. Activate the .2 webhook workflow first, then trigger the .1 workflow
4. Check executions: `WORKFLOW_ID=<id> ./scripts/n8n-ops/debug.sh list 5`

## Test Containers

- **Container `8302276183039757`**: Use to test 4.2 (pipeline monitor results) with existing crawl data
