# Lead Pipeline Monitor - Testing Documentation

## Workflow IDs

| Workflow | ID | Status |
|----------|----|----|
| Chrt GitHub Workflow Sync | `r4ICnvhdbQwejSdH` | Active (production) |
| 1. Lead Ingestion & ICP Scoring | `aLxwvqoSTkZAQ3fq` | Active |
| 4. Lead Pipeline Monitor | `dWFsEXELFTJU0W01` | Inactive (#testing) |

## Recent successful test executions

| Execution | Workflow | Test workflow ID | Status |
|-----------|----------|------------------|--------|
| 1149 | 1. Lead Ingestion & ICP Scoring (TEST) | `MQantT1gLLP8NEn4` | success |
| 1145 | 4. Lead Pipeline Monitor (TEST) | `atJokUdeDsap4lJO` | success |

To pull full execution data: `./scripts/n8n-ops/debug.sh full 1149` and `./scripts/n8n-ops/debug.sh full 1145` (with `N8N_API_KEY` set).

## Pipeline Monitor Paths to Test

### Path 1: D5 < 240 - Trigger Lead Ingestion
**Condition**: Dashboard D5 (Potential Connections) < 240
**Expected**: Calls lead-ingestion webhook with batchSize=240

### Path 2: B5 < 500 - Trigger Phantom Scraping
**Condition**: Dashboard B5 (Pre-processed) < 500
**Expected**: 
1. Read "People to crawl" sheet
2. Select next uncrawled URL
3. Launch PhantomBuster phantom 5278010334212417
4. Wait 10 min
5. Fetch results
6. Dedupe against Master List + New Leads
7. Append unique profiles to New Leads
8. Update Last Crawl Date

### Path 3: URL Count Alerts
- **> 2 uncrawled URLs**: Normal operation
- **1-2 uncrawled URLs**: Warning email + continue
- **0 uncrawled URLs**: Critical email + fallback to oldest crawled

### Path 4: Retry Loop
**Condition**: After scraping, B5 still < 500
**Expected**: Wait 24h + random 0-8h, then loop back to scrape next URL

## Test Commands

```bash
# Source environment
cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows
source .env

# Activate Pipeline Monitor for testing
./scripts/n8n-ops/debug.sh activate dWFsEXELFTJU0W01

# Trigger via webhook
curl -X POST "https://chrt.app.n8n.cloud/webhook/pipeline-monitor" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Check execution status
curl -s "https://chrt.app.n8n.cloud/api/v1/executions?workflowId=dWFsEXELFTJU0W01&limit=3" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" | jq '.data[] | {id, status}'

# Deactivate after testing
./scripts/n8n-ops/debug.sh deactivate dWFsEXELFTJU0W01
```

## Known Issues

1. **Lead Ingestion Webhook Timeout**: The webhook times out (524) because AI processing takes >60 seconds. The workflow still runs to completion - just the HTTP response times out.

2. **SMTP Credentials**: Email alert nodes require SMTP credentials to be configured in n8n.

## Configuration Requirements

### Google Sheets
- Document ID: `1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8`
- Required Tabs: Dashboard, New Leads, Master List, People to crawl
- Credential: `googleSheetsOAuth2Api` (ID: `hf9VoWnqYNXhUZsn`)

### PhantomBuster
- Phantom ID: `5278010334212417` (LinkedIn Search Export)
- Credential: `httpHeaderAuth` (ID: `KWeabljbYSzoLpjI`)

### Email (SMTP)
- Needs to be configured for hudson@chrt.com alerts

## Moving to Production

Once testing is complete:

1. Change tag from `#testing` to `#linkedin`
2. Move to Chrt project (O7lTivDfRl72aS23)
3. Activate the daily schedule
4. Monitor first few automated runs

