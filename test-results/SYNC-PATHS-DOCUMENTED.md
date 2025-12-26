# Chrt GitHub Workflow Sync - Path Documentation

Generated: 2025-12-26
Last Full Test: 2025-12-26 (Executions #362, #363)

## Workflow Overview

The sync workflow handles bidirectional synchronization between n8n Cloud and GitHub.

## Test Results Summary

| Path | Status | Execution | Verified |
|------|--------|-----------|----------|
| n8n → GitHub (new) | ✅ WORKING | #362 | Upload file |
| n8n → GitHub (update) | ✅ WORKING | #362, #363 | Update file |
| GitHub → n8n (update) | ✅ WORKING | #362, #363 | Update workflow in n8n |
| GitHub → n8n (new) | ✅ WORKING | #362, #363 | Create new workflow in n8n |
| Path Change (tag) | ✅ WORKING | #363 | Create at New Path |

## Tested Paths

### Path 1: n8n Newer than GitHub (Update GitHub) ✅ WORKING

**Trigger**: When a workflow in n8n has a more recent `updatedAt` timestamp than the same workflow in GitHub.

**Flow**:
```
n8n vs GitHub (output 2: same in both, n8n newer)
    → If n8n before GitHub (FALSE branch)
    → Code - InputA (prepares workflow data)
    → If Path Changed
        → FALSE: Edit Fields → Json file1 → To base → Edit for Update → Update file
        → TRUE: Edit Fields (Move) → Json file (Move) → To base (Move) → Edit for Move → Create at New Path
```

**Nodes Executed**:
- Code - InputA
- If Path Changed  
- Edit Fields (for same path updates)
- Json file1
- To base
- Edit for Update
- Update file

### Path 2: GitHub Newer than n8n (Update n8n) ✅ WORKING

**Trigger**: When a workflow in GitHub has a more recent `updatedAt` timestamp than the same workflow in n8n.

**Flow**:
```
n8n vs GitHub (output 2: same in both, GitHub newer)
    → If n8n before GitHub (TRUE branch)
    → Code - InputB (prepares GitHub workflow data)
    → Update workflow in n8n
```

**Test**: Created workflow in n8n, then pushed a modified version to GitHub with future `updatedAt` timestamp. Sync correctly updated n8n workflow from GitHub.

### Path 3: Only in n8n (Create in GitHub) ✅ WORKING

**Trigger**: When a workflow exists in n8n but not in GitHub.

**Flow**:
```
n8n vs GitHub (output 0: only in n8n)
    → Json file
    → To base64
    → Edit for Upload
    → Upload file
```

**Test**: Created `TEST-SyncPath-OnlyInN8n` workflow in n8n. Sync correctly created `test-syncpath-onlyinn8n.json` in GitHub.

### Path 4: Only in GitHub (Create in n8n) ✅ WORKING

**Trigger**: When a workflow JSON exists in GitHub but not in n8n.

**Flow**:
```
n8n vs GitHub (output 3: only in GitHub)
    → Create new workflow in n8n
```

**Test**: Created `test-syncpath-onlyingithub.json` in GitHub (no n8n ID). Sync correctly created `TEST-SyncPath-OnlyInGitHub` workflow in n8n.

### Path 5: File Move (Tag Changed) ✅ WORKING

**Trigger**: When a workflow's tag changes (e.g., from untagged to "linkedin"), causing its expected GitHub path to change.

**Flow**:
```
Code - InputA (detects _pathChanged = true)
    → If Path Changed (TRUE branch)
    → Edit Fields (Move)
    → Json file (Move)
    → To base (Move)
    → Edit for Move
    → Create at New Path
```

**Test**: Created `TEST-SyncPath-NewTag` workflow without tag (synced to root). Added "linkedin" tag. Sync correctly created `workflows/linkedin/test-syncpath-newtag.json`.

**Note**: The old file at root remains (sync creates at new path but doesn't delete old). Manual cleanup may be needed.

## Core Pipeline (Always Executed)

These nodes run on every sync:

1. **Triggers**: Schedule Trigger OR Debug Webhook
2. **Set GitHub Details**: Configuration (account, repo, paths)
3. **n8n**: Fetch all workflows from n8n
4. **Filter Chrt Project**: Filter to project ID `O7lTivDfRl72aS23`
5. **Build Folder Paths1**: Add `_folderPath` and `_fileName` based on tags
6. **Get GitHub Tree**: Fetch entire GitHub repo tree recursively
7. **Filter Workflow Files**: Extract JSON files from workflows/ directory
8. **GitHub**: Fetch content for each JSON file
9. **Decode to json**: Parse Base64 content to JSON
10. **Aggregate GitHub Files**: Collect all files before comparison
11. **Split for Comparison**: Split back to individual items
12. **n8n vs GitHub**: Compare by workflow ID

## Execution Summary (Test #361)

| Node | Status |
|------|--------|
| Aggregate GitHub Files | ✅ |
| Build Folder Paths1 | ✅ |
| Code - InputA | ✅ |
| Debug Webhook | ✅ |
| Decode to json | ✅ |
| Edit Fields | ✅ |
| Edit for Update | ✅ |
| Filter Chrt Project | ✅ |
| Filter Workflow Files | ✅ |
| Get GitHub Tree | ✅ |
| GitHub | ✅ |
| If Path Changed | ✅ |
| If n8n before GitHub | ✅ |
| Json file1 | ✅ |
| Set GitHub Details | ✅ |
| Split for Comparison | ✅ |
| To base | ✅ |
| Update file | ✅ |
| n8n | ✅ |
| n8n vs GitHub | ✅ |

## How to Test Other Paths

### To test "GitHub Newer" (Path 2):
1. Edit a workflow JSON directly in GitHub
2. Commit without running sync first
3. Run sync - should trigger Code - InputB → Update workflow in n8n

### To test "Only in n8n" (Path 3):
1. Create a new workflow in n8n with the "linkedin" or "hubspot" tag
2. Run sync - should trigger Upload file

### To test "Only in GitHub" (Path 4):
1. Create a new JSON file in workflows/ directory in GitHub
2. Run sync - should trigger Create new workflow in n8n

### To test "File Move" (Path 5):
1. Change a workflow's tag in n8n (e.g., add "linkedin" tag)
2. Run sync - should trigger Create at New Path

