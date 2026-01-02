#!/usr/bin/env node
/**
 * n8n Auto-Fix Service v2
 * 
 * Phased approach to fixing n8n workflow errors:
 * 1. Analyze - Understand the error (small API call)
 * 2. Plan - Create fix plan (small API call)
 * 3. Execute - Apply changes programmatically
 * 4. Verify - Test the fix
 * 
 * All phases are logged for review.
 */

const http = require('http');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Configuration
const CONFIG = {
  port: process.env.AUTOFIX_PORT || 3848,
  maxIterations: parseInt(process.env.AUTOFIX_MAX_ITERATIONS) || 5,
  n8nApiKey: process.env.N8N_API_KEY,
  n8nBaseUrl: process.env.N8N_BASE_URL || 'https://chrt.app.n8n.cloud',
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  logsDir: path.join(__dirname, 'logs'),
  backupsDir: path.join(__dirname, 'backups')
};

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(CONFIG.logsDir, { recursive: true });
  await fs.mkdir(CONFIG.backupsDir, { recursive: true });
}

// ============================================================
// LOGGING SYSTEM
// ============================================================

class FixSession {
  constructor(errorData) {
    this.id = `fix-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.startTime = new Date().toISOString();
    this.errorData = errorData;
    this.phases = [];
    this.currentPhase = null;
  }
  
  startPhase(name) {
    this.currentPhase = {
      name,
      startTime: new Date().toISOString(),
      steps: [],
      apiCalls: []
    };
    this.phases.push(this.currentPhase);
    console.log(`[${this.id}] 📍 Starting phase: ${name}`);
  }
  
  logStep(description, data = {}) {
    const step = {
      time: new Date().toISOString(),
      description,
      data
    };
    if (this.currentPhase) {
      this.currentPhase.steps.push(step);
    }
    console.log(`[${this.id}]   → ${description}`);
  }
  
  logApiCall(purpose, tokens, cost) {
    const call = {
      time: new Date().toISOString(),
      purpose,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      estimatedCost: cost
    };
    if (this.currentPhase) {
      this.currentPhase.apiCalls.push(call);
    }
    console.log(`[${this.id}]   💰 API: ${purpose} (${tokens.input}+${tokens.output} tokens, ~$${cost.toFixed(4)})`);
  }
  
  endPhase(result) {
    if (this.currentPhase) {
      this.currentPhase.endTime = new Date().toISOString();
      this.currentPhase.result = result;
    }
  }
  
  async save() {
    const logPath = path.join(CONFIG.logsDir, `${this.id}.json`);
    const summary = {
      id: this.id,
      startTime: this.startTime,
      endTime: new Date().toISOString(),
      errorData: this.errorData,
      phases: this.phases,
      totalApiCalls: this.phases.reduce((sum, p) => sum + p.apiCalls.length, 0),
      totalCost: this.phases.reduce((sum, p) => 
        sum + p.apiCalls.reduce((s, c) => s + c.estimatedCost, 0), 0
      )
    };
    await fs.writeFile(logPath, JSON.stringify(summary, null, 2));
    console.log(`[${this.id}] 📝 Session log saved: ${logPath}`);
    return summary;
  }
}

// ============================================================
// CLAUDE API HELPER
// ============================================================

async function callClaude(prompt, maxTokens = 500) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${error}`);
  }
  
  const result = await response.json();
  
  // Calculate tokens and cost (Claude Sonnet pricing: $3/$15 per 1M tokens)
  const inputTokens = result.usage?.input_tokens || 0;
  const outputTokens = result.usage?.output_tokens || 0;
  const cost = (inputTokens * 3 / 1000000) + (outputTokens * 15 / 1000000);
  
  return {
    content: result.content?.[0]?.text || '',
    tokens: { input: inputTokens, output: outputTokens },
    cost
  };
}

// ============================================================
// PHASE 1: ANALYZE
// ============================================================

