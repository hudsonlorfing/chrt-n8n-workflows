#!/usr/bin/env node

/**
 * n8n Auto-Debug Server
 * 
 * This script runs a local HTTP server that receives error notifications from n8n
 * and uses Claude (via claude-code CLI or API) to diagnose and potentially fix issues.
 * 
 * Based on techniques from Network Chuck's n8n + Claude Code integration:
 * - https://www.youtube.com/watch?v=s96JeuuwLzc
 * 
 * Usage:
 *   node auto-debug-server.js                    # Start the server
 *   node auto-debug-server.js --port 3847        # Custom port
 *   node auto-debug-server.js --mode analyze     # Only analyze, don't fix
 *   node auto-debug-server.js --mode fix         # Analyze and suggest fixes
 */

const http = require('http');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  port: parseInt(process.env.AUTO_DEBUG_PORT || '3847'),
  mode: process.env.AUTO_DEBUG_MODE || 'analyze', // 'analyze' or 'fix'
  n8nApiKey: process.env.N8N_API_KEY,
  n8nBaseUrl: process.env.N8N_BASE_URL || 'https://chrt.app.n8n.cloud',
  workflowsDir: path.join(__dirname, '..', 'workflows'),
  logsDir: path.join(__dirname, '..', 'debug-logs'),
  claudeCommand: process.env.CLAUDE_COMMAND || 'claude', // or 'cursor' for Cursor CLI
};

// Load .env if exists
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
  CONFIG.n8nApiKey = process.env.N8N_API_KEY;
}

// Ensure logs directory exists
if (!fs.existsSync(CONFIG.logsDir)) {
  fs.mkdirSync(CONFIG.logsDir, { recursive: true });
}

// Workflow ID to file mapping
const WORKFLOW_MAP = {
  'r4ICnvhdbQwejSdH': 'chrt-github-workflow-sync.json',
  'aLxwvqoSTkZAQ3fq': 'linkedin/1.-lead-ingestion-&-icp-scoring.json',
  'kjjYKQEXv67Vl5MS': 'linkedin/2.-linkedin-outreach-(phantombuster).json',
  'a56vnrPo9dsg5mmf': 'linkedin/3.-connection-sync-→-hubspot.json',
  'dWFsEXELFTJU0W01': 'linkedin/4.-lead-pipeline-monitor.json',
};

/**
 * Fetch execution details from n8n API
 */
