# n8n GitHub Sync Setup Guide

## Step 1: Create GitHub Repository ✅ COMPLETE

Repository created at: https://github.com/hudsonlorfing/chrt-n8n-workflows

## Step 2: Push Local Repository ✅ COMPLETE

Pushed via SSH:
```bash
git remote set-url origin git@github.com:hudsonlorfing/chrt-n8n-workflows.git
git push -u origin main
```

---

## Step 3: Generate GitHub Personal Access Token

> **Why is this needed?** The n8n sync workflow uses the GitHub API to read/write files. It cannot use your SSH key - it needs an API token.

1. Go to https://github.com/settings/tokens?type=beta
2. Click **Generate new token**
3. Fill in:
   - **Token name**: `n8n-workflow-sync`
   - **Expiration**: 90 days (or longer)
   - **Repository access**: Select **Only select repositories** → `chrt-n8n-workflows`
4. Under **Permissions**, expand **Repository permissions**:
   - **Contents**: Read and write
   - **Metadata**: Read-only (auto-selected)
5. Click **Generate token**
6. **Copy and save the token** (you won't see it again!)

## Step 4: Get n8n API Key

1. Log into your n8n Cloud instance
2. Go to **Settings** → **n8n API**
3. Click **Create API Key**
4. Name: `github-sync`
5. Copy the API key

## Step 5: Import Sync Template

**Option A: Import from local file (recommended)**
1. Open your n8n instance
2. Click **Add workflow** → **Import from file**
3. Select: `sync-template-5081.json` (in this folder)

**Option B: Import from n8n.io**
1. Click **Add workflow** → **Import from URL**
2. Enter: `https://n8n.io/workflows/5081`

## Step 6: Configure Sync Workflow

### 6a. Update GitHub Details Node

Find the **Set GitHub Details** node (first node after trigger) and update:

| Field | Value |
|-------|-------|
| `github_account_name` | `hudsonlorfing` |
| `github_repo_name` | `chrt-n8n-workflows` |
| `repo_workflows_path` | `workflows` |

### 6b. Add GitHub Credential

1. Click on any **GitHub** node
2. Under **Credential to connect with**, click **Create New**
3. Select **GitHub API**
4. Authentication: **Access Token**
5. Paste your Personal Access Token from Step 3
6. Save

### 6c. Add n8n API Credential

1. Click on any **n8n** node  
2. Under **Credential to connect with**, click **Create New**
3. Paste your n8n API key from Step 4
4. For API URL, use your n8n Cloud URL (e.g., `https://your-instance.app.n8n.cloud/api/v1`)
5. Save

## Step 7: Activate and Test

1. Save the workflow
2. Click **Execute workflow** to test manually
3. Check your GitHub repo - you should see workflow JSON files appear/update
4. If working, toggle **Active** to enable scheduled syncs (daily at 6 AM)

---

## Your Editing Workflow

Once set up, editing n8n workflows in Cursor works like this:

```bash
# 1. Pull latest from GitHub
cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows
git pull

# 2. Edit workflow JSON files in Cursor

# 3. Commit and push
git add .
git commit -m "Updated lead intake workflow"
git push

# 4. Wait for next sync (6 AM daily) or trigger manually in n8n
```

---

## Troubleshooting

### "Unauthorized" errors in n8n
- Check your GitHub PAT has correct permissions (Contents: Read and write)
- Ensure n8n API key is valid and has correct URL

### Workflows not syncing
- Check the workflow execution logs in n8n
- Verify `repo_workflows_path` is `workflows` (not `/workflows`)

### Credential issues after import
- Credentials are instance-specific
- After importing from GitHub, you'll need to re-link credentials in n8n

### Push permission denied locally
- Using SSH: Ensure your SSH key is added to `hudsonlorfing` GitHub account
- Using HTTPS: Clear cached credentials or use PAT in URL