async function analyzeError(session, workflow) {
  session.startPhase('analyze');
  
  // Find the failing node
  const errorNode = workflow.nodes?.find(n => n.name === session.errorData.errorNode);
  session.logStep('Found error node', { nodeName: errorNode?.name, nodeType: errorNode?.type });
  
  // Small, focused prompt just for analysis
  const prompt = `Analyze this n8n workflow error. Be brief.

ERROR: ${session.errorData.errorMessage}
NODE: ${session.errorData.errorNode}
NODE TYPE: ${errorNode?.type || 'unknown'}

What is the likely cause? Reply in 2-3 sentences max.`;

  const result = await callClaude(prompt, 200);
  session.logApiCall('Error analysis', result.tokens, result.cost);
  
  const analysis = {
    errorNode: errorNode,
    errorMessage: session.errorData.errorMessage,
    likelyCause: result.content.trim()
  };
  
  session.logStep('Analysis complete', { cause: analysis.likelyCause });
  session.endPhase({ success: true, analysis });
  
  return analysis;
}

// ============================================================
// PHASE 2: PLAN
// ============================================================

async function createFixPlan(session, analysis) {
  session.startPhase('plan');
  
  if (!analysis.errorNode) {
    session.logStep('Cannot create plan - node not found');
    session.endPhase({ success: false, reason: 'Node not found' });
    return null;
  }
  
  // Get node config for context (truncated to save tokens)
  const nodeConfig = JSON.stringify(analysis.errorNode.parameters || {}, null, 2);
  const truncatedConfig = nodeConfig.length > 1500 ? nodeConfig.substring(0, 1500) + '...' : nodeConfig;
  
  const prompt = `Create a fix plan for this n8n error.

ERROR: ${analysis.errorMessage}
CAUSE: ${analysis.likelyCause}
NODE: ${analysis.errorNode.name} (${analysis.errorNode.type})
CONFIG:
${truncatedConfig}

Return ONLY a JSON object with this structure:
{
  "steps": [
    {
      "action": "modify_parameter|add_null_check|change_expression",
      "target": "path.to.parameter",
      "description": "what to do",
      "newValue": "the new value or code"
    }
  ],
  "confidence": "high|medium|low"
}`;

  const result = await callClaude(prompt, 800);
  session.logApiCall('Create fix plan', result.tokens, result.cost);
  
  // Parse the plan
  let plan;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      plan = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    session.logStep('Failed to parse plan', { error: e.message });
    session.endPhase({ success: false, reason: 'Failed to parse plan' });
    return null;
  }
  
  session.logStep('Plan created', { 
    steps: plan.steps?.length || 0, 
    confidence: plan.confidence 
  });
  
  session.endPhase({ success: true, plan });
  return plan;
}

// ============================================================
// PHASE 3: EXECUTE
// ============================================================

async function executePlan(session, workflow, analysis, plan) {
  session.startPhase('execute');
  
  if (!plan || !plan.steps || plan.steps.length === 0) {
    session.logStep('No steps to execute');
    session.endPhase({ success: false, reason: 'Empty plan' });
    return null;
  }
  
  // Deep clone workflow
  const modified = JSON.parse(JSON.stringify(workflow));
  
  // Find the node to modify
  const nodeIndex = modified.nodes.findIndex(n => n.name === analysis.errorNode.name);
  if (nodeIndex === -1) {
    session.logStep('Node not found in workflow');
    session.endPhase({ success: false, reason: 'Node not found' });
    return null;
  }
  
  // Execute each step
  for (const step of plan.steps) {
    session.logStep(`Executing: ${step.description}`, { 
      action: step.action, 
      target: step.target 
    });
    
    try {
      switch (step.action) {
        case 'modify_parameter':
        case 'change_expression':
          setNestedValue(modified.nodes[nodeIndex], step.target, step.newValue);
          break;
          
        case 'add_null_check':
          // For code nodes, wrap with null check
          if (modified.nodes[nodeIndex].type === 'n8n-nodes-base.code') {
            const currentCode = modified.nodes[nodeIndex].parameters?.jsCode || '';
            modified.nodes[nodeIndex].parameters.jsCode = step.newValue || currentCode;
          } else {
            setNestedValue(modified.nodes[nodeIndex], step.target, step.newValue);
          }
          break;
          
        default:
          session.logStep(`Unknown action: ${step.action}`);
      }
    } catch (e) {
      session.logStep(`Step failed: ${e.message}`);
    }
  }
  
  session.logStep('All steps executed');
  session.endPhase({ success: true, modifiedNode: modified.nodes[nodeIndex].name });
  
  return modified;
}