async function fetchExecutionDetails(executionId) {
  if (!CONFIG.n8nApiKey) {
    console.log('⚠️  No N8N_API_KEY set, cannot fetch execution details');
    return null;
  }

  try {
    const response = await fetch(
      `${CONFIG.n8nBaseUrl}/api/v1/executions/${executionId}?data=true`,
      {
        headers: { 'X-N8N-API-KEY': CONFIG.n8nApiKey }
      }
    );
    
    if (!response.ok) {
      console.log(`⚠️  Failed to fetch execution: ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (err) {
    console.log(`⚠️  Error fetching execution: ${err.message}`);
    return null;
  }
}

/**
 * Get the local workflow file path
 */
function getWorkflowPath(workflowId) {
  const fileName = WORKFLOW_MAP[workflowId];
  if (!fileName) return null;
  return path.join(CONFIG.workflowsDir, fileName);
}

/**
 * Build the Claude prompt for error analysis
 */
function buildAnalysisPrompt(errorData, executionDetails, workflowContent) {
  let prompt = `# n8n Workflow Error Analysis

## Error Summary
- **Workflow**: ${errorData.details.workflow.name} (ID: ${errorData.details.workflow.id})
- **Execution ID**: ${errorData.details.execution.id}
- **Failed Node**: ${errorData.details.error.node}
- **Error Message**: ${errorData.details.error.message}
- **Timestamp**: ${errorData.timestamp}

## Error Stack (truncated)
\`\`\`
${errorData.details.error.stack}
\`\`\`
`;

  if (executionDetails?.data) {
    prompt += `
## Execution Data
The execution ran through these nodes before failing:
\`\`\`json
${JSON.stringify(Object.keys(executionDetails.data.resultData?.runData || {}), null, 2)}
\`\`\`
`;
  }

  if (workflowContent) {
    // Extract just the relevant node
    const nodes = workflowContent.nodes || [];
    const failedNode = nodes.find(n => n.name === errorData.details.error.node);
    
    if (failedNode) {
      prompt += `
## Failed Node Configuration
\`\`\`json
${JSON.stringify(failedNode, null, 2)}
\`\`\`
`;
    }
    
    // Show connections to/from the failed node
    const connections = workflowContent.connections || {};
    const relevantConnections = {};
    for (const [fromNode, conns] of Object.entries(connections)) {
      if (fromNode === errorData.details.error.node) {
        relevantConnections[fromNode] = conns;
      } else if (conns.main) {
        for (const outputs of conns.main) {
          if (outputs?.some(c => c.node === errorData.details.error.node)) {
            relevantConnections[fromNode] = conns;
          }
        }
      }
    }
    
    if (Object.keys(relevantConnections).length > 0) {
      prompt += `
## Relevant Connections
\`\`\`json
${JSON.stringify(relevantConnections, null, 2)}
\`\`\`
`;
    }
  }

  prompt += `
## Task
1. Analyze the error and identify the root cause
2. Explain what went wrong in simple terms
3. ${CONFIG.mode === 'fix' ? 'Provide a specific code fix or configuration change' : 'Suggest how to fix it'}
4. If this is a common n8n pattern issue, explain the correct approach

Please be concise and actionable.
`;

  return prompt;
}

/**
 * Run Claude analysis (headless mode)
 */
async function runClaudeAnalysis(prompt, sessionId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const promptFile = path.join(CONFIG.logsDir, `prompt-${timestamp}.md`);
  const outputFile = path.join(CONFIG.logsDir, `analysis-${timestamp}.md`);
  
  // Save prompt for reference
  fs.writeFileSync(promptFile, prompt);
  console.log(`📝 Prompt saved to: ${promptFile}`);
  
  try {
    // Try claude-code CLI first (headless mode with -p flag)
    // Based on Network Chuck's approach: claude -p "prompt" --session-id <id>
    const claudeArgs = ['-p', prompt];
    if (sessionId) {
      claudeArgs.push('--session-id', sessionId);
    }
    
    console.log(`🤖 Running Claude analysis...`);
    
    // Use spawn for better output handling
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';
      
      const claude = spawn(CONFIG.claudeCommand, claudeArgs, {
        cwd: CONFIG.workflowsDir,
        env: { ...process.env },
        timeout: 120000 // 2 minute timeout
      });
      
      claude.stdout.on('data', (data) => {
        output += data.toString();
        process.stdout.write(data); // Stream output
      });
      
      claude.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      claude.on('close', (code) => {
        if (code === 0 || output.length > 0) {
          fs.writeFileSync(outputFile, output);
          console.log(`\n✅ Analysis saved to: ${outputFile}`);
          resolve({ success: true, output, outputFile });
        } else {
          console.log(`⚠️  Claude exited with code ${code}`);
          console.log(`stderr: ${errorOutput}`);
          resolve({ success: false, error: errorOutput || `Exit code: ${code}` });
        }
      });
      
      claude.on('error', (err) => {
        console.log(`⚠️  Claude command not available: ${err.message}`);
        console.log('💡 Falling back to saving prompt for manual analysis');
        resolve({ 
          success: false, 
          error: err.message,
          promptFile,
          fallbackMessage: 'Claude CLI not available. Use the saved prompt file for manual analysis with Cursor or Claude.'
        });
      });
    });
  } catch (err) {
    console.log(`⚠️  Error running Claude: ${err.message}`);
    return { 
      success: false, 
      error: err.message,
      promptFile,
      fallbackMessage: 'Use the saved prompt file for manual analysis.'
    };
  }
}

/**
 * Handle incoming error webhook
 */
async function handleError(errorData) {
  console.log('\n' + '='.repeat(60));
  console.log(`🚨 ERROR RECEIVED: ${errorData.summary}`);
  console.log('='.repeat(60));
  
  const workflowId = errorData.debugContext.workflowId;
  const executionId = errorData.debugContext.executionId;
  
  // Fetch additional context
  console.log('\n📡 Fetching execution details...');
  const executionDetails = await fetchExecutionDetails(executionId);
  
  // Load local workflow file
  let workflowContent = null;
  const workflowPath = getWorkflowPath(workflowId);
  if (workflowPath && fs.existsSync(workflowPath)) {
    console.log(`📁 Loading workflow from: ${workflowPath}`);
    workflowContent = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  }
  
  // Build and run analysis
  const prompt = buildAnalysisPrompt(errorData, executionDetails, workflowContent);
  const sessionId = `n8n-debug-${workflowId}-${Date.now()}`;
  
  console.log('\n🔍 Starting analysis...\n');
  const result = await runClaudeAnalysis(prompt, sessionId);
  
  return {
    ...result,
    workflowId,
    executionId,
    sessionId
  };
}

/**
 * Create HTTP server
 */
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.method === 'POST' && req.url === '/n8n-error') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const errorData = JSON.parse(body);
        console.log('\n📨 Received error notification');
        
        const result = await handleError(errorData);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'processed',
          result
        }));
      } catch (err) {
        console.error('❌ Error processing request:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', mode: CONFIG.mode }));
    return;
  }
  
  // Manual trigger endpoint
  if (req.method === 'POST' && req.url === '/analyze') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const { workflowId, executionId } = JSON.parse(body);
        
        // Build error data from params
        const errorData = {
          summary: `Manual analysis for workflow ${workflowId}`,
          details: {
            workflow: { id: workflowId, name: 'Unknown' },
            execution: { id: executionId, startedAt: new Date().toISOString() },
            error: { node: 'Unknown', message: 'Manual analysis requested', stack: '' }
          },
          debugContext: { workflowId, executionId },
          timestamp: new Date().toISOString()
        };
        
        const result = await handleError(errorData);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'analyzed', result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  
  res.writeHead(404);
  res.end('Not Found');
});

// Start server
server.listen(CONFIG.port, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           n8n Auto-Debug Server                               ║
╠═══════════════════════════════════════════════════════════════╣
║  Port: ${CONFIG.port.toString().padEnd(54)}║
║  Mode: ${CONFIG.mode.padEnd(54)}║
║  Claude: ${CONFIG.claudeCommand.padEnd(52)}║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    POST /n8n-error   - Receive error webhooks from n8n        ║
║    POST /analyze     - Manual analysis trigger                ║
║    GET  /health      - Health check                           ║
╠═══════════════════════════════════════════════════════════════╣
║  To use with n8n:                                             ║
║  1. Add this workflow's webhook URL to your n8n error         ║
║     settings or create a workflow that posts errors here      ║
║  2. When errors occur, they'll be automatically analyzed      ║
╚═══════════════════════════════════════════════════════════════╝
`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  server.close();
  process.exit(0);
});

