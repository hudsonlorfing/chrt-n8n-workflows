# Sync Workflow Status

**Last Updated**: December 23, 2025 11:15 PM PST

## Current Issues

### 1. ❌ Directory Traversal Not Working Correctly

**Problem**: The sync workflow is not properly reading files from the `linkedin/` subdirectory. It only processes the file in the root `workflows/` directory.

**Symptoms**:
- Sync only updated `chrt-github-workflow-sync.json` (in root)
- Did not detect/process the 3 files in `workflows/linkedin/`
- GitHub side shows files exist, but comparison fails

**Root Cause**: The recursive directory listing flow may not be waiting for all subdirectory files before running the comparison.

### 2. ❌ Creating Duplicate Files

**Problem**: The sync tried to create 3 new files in GitHub that shouldn't exist.

**Symptoms**:
- n8n workflows being treated as "only in n8n" when they already exist in GitHub
- This triggers the "Upload file" path instead of "Update file"

**Root Cause**: Same as #1 - if GitHub files from subdirectories aren't collected, comparison thinks they don't exist.

### 3. ⚠️ SHA Error on File Creation (Partially Fixed)

**Problem**: When trying to create a file that already exists, GitHub returns 422 "sha wasn't supplied".

**Status**: Added fallback with `onError: continueErrorOutput` that routes to "Update Existing File" node. This is a workaround, not a fix for the root cause.

---

## What's Working

- ✅ n8n API connection (listing workflows)
- ✅ GitHub API connection (reading/writing files)
- ✅ Project ID filtering (`O7lTivDfRl72aS23`)
- ✅ Tag-based folder paths (`linkedin` tag → `workflows/linkedin/`)
- ✅ Single file updates (when file is found in comparison)
- ✅ Local editing and pushing to GitHub
- ✅ Lead Ingestion workflow updated (replaced Merge SQL node with JS Code node)

---

## Next Steps

### Priority 1: Fix Directory Traversal

The core issue is that subdirectory files aren't being collected before the comparison runs.

**Options to investigate**:

1. **Use a single Code node** that makes HTTP requests to GitHub API recursively
   - More control over when data is ready
   - Can collect ALL files before outputting

2. **Add a "Wait" or aggregation step**
   - Ensure all branches (root files + subdirectory files) complete before comparison
   - Use n8n's "Merge" node to combine results from both paths

3. **Simplify to flat structure**
   - Remove subdirectory support
   - Keep all workflows in `workflows/` root
   - Tag-based organization only in n8n, not reflected in GitHub

### Priority 2: Fix Comparison Logic

Once files are properly collected, verify:
- Workflow IDs match between n8n and GitHub
- `_githubPath` is being preserved correctly
- Comparison by `id` field is working

### Priority 3: Clean Up Duplicate Files

After sync is working:
- Delete any duplicate files created in GitHub
- Ensure one canonical location for each workflow

### Priority 4: Improve Debugging Workflow

**Goal**: Full test/debug loop from Cursor without manual intervention

**Vision**: 
1. Edit workflow JSON in Cursor
2. Push to n8n via API
3. Trigger execution from Cursor
4. Fetch execution results/errors directly
5. Iterate on fix without leaving Cursor

**n8n API Endpoints to use**:
```
POST /api/v1/workflows/{id}/activate     # Activate workflow
POST /api/v1/workflows/{id}/deactivate   # Deactivate workflow
POST /api/v1/workflows/{id}/run          # Execute workflow manually
GET  /api/v1/executions                  # List executions
GET  /api/v1/executions/{id}             # Get execution with full data
PUT  /api/v1/workflows/{id}              # Update workflow
```

**Implementation ideas**:
- Create a Cursor task/script that: updates workflow → runs it → fetches execution → shows results
- Use MCP n8n tools already available in this workspace
- Could even parse execution data to pinpoint which node failed and what data it received

**Benefits**:
- No context switching to n8n UI
- Real data visible in Cursor for each node
- Faster iteration cycles
- AI can analyze execution data and suggest fixes directly

---

## Files to Review

| File | Purpose |
|------|---------|
| `sync-template-5081.json` | Main sync workflow - import to n8n |
| `workflows/linkedin/*.json` | LinkedIn workflows (in subdirectory) |
| `workflows/chrt-github-workflow-sync.json` | The sync workflow itself |

---

## How to Test

1. Import `sync-template-5081.json` into n8n (or update existing)
2. Run the workflow manually (click "Test workflow")
3. Check execution output:
   - How many items from "List files from repo"?
   - How many items reach "Decode to json"?
   - What does "n8n vs GitHub" comparison show?
4. Verify no duplicate files created

---

## Quick Reference

### Git Commands

```bash
cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows
git pull origin main
git status
git add -A
git commit -m "message"
git push origin main
```

### n8n Workflow ID

- Sync Workflow: `r4ICnvhdbQwejSdH`
- Project: `O7lTivDfRl72aS23`

### Key Nodes in Sync Workflow

| Node | Purpose |
|------|---------|
| `List files from repo` | Lists GitHub repo contents |
| `Process GitHub Listing` | Separates files from directories |
| `Is Directory?` | Routes directories to subdirectory listing |
| `List Subdirectory` | Lists subdirectory contents |
| `GitHub` | Gets file content |
| `Decode to json` | Parses workflow JSON |
| `n8n vs GitHub` | Compares by workflow ID |
| `Upload file` | Creates new files |
| `Update file` | Updates existing files |

