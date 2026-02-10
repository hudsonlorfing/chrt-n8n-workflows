# Chrt n8n Workflows

Version-controlled n8n workflow backups for Chrt.

## Current Status: 🚧 IN PROGRESS

See [STATUS.md](STATUS.md) for current issues and next steps.

## Quick Start (New Machine)

1. **Clone the repo**
   ```bash
   git clone git@github.com:hudsonlorfing/chrt-n8n-workflows.git
   cd chrt-n8n-workflows
   ```

2. **Install Doppler CLI**
   ```bash
   brew install dopplerhq/cli/doppler
   ```

3. **Login and setup**
   ```bash
   doppler login
   doppler setup  # Select "chrt" project, "prd" config
   ```

4. **Sync with n8n**
   ```bash
   ./scripts/n8n-ops/sync.sh sync
   ```

That's it! All secrets are loaded from Doppler automatically.

## Repository Structure

```
workflows/
├── chrt-github-workflow-sync.json    # The sync workflow itself
└── linkedin/                         # LinkedIn lead generation workflows
    ├── 1.-lead-ingestion-&-icp-scoring.json
    ├── 2.-linkedin-outreach-(phantombuster).json
    ├── 3.-connection-sync-→-hubspot.json
    └── 4.-lead-pipeline-monitor.json
scripts/
├── n8n-sync.sh                       # Main sync script
├── n8n-debug.sh                      # Debug/update utilities
├── setup-vps-ssh.sh                  # VPS SSH key setup
└── autofix-service/                  # Auto-fix service for n8n errors
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

1. **Pull latest from n8n** (source of truth):
   ```bash
   ./scripts/n8n-ops/sync.sh sync
   ```

2. **Edit workflow JSON** in Cursor

3. **Push to n8n**:
   ```bash
   ./scripts/n8n-ops/debug.sh update "workflows/linkedin/[workflow].json" [WORKFLOW_ID]
   ./scripts/n8n-ops/sync.sh sync
   ```

### Script Commands

| Command | Description |
|---------|-------------|
| `./scripts/n8n-ops/sync.sh sync` | Download from n8n and push to GitHub |
| `./scripts/n8n-ops/sync.sh download` | Download all workflows from n8n |
| `./scripts/n8n-ops/sync.sh preflight` | Pre-flight checks before editing |
| `./scripts/n8n-ops/debug.sh update FILE ID` | Push local file to n8n |

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