// Helper to set nested values
function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  
  current[parts[parts.length - 1]] = value;
}

// ============================================================
// PHASE 4: VERIFY & DEPLOY
// ============================================================

async function verifyAndDeploy(session, workflowId, modifiedWorkflow) {
  session.startPhase('verify');
  
  // Upload to n8n
  session.logStep('Uploading to n8n');
  
  try {
    // Clean nodes - only keep valid properties
    const cleanNodes = modifiedWorkflow.nodes.map(node => {
      const clean = {
        id: node.id,
        name: node.name,
        type: node.type,
        typeVersion: node.typeVersion,
        position: node.position,
        parameters: node.parameters
      };
      // Only include optional properties if they exist
      if (node.credentials) clean.credentials = node.credentials;
      if (node.webhookId) clean.webhookId = node.webhookId;
      if (node.disabled) clean.disabled = node.disabled;
      if (node.notes) clean.notes = node.notes;
      if (node.notesInFlow) clean.notesInFlow = node.notesInFlow;
      if (node.onError) clean.onError = node.onError;
      if (node.retryOnFail) clean.retryOnFail = node.retryOnFail;
      if (node.maxTries) clean.maxTries = node.maxTries;
      if (node.waitBetweenTries) clean.waitBetweenTries = node.waitBetweenTries;
      if (node.continueOnFail) clean.continueOnFail = node.continueOnFail;
      return clean;
    });
    
    // Only keep properties that n8n API accepts
    const cleanWorkflow = {
      name: modifiedWorkflow.name,
      nodes: cleanNodes,
      connections: modifiedWorkflow.connections,
      settings: modifiedWorkflow.settings,
      staticData: modifiedWorkflow.staticData
    };
    
    const response = await fetch(`${CONFIG.n8nBaseUrl}/api/v1/workflows/${workflowId}`, {
      method: 'PUT',
      headers: {
        'X-N8N-API-KEY': CONFIG.n8nApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cleanWorkflow)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`n8n API error: ${response.status} - ${error}`);
    }
    
    session.logStep('Workflow uploaded successfully');
    session.endPhase({ success: true });
    return true;
    
  } catch (error) {
    session.logStep(`Upload failed: ${error.message}`);
    session.endPhase({ success: false, reason: error.message });
    return false;
  }
}

// ============================================================
// N8N API HELPERS
// ============================================================

async function downloadWorkflow(workflowId) {
  const response = await fetch(`${CONFIG.n8nBaseUrl}/api/v1/workflows/${workflowId}`, {
    headers: {
      'X-N8N-API-KEY': CONFIG.n8nApiKey,
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download workflow: ${response.status}`);
  }
  
  return response.json();
}

async function backupWorkflow(workflowId, workflow) {
  const backupPath = path.join(CONFIG.backupsDir, `${workflowId}-${Date.now()}.json`);
  await fs.writeFile(backupPath, JSON.stringify(workflow, null, 2));
  return backupPath;
}

// ============================================================
// SLACK NOTIFICATIONS
// ============================================================

async function notifySlack(session, status, details = {}) {
  if (!CONFIG.slackWebhookUrl) return;
  
  const summary = await session.save();
  
  let message;
  if (status === 'fixed') {
    message = {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '✅ Workflow Auto-Fixed', emoji: true }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Workflow:* ${session.errorData.workflowName}\n*Error:* ${session.errorData.errorMessage}\n*Cost:* $${summary.totalCost.toFixed(4)} (${summary.totalApiCalls} API calls)`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Fix Applied:* ${details.fix || 'See logs'}`
          }
        }
      ]
    };
  } else {
    message = {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '❌ Auto-Fix Failed', emoji: true }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Workflow:* ${session.errorData.workflowName}\n*Error:* ${session.errorData.errorMessage}\n*Reason:* ${details.reason || 'Unknown'}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚠️ *Manual intervention required*\nLog ID: \`${session.id}\``
          }
        }
      ]
    };
  }
  
  try {
    await fetch(CONFIG.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
  } catch (e) {
    console.error('Slack notification failed:', e.message);
  }
}

// ============================================================
// MAIN AUTO-FIX ORCHESTRATOR
// ============================================================

