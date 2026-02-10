# Fireflies Meeting Processor Setup Guide

## Overview

This workflow automatically processes meeting transcripts from Fireflies.ai:
1. **Receives** webhook from Fireflies when meeting ends
2. **Prompts** you in Slack to select workspace and add context
3. **Analyzes** with Gemini AI (auto-selects best model for cost/quality)
4. **Commits** structured markdown to `hudsonlorfing/meeting-notes` GitHub repo
5. **Notifies** success/failure in Slack

## Architecture

```
Fireflies → n8n Webhook → Slack (Wait for input) → VPS Model Selector → Gemini API → GitHub → Slack
                                      ↓
                        VPS Slack Forwarder (port 3850)
```

## VPS Services

| Port | Service | Purpose |
|------|---------|---------|
| 3848 | n8n-autofix | Error auto-fixing |
| 3849 | model-selector | Gemini model selection |
| 3850 | slack-forwarder | Slack interaction forwarding |

## Step 1: Configure Slack App Interactivity

**This is required for the Wait node buttons to work!**

1. Go to https://api.slack.com/apps
2. Select your app (or create one)
3. Go to **Interactivity & Shortcuts** → Enable
4. Set **Request URL** to:
   ```
   http://srv1230891.hstgr.cloud:3850/slack/interactions
   ```
5. Save Changes

## Step 2: Configure Fireflies Webhook

1. Log into https://app.fireflies.ai
2. Go to **Settings → Integrations → Webhooks**
3. Add new webhook:
   - **URL**: `https://chrt.app.n8n.cloud/webhook/fireflies-meeting`
   - **Events**: `Transcript completed`
4. Save

## Step 3: Activate the Workflow

1. Open n8n Cloud: https://chrt.app.n8n.cloud
2. Go to workflow **6. Fireflies Meeting Processor** (ID: `I5qKGljJAwRbPK2e`)
3. Click **Activate** (toggle to ON)

## Step 4: Test

1. Join any Fireflies-recorded meeting
2. When meeting ends, you should receive a Slack message in `#meetings`
3. Fill in:
   - **Workspace**: Chrt, GoodLux, Personal, or ShedPro
   - **Meeting purpose**: e.g., "Discovery call with ACME Corp"
   - **Focus areas** (optional): e.g., "Action items, pain points"
4. Click **Process Meeting**
5. Check GitHub repo for the committed markdown

## Workflow Features

### 🤖 Dynamic Model Selection
The VPS model selector chooses the optimal Gemini model:
- **gemini-2.0-flash**: Standard meetings (<100k tokens)
- **gemini-1.5-pro**: Very long meetings (>500k tokens)

### 📦 Token Batching
Long transcripts are automatically split into ~25k token batches to stay within API limits.

### 🔄 Duplicate Detection
Each meeting gets an MD5 hash from `meetingId + title + first 500 chars`. The Wait webhook suffix includes this hash for deduplication.

### ⚠️ Error Handling
Connected to Error Monitor workflow (`YWP69Qgq0ZlCN7Gj`) for automatic error tracking.

## Sync to Obsidian

After meetings are committed to GitHub, sync to your local Obsidian:

```bash
# Create sync script
mkdir -p ~/scripts
cat > ~/scripts/sync-meetings.sh << 'EOF'
#!/bin/bash
cd /Users/hudsonlorfing/Documents/Business/meeting-notes
git pull origin main

# Optional: Copy to Obsidian vaults
# cp -r chrt/* ~/Documents/Obsidian/Chrt/Meetings/
# cp -r personal/* ~/Documents/Obsidian/Personal/Meetings/
EOF
chmod +x ~/scripts/sync-meetings.sh

# Run manually
~/scripts/sync-meetings.sh

# Or add to crontab (every 15 minutes)
# crontab -e
# */15 * * * * ~/scripts/sync-meetings.sh >/dev/null 2>&1
```

## Troubleshooting

### Slack buttons not working
- Verify Slack app Interactivity URL: `http://srv1230891.hstgr.cloud:3850/slack/interactions`
- Check VPS service: `ssh root@srv1230891.hstgr.cloud "pm2 logs slack-forwarder --lines 20"`

### Gemini errors
- Check model selector: `curl -s http://srv1230891.hstgr.cloud:3849/models | jq`
- Verify API key is valid

### GitHub commit fails
- Ensure `meeting-notes` repo exists
- Check GitHub credentials in n8n

### VPS services down
```bash
ssh root@srv1230891.hstgr.cloud "pm2 list && pm2 restart all"
```

## Gemini API Pricing

| Model | Input (1M tokens) | Output (1M tokens) |
|-------|-------------------|-------------------|
| gemini-2.0-flash | $0.075 | $0.30 |
| gemini-2.0-flash-lite | $0.0375 | $0.15 |
| gemini-1.5-pro | $1.25 | $5.00 |

Typical 1-hour meeting (~10k tokens): ~$0.01 with Flash
