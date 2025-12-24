# Chrt n8n Workflows

Version-controlled n8n workflow backups for Chrt.

## Current Status: 🚧 IN PROGRESS

See [STATUS.md](STATUS.md) for current issues and next steps.

## Repository Structure

```
workflows/
├── chrt-github-workflow-sync.json    # The sync workflow itself
└── linkedin/                         # LinkedIn lead generation workflows
    ├── 1.-lead-ingestion-&-icp-scoring.json
    ├── 2.-linkedin-outreach-(phantombuster).json
    └── 3.-connection-sync-→-hubspot.json
sync-template-5081.json               # Sync workflow template (import to n8n)
```

## Sync Setup

This repo is synced bidirectionally with our n8n Cloud instance using a customized version of the **Bidirectional GitHub Workflow Sync** template (#5081).

### Configuration

| Setting | Value |
|---------|-------|
| n8n Project ID | `O7lTivDfRl72aS23` |
| GitHub Account | `hudsonlorfing` |
| Repository | `chrt-n8n-workflows` |
| Workflows Path | `workflows` |

### How It Works

1. **n8n → GitHub**: Scheduled sync exports workflows from n8n to this repo
2. **GitHub → n8n**: When you push changes here, the sync workflow imports them back to n8n
3. **Folder Structure**: Workflows with tags (linkedin, hubspot, connections) are placed in matching folders

### Editing Workflows Locally

1. Pull latest changes:
   ```bash
   cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows
   git pull origin main
   ```

2. Open workflow JSON in Cursor and edit

3. Commit and push:
   ```bash
   git add .
   git commit -m "Updated [workflow name]: [description]"
   git push origin main
   ```

4. Wait for sync (runs on schedule) or trigger manually in n8n

## Workflow JSON Structure

Each workflow file contains:
- `name`: Workflow display name
- `nodes[]`: Array of node configurations
- `connections{}`: How nodes connect to each other
- `settings`: Execution settings
- `tags[]`: Workflow tags (used for folder placement)

### Important Notes

- **Credential IDs** are instance-specific and won't transfer between n8n instances
- **Node IDs** must be unique within a workflow
- Test in n8n after importing to verify connections work
- Workflows must have the `linkedin`, `hubspot`, or `connections` tag to be placed in subfolders

## Related

- [n8n Documentation](https://docs.n8n.io)
- [Sync Template #5081](https://n8n.io/workflows/5081)
- [STATUS.md](STATUS.md) - Current issues and next steps