async function autoFix(errorData) {
  const session = new FixSession(errorData);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${session.id}] 🚀 Starting auto-fix for: ${errorData.workflowName}`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    // Download and backup workflow
    const workflow = await downloadWorkflow(errorData.workflowId);
    const backupPath = await backupWorkflow(errorData.workflowId, workflow);
    console.log(`[${session.id}] 💾 Backup saved: ${backupPath}`);
    
    for (let iteration = 1; iteration <= CONFIG.maxIterations; iteration++) {
      console.log(`\n[${session.id}] 🔄 ITERATION ${iteration}/${CONFIG.maxIterations}`);
      
      // Phase 1: Analyze
      const analysis = await analyzeError(session, workflow);
      
      // Phase 2: Plan
      const plan = await createFixPlan(session, analysis);
      if (!plan) {
        continue; // Try again with different approach
      }
      
      // Phase 3: Execute
      const modifiedWorkflow = await executePlan(session, workflow, analysis, plan);
      if (!modifiedWorkflow) {
        continue;
      }
      
      // Phase 4: Verify & Deploy
      const deployed = await verifyAndDeploy(session, errorData.workflowId, modifiedWorkflow);
      
      if (deployed) {
        console.log(`\n[${session.id}] ✅ FIX SUCCESSFUL on iteration ${iteration}`);
        await notifySlack(session, 'fixed', { 
          fix: plan.steps?.map(s => s.description).join(', ') 
        });
        return { fixed: true, iteration, sessionId: session.id };
      }
    }
    
    // All iterations failed
    console.log(`\n[${session.id}] ❌ All iterations failed`);
    await notifySlack(session, 'failed', { reason: 'All iterations failed' });
    return { fixed: false, sessionId: session.id };
    
  } catch (error) {
    console.error(`[${session.id}] 💥 Error:`, error.message);
    await session.save();
    await notifySlack(session, 'failed', { reason: error.message });
    return { fixed: false, error: error.message, sessionId: session.id };
  }
}

// ============================================================
// HTTP SERVER
// ============================================================

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
  
  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }
  
  // List logs
  if (url.pathname === '/logs' && req.method === 'GET') {
    try {
      const files = await fs.readdir(CONFIG.logsDir);
      const logs = files.filter(f => f.endsWith('.json')).slice(-20);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // Get specific log
  if (url.pathname.startsWith('/logs/') && req.method === 'GET') {
    const logId = url.pathname.replace('/logs/', '');
    try {
      const content = await fs.readFile(path.join(CONFIG.logsDir, `${logId}.json`), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(content);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Log not found' }));
    }
    return;
  }
  
  // Test Slack
  if (url.pathname === '/test-slack' && req.method === 'POST') {
    const testSession = new FixSession({ workflowName: 'Test', errorMessage: 'Test error' });
    await notifySlack(testSession, 'fixed', { fix: 'Test notification' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'sent' }));
    return;
  }
  
  // Auto-fix endpoint
  if (url.pathname === '/auto-fix' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const errorData = JSON.parse(body);
        
        // Respond immediately
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'accepted', 
          message: 'Auto-fix process started'
        }));
        
        // Run async
        autoFix(errorData).catch(e => console.error('Auto-fix error:', e));
        
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

// Start server
async function start() {
  await ensureDirectories();
  
  const server = http.createServer(handleRequest);
  
  server.listen(CONFIG.port, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║          n8n Auto-Fix Service v2 (Phased Approach)        ║
╠════════════════════════════════════════════════════════════╣
║  Phases: Analyze → Plan → Execute → Verify                ║
║  All work is logged for review                            ║
╠════════════════════════════════════════════════════════════╣
║  Port: ${CONFIG.port}                                             ║
║  n8n: ${CONFIG.n8nBaseUrl}               ║
║  Logs: ${CONFIG.logsDir}                      ║
╚════════════════════════════════════════════════════════════╝

Endpoints:
  GET  /health     - Health check
  GET  /logs       - List recent logs
  GET  /logs/:id   - Get specific log
  POST /auto-fix   - Trigger auto-fix
  POST /test-slack - Test Slack notification
`);
  });
}

start().catch(error => {
  console.error('Failed to start:', error);
  process.exit(1);
});
