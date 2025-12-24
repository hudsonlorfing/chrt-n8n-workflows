# Chrt n8n Workflows

Version-controlled n8n workflow backups for Chrt.

## Repository Structure

```
workflows/
├── workflow-1-lead-intake.json       # Lead intake from Gmail/Squarespace
├── workflow-2-nurturing-sequence.json # 14-day nurture sequence
├── workflow-3-response-handler.json   # Response detection/handling
├── workflow-4-call-intelligence.json  # Call analysis pipeline
└── linkedin-gen/                      # LinkedIn lead generation workflows
    ├── workflow-1-linkedin-Ingestion.json
    ├── workflow-2. LinkedIn Outreach (PhantomBuster).json
    └── workflow-3 Connection Sync → HubSpot.json
```

## Sync Setup

This repo is synced bidirectionally with our n8n Cloud instance using the **Bidirectional GitHub Workflow Sync** template (#5081).

### How It Works

1. **n8n → GitHub**: Scheduled sync exports workflows from n8n to this repo
2. **GitHub → n8n**: When you push changes here, the sync workflow imports them back to n8n

### Editing Workflows

1. Pull latest changes:
   ```bash
   git pull origin main
   ```

2. Open workflow JSON in Cursor and edit

3. Commit and push:
   ```bash
   git add .
   git commit -m "Updated [workflow name]: [description]"
   git push
   ```

4. Wait for sync (runs on schedule) or trigger manually in n8n

## Workflow JSON Structure

Each workflow file contains:
- `name`: Workflow display name
- `nodes[]`: Array of node configurations
- `connections{}`: How nodes connect to each other
- `settings`: Execution settings
- `tags[]`: Workflow tags

### Important Notes

- **Credential IDs** are instance-specific and won't transfer between n8n instances
- **Node IDs** must be unique within a workflow
- Test in n8n after importing to verify connections work

## Related

- [n8n Documentation](https://docs.n8n.io)
- [Sync Template #5081](https://n8n.io/workflows/5081)

