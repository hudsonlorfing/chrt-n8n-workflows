# Sync Workflow Status

**Last Updated**: December 26, 2025

## Current Issues

### 1. ✅ Directory Traversal (FIXED)

**Problem**: The sync workflow was only processing root-level files, missing subdirectory files.

**Root Cause**: n8n's Aggregate node completed before the recursive subdirectory listing ran.

**Solution**: Replaced recursive loop with GitHub Trees API:
```
Get GitHub Tree (recursive=1) → Filter Workflow Files → GitHub → Decode → Aggregate
```

**Result**: All 4 files (1 root + 3 in linkedin/) now correctly processed.
Tested on execution #360 - successful sync with no duplicates.

### 2. ✅ Creating Duplicate Files (FIXED)

**Problem**: The sync was creating duplicate files in GitHub.

**Root Cause**: Same as #1 - subdirectory files weren't collected before comparison.

**Solution**: Fixed with Aggregate pattern (Priority 1). Now all GitHub files are collected before comparison runs, so workflows are correctly identified as "same" instead of "only in n8n".

### 3. ✅ SHA Error on File Creation (FIXED)

**Problem**: When trying to create a file that already exists, GitHub returns 422 "sha wasn't supplied".

**Solution**: 
1. Root cause fixed by #1 and #2 - proper file collection prevents incorrect "create" attempts
2. Fallback added with `onError: continueErrorOutput` → "Update Existing File" node as safety net

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

### Priority 1: ✅ Fix Directory Traversal (IMPLEMENTED)

**Root Cause**: Items were flowing to comparison immediately without waiting for subdirectory processing to complete.

**Solution Applied**: Added Aggregate → Split pattern:
```
Decode to json → Aggregate GitHub Files → Split for Comparison → n8n vs GitHub
```

This ensures:
1. ALL GitHub files (root + subdirectories) are collected first
2. Then split back into individual items for comparison
3. Comparison runs only after complete file collection

### Priority 2: Fix Comparison Logic

Once files are properly collected, verify:
- Workflow IDs match between n8n and GitHub
- `_githubPath` is being preserved correctly
- Comparison by `id` field is working

### Priority 3: Clean Up Duplicate Files

After sync is working:
- Delete any duplicate files created in GitHub
- Ensure one canonical location for each workflow

### Priority 4: ✅ Debugging Workflow (IMPLEMENTED)

**Goal**: Full test/debug loop from Cursor without manual intervention

**Status**: IMPLEMENTED via `scripts/n8n-debug.sh`

**What's Available**:
1. ✅ Debug Webhook trigger added to sync workflow (`/sync-debug`)
2. ✅ Shell script for full debug loop (`scripts/n8n-debug.sh`)

**How to Use**:
```bash
# Set your API key (one-time)
export N8N_API_KEY='your-n8n-api-key'

# Update workflow in n8n from local file
./scripts/n8n-debug.sh update

# Run workflow
./scripts/n8n-debug.sh run

# List recent executions
./scripts/n8n-debug.sh list

# Get execution details
./scripts/n8n-debug.sh execution <execution-id>

# Get specific node data
./scripts/n8n-debug.sh node <execution-id> "Decode to json"

# Save full execution to file for analysis
./scripts/n8n-debug.sh full <execution-id>
```

**Debug Loop Flow**:
```
1. Edit workflow JSON in Cursor
2. ./n8n-debug.sh update      # Push to n8n
3. ./n8n-debug.sh run         # Execute workflow
4. ./n8n-debug.sh list        # Get execution ID
5. ./n8n-debug.sh full <id>   # Get all node I/O
6. Analyze output in Cursor, iterate on fix
```

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
| `Get GitHub Tree` | Lists ALL files recursively via Trees API |
| `Filter Workflow Files` | Extracts JSON files from workflows/ directory |
| `GitHub` | Gets file content |
| `Decode to json` | Parses workflow JSON |
| `Aggregate GitHub Files` | Collects all files before comparison |
| `Split for Comparison` | Splits aggregated items for comparison |
| `n8n vs GitHub` | Compares by workflow ID |
| `Upload file` | Creates new files |
| `Update file` | Updates existing files |

