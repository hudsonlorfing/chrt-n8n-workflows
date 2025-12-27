# Fireflies Meeting Processor Setup

This workflow automatically processes meeting transcripts from Fireflies.ai, analyzes them with Gemini AI, and saves structured meeting notes to your Obsidian vaults.

## Architecture

```
Fireflies.ai → Hostinger n8n → Slack (user input) → Gemini AI → GitHub → Local Mac
                (webhook)      (workspace/context)   (analysis)  (storage)  (sync)
```

## Prerequisites

1. **Hostinger VPS** with n8n running at `srv1230891.hstgr.cloud`
2. **Fireflies.ai** account with webhook capability
3. **Slack** workspace for interaction
4. **Google Gemini** API access
5. **GitHub** account for storage

## Setup Steps

### 1. Create GitHub Repository

Create a new repository called `meeting-notes`:

```bash
# On GitHub, create: hudsonlorfing/meeting-notes

# Then clone locally:
cd /Users/hudsonlorfing/Documents/Business
git clone git@github.com:hudsonlorfing/meeting-notes.git
cd meeting-notes

# Create folder structure
mkdir -p chrt goodlux personal shedpro
echo "# Meeting Notes" > README.md
git add -A && git commit -m "Initial structure" && git push
```

### 2. Configure Credentials in n8n

On your Hostinger n8n instance (`srv1230891.hstgr.cloud`), add these credentials:

| Credential | Type | Notes |
|------------|------|-------|
| Slack OAuth2 | OAuth2 | Need `chat:write`, `channels:read` scopes |
| GitHub API | API Key | Personal Access Token with `repo` scope |
| Google Gemini | API Key | From Google AI Studio |

### 3. Import the Workflow

1. Open your n8n instance: `https://srv1230891.hstgr.cloud`
2. Import `workflows/6.-fireflies-meeting-processor.json`
3. Update these placeholder values:
   - `YOUR_SLACK_CHANNEL_ID` → Your Slack channel ID
   - `YOUR_SLACK_CRED_ID` → Your Slack credential ID
   - `YOUR_GEMINI_CRED_ID` → Your Gemini credential ID
   - `YOUR_GITHUB_CRED_ID` → Your GitHub credential ID

### 4. Configure Fireflies Webhook

1. Go to Fireflies.ai → Settings → Integrations → Webhooks
2. Add new webhook:
   - **URL**: `https://srv1230891.hstgr.cloud/webhook/fireflies-meeting`
   - **Events**: `transcription.complete`

### 5. Set Up Local Sync

Make the sync script executable and optionally add to cron:

```bash
# Make executable
chmod +x /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows/scripts/sync-meetings.sh

# Run manually
./scripts/sync-meetings.sh

# Or add to crontab (every 5 minutes)
crontab -e
# Add: */5 * * * * /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows/scripts/sync-meetings.sh >/dev/null 2>&1
```

### 6. Activate the Workflow

In n8n, activate the Fireflies workflow.

## Usage

### Automatic Flow

1. **Meeting ends** → Fireflies transcribes it
2. **Webhook fires** → n8n receives transcript
3. **Slack message** → You select workspace and describe the meeting
4. **Gemini analyzes** → Creates structured note
5. **GitHub commit** → Note saved to repo
6. **Local sync** → Note appears in Obsidian

### Manual Sync

```bash
# Sync meeting notes to local vaults
cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows
./scripts/sync-meetings.sh
```

## File Organization

Meeting notes are saved to:

| Workspace | GitHub Folder | Local Vault Path |
|-----------|---------------|------------------|
| Chrt | `chrt/` | `Chrt/obsidian/Calendar/Notes/Meetings/` |
| GoodLux | `goodlux/` | `GoodLux/obsidian/Calendar/Notes/Meetings/` |
| Personal | `personal/` | `_personal/obsidian/Calendar/Notes/Meetings/` |
| ShedPro | `shedpro/` | `ShedPro/obsidian/Calendar/Notes/Meetings/` |

## Troubleshooting

### Webhook Not Receiving

1. Check n8n workflow is active
2. Verify Fireflies webhook URL is correct
3. Check n8n execution logs

### Slack Not Responding

1. Ensure Slack app has correct permissions
2. Check channel ID is valid
3. Verify OAuth token is fresh

### GitHub Commit Fails

1. Check Personal Access Token has `repo` scope
2. Ensure `meeting-notes` repo exists
3. Check folder exists in repo

### Local Sync Issues

1. Run `sync-meetings.sh` with verbose output
2. Check SSH keys are set up for GitHub
3. Ensure all vault directories exist

## Customization

### Adding More Workspaces

1. Edit `6.-fireflies-meeting-processor.json`:
   - Add option to workspace dropdown in Slack Block Kit
   - Add mapping in "Prepare Data" code node

2. Edit `sync-meetings.sh`:
   - Add entry to `VAULT_PATHS` array

### Modifying the Analysis Prompt

Edit the "Gemini: Analyze Transcript" node to customize:
- Output structure
- Analysis focus areas
- Tag generation

## Related Files

- `workflows/6.-fireflies-meeting-processor.json` - The n8n workflow
- `scripts/sync-meetings.sh` - Local sync script
- `CLAUDE.md` - Project context

## Quick Reference

| Task | Command |
|------|---------|
| Sync meetings | `./scripts/sync-meetings.sh` |
| Check workflow | Open n8n → Executions |
| Test webhook | `curl -X POST https://srv1230891.hstgr.cloud/webhook/fireflies-meeting` |

