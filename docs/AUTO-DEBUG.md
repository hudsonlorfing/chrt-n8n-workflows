# n8n Auto-Debug System

Automated error detection and analysis for n8n workflows using Claude AI.

Based on techniques from [Network Chuck's n8n + Claude Code integration](https://www.youtube.com/watch?v=s96JeuuwLzc).

## Overview

This system provides two ways to automatically analyze n8n workflow errors:

1. **Shell Script** (`auto-debug.sh`) - Manual or scheduled error checking
2. **Node Server** (`auto-debug-server.js`) - Real-time webhook listener

Both tools use Claude AI to analyze errors and suggest fixes.

## Quick Start

### 1. Check for Recent Errors

```bash
cd /Users/hudsonlorfing/Documents/Business/Chrt/workflows/chrt-n8n-workflows
./scripts/legacy/auto-debug.sh check
```

### 2. Analyze a Specific Execution

```bash
./scripts/legacy/auto-debug.sh analyze <execution_id>
```

### 3. Start Continuous Monitoring

```bash
./scripts/legacy/auto-debug.sh watch
```

## Setup

### Prerequisites

1. **n8n API Key** - Set in `.env`:
   ```
   N8N_API_KEY=your_api_key
   N8N_BASE_URL=https://chrt.app.n8n.cloud
   ```

2. **Claude Code CLI** (optional but recommended):
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
   
   If not installed, the tools will save analysis prompts for manual use in Cursor.

### Shell Script Usage

```bash
# Check last 5 executions for errors
./scripts/legacy/auto-debug.sh check

# Check last 10 executions
./scripts/legacy/auto-debug.sh check 10

# Analyze specific execution
./scripts/legacy/auto-debug.sh analyze 397

# Continuous monitoring (checks every minute)
./scripts/legacy/auto-debug.sh watch
```

### Node Server Usage

Start the server to receive real-time error notifications from n8n:

```bash
node scripts/auto-debug-server.js
```

The server listens on port 3847 by default. Configure the Error Monitor Webhook workflow to send errors here.

**Environment Variables:**
- `AUTO_DEBUG_PORT` - Server port (default: 3847)
- `AUTO_DEBUG_MODE` - `analyze` or `fix` (default: analyze)
- `CLAUDE_COMMAND` - Claude CLI command (default: `claude`)

## n8n Error Webhook Setup

1. **Import the workflow**: `workflows/5.-error-monitor-webhook.json`

2. **Configure execution error notifications** in n8n:
   - Go to Settings → Workflow Settings
   - Enable "Error Workflow" 
   - Select the "5. Error Monitor Webhook" workflow

3. **How it works**:
   - When any workflow errors, n8n triggers the error webhook
   - The webhook filters out manual triggers (only monitors automated executions)
   - Error details are sent to the local auto-debug server
   - Claude analyzes the error and suggests fixes

## Output Files

All analysis files are saved to `debug-logs/`:

- `prompt-<id>-<timestamp>.md` - The analysis prompt sent to Claude
- `analysis-<id>-<timestamp>.md` - Claude's analysis and suggestions
- `execution-<id>-<timestamp>.json` - Raw execution data from n8n

## Using with Cursor

If Claude CLI is not available, you can use the saved prompt files directly in Cursor:

1. Run `./scripts/legacy/auto-debug.sh analyze <exec_id>`
2. Open the generated prompt file in Cursor
3. Use Cursor's Claude integration to analyze

Alternatively, the Node server saves prompts that can be opened in Cursor for manual analysis.

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐
│   n8n Cloud     │────▶│ Error Monitor        │
│   (Workflow)    │     │ Webhook Workflow     │
└─────────────────┘     └──────────────────────┘
                                   │
                                   ▼
┌─────────────────┐     ┌──────────────────────┐
│  auto-debug.sh  │────▶│  auto-debug-server   │
│  (Manual/Cron)  │     │  (Real-time)         │
└─────────────────┘     └──────────────────────┘
         │                         │
         ▼                         ▼
┌──────────────────────────────────────────────┐
│              Claude AI Analysis              │
│  - Root cause identification                 │
│  - Fix suggestions                           │
│  - Pattern recognition                       │
└──────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────┐
│            debug-logs/                       │
│  - prompts, analyses, execution data         │
└──────────────────────────────────────────────┘
```

## Tips

1. **Start simple**: Use `auto-debug.sh check` to find errors, then `analyze` specific ones.

2. **Session management**: When using the Node server, each error gets a unique session ID for potential follow-up questions.

3. **Context is key**: The system includes relevant node configurations and execution data in the analysis prompt for better diagnoses.

4. **Manual triggers excluded**: The webhook workflow automatically skips errors from manually triggered workflows to avoid noise.

## Troubleshooting

**Claude CLI not found:**
- Install with `npm install -g @anthropic-ai/claude-code`
- Or use prompts manually in Cursor

**API errors:**
- Check that `N8N_API_KEY` is set correctly in `.env`
- Verify API key has execution read permissions

**Webhook not receiving:**
- Ensure the Error Monitor Webhook workflow is active
- Check that the local server is running on the correct port

