# Project: Claude Code Auto-Fix System

## Overview

Implement an automated error-fixing system that uses Claude Code to analyze n8n workflow errors and attempt fixes up to 5 times. Each iteration resets to the original file to prevent compounding errors. Results are sent to Slack.

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐
│   n8n Cloud     │────▶│ Error Monitor        │
│   (Any Workflow)│     │ (Error Trigger)      │
└─────────────────┘     └──────────────────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │  Hostinger VPS       │
                        │  Auto-Fix Service    │
                        │  (Node.js)           │
                        └──────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
           ┌────────────┐  ┌────────────┐  ┌────────────┐
           │ Iteration 1│  │ Iteration 2│  │...up to 5  │
           │ Reset File │  │ Reset File │  │ Reset File │
           │ Claude Fix │  │ Claude Fix │  │ Claude Fix │
           │ Test       │  │ Test       │  │ Test       │
           └────────────┘  └────────────┘  └────────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │  Slack Notification  │
                        │  - Fixed / Still     │
                        │    Broken            │
                        │  - Summary of        │
                        │    attempts          │
                        └──────────────────────┘
```

## VPS Configuration

### SSH Access to Hostinger

```bash
# ~/.ssh/config entry for Hostinger VPS
Host hostinger-n8n
    HostName srv1230891.hstgr.cloud
    User root
    Port 22
    IdentityFile ~/.ssh/hostinger_n8n
    StrictHostKeyChecking no

# Alternative: Direct command
ssh root@srv1230891.hstgr.cloud -i ~/.ssh/hostinger_n8n
```

### VPS Details

| Setting | Value |
|---------|-------|
| Host | srv1230891.hstgr.cloud |
| n8n URL | https://srv1230891.hstgr.cloud |
| Plan | KVM 2 (8GB RAM, 2 vCPU) |
| SSH User | root |
| n8n Data Dir | /root/.n8n (typical Docker setup) |

## Implementation Plan

### Phase 1: Core Auto-Fix Service

**File:** `scripts/claude-autofix.js`

```javascript
// Key components:

const MAX_ITERATIONS = 5;

async function autoFix(errorData) {
  const originalFile = await backupWorkflow(errorData.workflowId);
  let lastError = errorData;
  let attempts = [];
  
  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    console.log(`\n🔄 Iteration ${i}/${MAX_ITERATIONS}`);
    
    // 1. Reset to original (prevent compounding)
    await restoreWorkflow(originalFile, errorData.workflowId);
    
    // 2. Run Claude Code to analyze and fix
    const fix = await runClaudeFix(lastError, i);
    attempts.push({ iteration: i, fix });
    
    if (!fix.success) {
      continue; // Claude couldn't generate a fix
    }
    
    // 3. Apply the fix
    await applyFix(fix);
    
    // 4. Push to n8n and test
    const testResult = await testWorkflow(errorData.workflowId);
    
    if (testResult.success) {
      // Fixed! Send success Slack message
      await notifySlack({
        status: 'fixed',
        workflow: errorData.workflowName,
        iteration: i,
        fix: fix.summary,
        attempts
      });
      return { fixed: true, iteration: i };
    }
    
    // Update lastError for next iteration
    lastError = testResult.error;
  }
  
  // All iterations failed
  await restoreWorkflow(originalFile, errorData.workflowId);
  await notifySlack({
    status: 'failed',
    workflow: errorData.workflowName,
    attempts,
    originalError: errorData
  });
  
  return { fixed: false, attempts };
}
```

### Phase 2: Claude Code Integration

**Key principle:** Each iteration starts fresh to avoid compounding errors.

```javascript
async function runClaudeFix(errorData, iteration) {
  const prompt = buildFixPrompt(errorData, iteration);
  
  // Use claude-code CLI with specific flags
  const result = await execAsync(`claude -p "${prompt}" \
    --allowedTools Edit,Write,Read \
    --max-turns 3 \
    --output-format json`, {
    cwd: WORKFLOWS_DIR,
    timeout: 120000
  });
  
  return parseClaudeResult(result);
}

function buildFixPrompt(errorData, iteration) {
  return `
# n8n Workflow Auto-Fix - Iteration ${iteration}

## Error to Fix
- Workflow: ${errorData.workflowName}
- Node: ${errorData.errorNode}
- Error: ${errorData.errorMessage}

## Previous Attempts
${iteration > 1 ? 'Previous fixes failed. Try a different approach.' : 'First attempt.'}

## Instructions
1. Read the workflow file: workflows/${errorData.workflowFile}
2. Analyze the error and identify the root cause
3. Make minimal, targeted changes to fix the issue
4. DO NOT make unrelated changes
5. Focus on the specific failing node

## Output Required
After making changes, provide a JSON summary:
{
  "fixed_node": "name of node you fixed",
  "change_summary": "one sentence description",
  "confidence": "high|medium|low"
}
`;
}
```

### Phase 3: Slack Notifications

**Success Message:**
```
✅ Workflow Fixed: 3. Connection Sync → HubSpot

