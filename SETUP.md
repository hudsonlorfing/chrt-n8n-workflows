# n8n GitHub Sync Setup Guide

## Step 1: Create GitHub Repository (Manual)

1. Go to https://github.com/new
2. Fill in:
   - **Repository name**: `chrt-n8n-workflows`
   - **Description**: `Version-controlled n8n workflow backups for Chrt`
   - **Visibility**: Private
3. **DO NOT** initialize with README (we already have one)
4. Click **Create repository**

## Step 2: Push Local Repository

After creating the repo on GitHub, run these commands:

```bash
cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows

# Rename branch to main
git branch -M main

# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin git@github.com:YOUR_USERNAME/chrt-n8n-workflows.git

# Push to GitHub
git push -u origin main
```

## Step 3: Generate GitHub Personal Access Token

1. Go to https://github.com/settings/tokens?type=beta
2. Click **Generate new token**
3. Name: `n8n-workflow-sync`
4. Expiration: 90 days (or longer)
5. Repository access: **Only select repositories** → `chrt-n8n-workflows`
6. Permissions:
   - **Contents**: Read and write
   - **Metadata**: Read-only
7. Click **Generate token**
8. **Copy and save the token** (you won't see it again!)

## Step 4: Get n8n API Key

1. Log into your n8n Cloud instance
2. Go to **Settings** → **n8n API**
3. Click **Create API Key**
4. Name: `github-sync`
5. Copy the API key

## Step 5: Import Sync Template

1. Go to your n8n instance
2. Click **Add workflow** → **Import from URL**
3. Enter: `https://n8n.io/workflows/5081`
4. Or download and import manually from: https://n8n.io/workflows/5081

## Step 6: Configure Sync Workflow

In the imported workflow, find the **Set GitHub Details** node and update:

```json
{
  "github_account_name": "YOUR_GITHUB_USERNAME",
  "github_repo_name": "chrt-n8n-workflows",
  "repo_workflows_path": "workflows"
}
```

Then add your credentials:
- **GitHub credential**: Use your Personal Access Token from Step 3
- **n8n API credential**: Use your API key from Step 4

## Step 7: Activate and Test

1. Save the workflow
2. Click **Execute workflow** to test
3. Check your GitHub repo - workflows should appear!
4. If working, activate the workflow for scheduled syncs

## Verification

After setup, verify by:
1. Making a small change to a workflow in n8n
2. Wait for sync (or trigger manually)
3. Check GitHub - change should appear
4. Make a change in GitHub
5. Wait for sync
6. Check n8n - change should appear

## Troubleshooting

### "Unauthorized" errors
- Check your GitHub token has correct permissions
- Ensure n8n API key is valid

### Workflows not syncing
- Check the workflow execution logs in n8n
- Verify repo path matches your structure

### Credential issues
- Credentials are instance-specific
- After importing from GitHub, you'll need to re-link credentials in n8n

