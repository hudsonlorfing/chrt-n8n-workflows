# n8n Workflow Development Process

## Pre-Flight Checklist (Run Before Every Session)

Before making ANY changes to workflows, run the sync script:

```bash
cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows
./scripts/n8n-sync.sh preflight
```

This will:
1. Pull latest changes from GitHub
2. Check for uncommitted local changes
3. Fetch latest workflow versions from n8n
4. Check recent executions for errors
5. Display sync status

## Quick Commands

```bash
# Full pre-flight check
./scripts/n8n-sync.sh preflight

# Pull from GitHub only
./scripts/n8n-sync.sh pull

# Sync FROM n8n to local (download latest)
./scripts/n8n-sync.sh download

# Push local changes to n8n
./scripts/n8n-sync.sh push

# Check recent executions for errors
./scripts/n8n-sync.sh errors

# Full status report
./scripts/n8n-sync.sh status
```

## Workflow Development Flow

### 1. Start of Session
```bash
./scripts/n8n-sync.sh preflight
```

### 2. Making Changes
- Edit workflow JSON files locally in Cursor
- Or edit in n8n UI, then download:
  ```bash
  ./scripts/n8n-sync.sh download
  ```

### 3. Testing Changes
```bash
# Update workflow in n8n
./scripts/n8n-debug.sh update <file> <workflow_id>

# Activate for testing
./scripts/n8n-debug.sh activate <workflow_id>

# Trigger via webhook or manual
./scripts/n8n-debug.sh trigger

# Check execution results
./scripts/n8n-debug.sh list 5
./scripts/n8n-debug.sh full <execution_id>
```

### 4. Committing Changes
```bash
git add -A
git commit -m "Description of changes"
git push origin main
```

### 5. End of Session
```bash
./scripts/n8n-sync.sh status
```

## Workflow IDs Reference

| Workflow | ID | Project |
|----------|----|----|
| Chrt GitHub Workflow Sync | `r4ICnvhdbQwejSdH` | ChrtWorkflows |
| 1. Lead Ingestion & ICP Scoring | `aLxwvqoSTkZAQ3fq` | ChrtWorkflows |
| 2. LinkedIn Outreach (PhantomBuster) | `kjjYKQEXv67Vl5MS` | ChrtWorkflows |
| 3. Connection Sync → HubSpot | `a56vnrPo9dsg5mmf` | ChrtWorkflows |
| 4. Lead Pipeline Monitor | `dWFsEXELFTJU0W01` | ChrtWorkflows |

## Project Info

- **Project ID**: `O7lTivDfRl72aS23`
- **Project Name**: ChrtWorkflows
- **n8n URL**: https://chrt.app.n8n.cloud
- **GitHub Repo**: https://github.com/hudsonlorfing/chrt-n8n-workflows

## Conflict Resolution

If you see conflicts between local/GitHub/n8n:

1. **n8n has newer changes**: Download from n8n first
   ```bash
   ./scripts/n8n-sync.sh download
   ```

2. **Local has newer changes**: Push to n8n
   ```bash
   ./scripts/n8n-debug.sh update <file> <workflow_id>
   ```

3. **GitHub has newer changes**: Pull first
   ```bash
   git pull origin main
   ```

4. **True conflict**: Compare timestamps and decide which version to keep

## Environment Setup

Required in `.env` file:
```
N8N_API_KEY=your-api-key-here
N8N_BASE_URL=https://chrt.app.n8n.cloud
```

## Best Practices

1. **Always run preflight** before starting work
2. **Tag testing workflows** with `#testing` until production-ready
3. **Deactivate workflows** while making changes
4. **Check executions** after deploying changes
5. **Commit frequently** to avoid losing work
6. **Document changes** in commit messages