📋 Summary:
- Error: "Cannot read property 'email' of undefined"
- Fixed Node: Prepare HubSpot Data
- Fix: Added null check for email field
- Iterations: 2/5

🔗 View execution: [link]
```

**Failure Message:**
```
❌ Auto-Fix Failed: 3. Connection Sync → HubSpot

📋 Attempted Fixes (5/5):
1. Added null check → Still failed
2. Changed field mapping → Still failed
3. Added default value → Still failed
4. Modified condition → Still failed
5. Restructured node → Still failed

⚠️ Manual intervention required

🔗 Error details: [link]
📝 Debug logs: [path]
```

### Phase 4: Integration with Error Monitor

Update `5.-error-monitor-webhook.json` to call the auto-fix service:

```javascript
// In Error Monitor workflow
// After Format Error node, add HTTP Request to VPS:

POST https://srv1230891.hstgr.cloud:3848/auto-fix
{
  "workflowId": "{{ $json.details.workflow.id }}",
  "workflowName": "{{ $json.details.workflow.name }}",
  "executionId": "{{ $json.details.execution.id }}",
  "errorNode": "{{ $json.details.error.node }}",
  "errorMessage": "{{ $json.details.error.message }}",
  "errorStack": "{{ $json.details.error.stack }}"
}
```

## File Structure

```
scripts/
├── claude-autofix.js        # Main auto-fix service
├── autofix-config.js        # Configuration
├── autofix-slack.js         # Slack notification helpers
├── autofix-test.js          # Workflow testing utilities
└── autofix-backup.js        # File backup/restore utilities

workflows/
├── backups/                 # Original file backups (gitignored)
│   └── .gitkeep
└── ...existing workflows...
```

## Environment Variables

Add to `.env`:
```bash
# Existing
N8N_API_KEY=your_api_key
N8N_BASE_URL=https://chrt.app.n8n.cloud

# New for Auto-Fix
AUTOFIX_PORT=3848
AUTOFIX_MAX_ITERATIONS=5
AUTOFIX_TIMEOUT=120000

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
SLACK_CHANNEL=#n8n-alerts

# VPS SSH (for remote deployment)
VPS_HOST=srv1230891.hstgr.cloud
VPS_USER=root
VPS_SSH_KEY=~/.ssh/hostinger_n8n
```

## Deployment

### Local Development
```bash
# Start auto-fix service locally
node scripts/claude-autofix.js
```

### Deploy to Hostinger VPS
```bash
# SSH and deploy
ssh hostinger-n8n << 'EOF'
cd /opt/n8n-autofix
git pull
npm install
pm2 restart autofix
EOF
```

## Testing

### Test Auto-Fix Manually
```bash
# Trigger with test error
curl -X POST http://localhost:3848/auto-fix \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "a56vnrPo9dsg5mmf",
    "workflowName": "3. Connection Sync → HubSpot",
    "errorNode": "Prepare HubSpot Data",
    "errorMessage": "Cannot read property email of undefined"
  }'
```

### Test Slack Notification
```bash
curl -X POST http://localhost:3848/test-slack
```

## Safety Measures

1. **File Backups**: Always backup before any modification
2. **Reset on Each Iteration**: Prevents compounding errors
3. **Max Iterations**: Hard limit of 5 attempts
4. **Timeout**: 2-minute limit per Claude operation
5. **Restore on Failure**: Original file restored if all attempts fail
6. **Git Integration**: Changes tracked in version control
7. **Allowed Tools**: Claude restricted to Edit, Write, Read only

## Timeline

| Phase | Description | Duration |
|-------|-------------|----------|
| 1 | Core service scaffold | 2 hours |
| 2 | Claude Code integration | 3 hours |
| 3 | Slack notifications | 1 hour |
| 4 | Error Monitor integration | 1 hour |
| 5 | Testing & deployment | 2 hours |
| **Total** | | **~9 hours** |

## Success Criteria

- [ ] Auto-fix service runs on Hostinger VPS
- [ ] Errors trigger auto-fix attempts (up to 5)
- [ ] Each iteration resets to original file
- [ ] Slack notifications sent for success/failure
- [ ] Original workflow restored if all attempts fail
- [ ] Logs captured for debugging

