/**
 * AI Analyze Service v2
 * 
 * Enhanced meeting analysis with:
 * - Auto-detection of workspace and AI apps
 * - Multi-app weighted analysis
 * - Dual-mode: Standard (app-based) and Custom (meta-prompting)
 * - Workspace-aware context injection
 * 
 * Port: 3853
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3853;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// =============================================================================
// CONFIGURATION LOADING
// =============================================================================

// Config directory - use local 'configs' if it exists, otherwise look up two levels
const CONFIG_DIR = fs.existsSync(path.join(__dirname, 'configs')) 
  ? path.join(__dirname, 'configs') 
  : path.join(__dirname, '../../configs');

function loadJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Error loading ${filePath}:`, e.message);
    return null;
  }
}

function loadWorkspaces() {
  const dir = path.join(CONFIG_DIR, 'workspaces');
  const workspaces = {};
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const data = loadJsonFile(path.join(dir, file));
      if (data) workspaces[data.id] = data;
    }
  } catch (e) {
    console.error('Error loading workspaces:', e.message);
  }
  return workspaces;
}

function loadAIApps() {
  const dir = path.join(CONFIG_DIR, 'ai-apps');
  const apps = {};
  try {
    const indexPath = path.join(dir, 'index.json');
    const index = loadJsonFile(indexPath);
    if (index) {
      apps._index = index;
      for (const appId of index.apps || []) {
        const data = loadJsonFile(path.join(dir, `${appId}.json`));
        if (data) apps[data.id] = data;
      }
    }
  } catch (e) {
    console.error('Error loading AI apps:', e.message);
  }
  return apps;
}

// Load configs on startup
let WORKSPACES = loadWorkspaces();
let AI_APPS = loadAIApps();

function reloadConfigs() {
  WORKSPACES = loadWorkspaces();
  AI_APPS = loadAIApps();
  console.log(`[Config] Reloaded: ${Object.keys(WORKSPACES).length} workspaces, ${Object.keys(AI_APPS).length - 1} apps`);
}

// =============================================================================
// AUTO-DETECTION ALGORITHM
// =============================================================================

// Content signals for workspace detection when title/participant signals are weak
const WORKSPACE_CONTENT_SIGNALS = {
  shedpro: [
    'carport', 'SEM', 'james price', 'kat', 'vu', 'nick', '3d config', 'shed', 
    'shed pro', 'setup fee', 'ops hub', 'shed suite', 'idea room', 'steven', 
    'patrick', 'onboarding', 'mrr', 'client pricing', 'pricing tier', 'custom model',
    'standard onboarding', 'technical support', 'project coordinator', 'breed pig',
    'configurator', 'website', 'sim', 'dealer', 'customer pricing'
  ],
  chrt: [
    'leads', 'pipeline', 'outreach', 'icp', 'aaron', 'kyle', 'philip', 'paul', 
    'chart', 'courier', 'freight forwarder', 'shipper', 'backend', 'frontend', 
    'linkedin', 'y-combinator', 'funding', 'airspace', 'hubspot', 'phantombuster'
  ],
  goodlux: [
    'lighting', 'fixtures', 'led', 'aly jo', 'halyee', 'molly', 'pergola', 
    'meta', 'arcsite', 'justin', 'installer', 'contractor', 'construction', 
    'devin', 'goodlux', 'louver', 'concrete'
  ]
};

// Content signals for strategy/executive meetings
const STRATEGY_CONTENT_SIGNALS = [
  'pricing', 'revenue', 'profitability', 'margins', 'mrr', 'arr',
  'organizational', 'team structure', 'headcount', 'hiring', 'turnover',
  'strategy', 'roadmap', 'vision', 'mission', 'core values',
  'leadership', 'culture', 'incentives', 'compensation',
  'budget', 'forecast', 'runway', 'burn rate', 'utilization',
  'churn', 'retention', 'growth', 'profitability'
];

/**
 * Detect if transcript is from a singular recording (phone recording without actual attendees)
 * Singular recordings have all speakers as "null:" because Fireflies can't identify them
 */
function detectSingularRecording(transcript) {
  if (!transcript || transcript.length < 100) return { isSingular: false, confidence: 'low' };
  
  // Get first 50 lines of transcript
  const lines = transcript.split('\n').slice(0, 50).filter(l => l.trim());
  if (lines.length < 5) return { isSingular: false, confidence: 'low' };
  
  // Count lines that start with "null:" - indicates unidentified speaker
  const nullSpeakerLines = lines.filter(l => l.trim().toLowerCase().startsWith('null:')).length;
  const ratio = nullSpeakerLines / lines.length;
  
  // If >80% of lines are from "null:" speaker, it's likely a singular recording
  if (ratio > 0.8) {
    return { isSingular: true, confidence: 'high', nullRatio: ratio };
  } else if (ratio > 0.5) {
    return { isSingular: true, confidence: 'medium', nullRatio: ratio };
  }
  
  return { isSingular: false, confidence: 'high', nullRatio: ratio };
}

/**
 * Detect workspace from transcript content when title/participant signals are weak
 */
function detectWorkspaceFromContent(transcript, currentBestScore) {
  if (!transcript) return null;
  
  const transcriptLower = transcript.toLowerCase();
  const scores = {};
  
  for (const [wsId, signals] of Object.entries(WORKSPACE_CONTENT_SIGNALS)) {
    scores[wsId] = 0;
    for (const signal of signals) {
      // Count occurrences (capped at 10 to prevent single term dominating)
      const regex = new RegExp(signal.toLowerCase(), 'gi');
      const matches = (transcriptLower.match(regex) || []).length;
      scores[wsId] += Math.min(matches, 10) * 2;
    }
  }
  
  // Find best content-based match
  let best = null;
  let bestScore = 0;
  for (const [wsId, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = wsId;
    }
  }
  
  console.log(`[Workspace] Content scores: ${Object.entries(scores).map(([k,v]) => `${k}=${v}`).join(', ')}`);
  
  return best ? { workspace: best, score: bestScore, source: 'content' } : null;
}

/**
 * Detect if meeting is a strategy/executive discussion based on content
 */
function detectStrategyMeeting(transcript, duration) {
  if (!transcript) return { isStrategy: false, confidence: 'low' };
  
  const transcriptLower = transcript.toLowerCase();
  let signalCount = 0;
  
  for (const signal of STRATEGY_CONTENT_SIGNALS) {
    if (transcriptLower.includes(signal)) {
      signalCount++;
    }
  }
  
  // Long meetings (90+ min) with strategy signals are likely executive meetings
  const isLongMeeting = duration >= 90;
  const hasStrongSignals = signalCount >= 5;
  const hasSomeSignals = signalCount >= 3;
  
  if (hasStrongSignals || (isLongMeeting && hasSomeSignals)) {
    return { 
      isStrategy: true, 
      confidence: hasStrongSignals ? 'high' : 'medium',
      signalCount,
      duration
    };
  }
  
  return { isStrategy: false, confidence: 'low', signalCount };
}

function detectWorkspace(participants, title, transcript = '') {
  const scores = {};
  for (const wsId of Object.keys(WORKSPACES)) {
    scores[wsId] = 0;
  }
  
  const emails = (participants || []).map(p => 
    typeof p === 'string' ? p : (p.email || '')
  ).filter(e => e.includes('@'));
  
  // Score by domain
  for (const email of emails) {
    const domain = email.split('@')[1]?.toLowerCase();
    for (const [wsId, ws] of Object.entries(WORKSPACES)) {
      if (ws.domain_patterns) {
        for (const pattern of ws.domain_patterns) {
          if (domain === pattern.toLowerCase()) {
            scores[wsId] += 10;
          }
        }
      }
    }
  }
  
  // Score by title keywords
  const titleLower = (title || '').toLowerCase();
  for (const [wsId, ws] of Object.entries(WORKSPACES)) {
    if (titleLower.includes(ws.name.toLowerCase())) {
      scores[wsId] += 15;
    }
    // Check focus areas
    if (ws.focus_areas) {
      for (const area of ws.focus_areas) {
        for (const kw of (area.keywords || [])) {
          if (titleLower.includes(kw.toLowerCase())) {
            scores[wsId] += 2;
          }
        }
      }
    }
  }
  
  // Find best from title/participant signals
  let best = 'chrt';
  let bestScore = 0;
  for (const [wsId, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = wsId;
    }
  }
  
  // Check if title is generic (timestamp-like or very short)
  const isGenericTitle = !title || 
    title.length < 20 || 
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}[\/\-]\d{1,2}|\d{4})/i.test(title.trim());
  
  // If signals are weak OR title is generic, try content-based detection
  // This catches phone recordings with timestamp titles like "Jan 07, 10:23 AM"
  if ((bestScore <= 10 || isGenericTitle) && transcript) {
    const contentResult = detectWorkspaceFromContent(transcript, bestScore);
    if (contentResult && contentResult.score > bestScore) {
      console.log(`[Workspace] Content-based detection: ${contentResult.workspace} (content score: ${contentResult.score} vs standard score: ${bestScore})`);
      return {
        workspace: contentResult.workspace,
        confidence: contentResult.score > 30 ? 'high' : 'medium',
        scores,
        contentScore: contentResult.score,
        source: 'content'
      };
    }
  }
  
  return {
    workspace: best,
    confidence: bestScore > 10 ? 'high' : bestScore > 5 ? 'medium' : 'low',
    scores,
    source: 'standard'
  };
}

function detectExternal(participants) {
  const internalDomains = ['chrt.com', 'shedpro.io', 'goodlux.io', 'lorfing.com', 'getchrt.com', 'bizopsadvisors.com'];
  const emails = (participants || []).map(p => 
    typeof p === 'string' ? p : (p.email || '')
  ).filter(e => e.includes('@'));
  
  for (const email of emails) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && !internalDomains.includes(domain)) {
      return true;
    }
  }
  return false;
}

function suggestAIApps(title, participants, transcriptPreview, workspace, duration = 0) {
  const isExternal = detectExternal(participants);
  const titleLower = (title || '').toLowerCase();
  const ws = WORKSPACES[workspace];
  
  // Start with workspace defaults
  const defaultApps = ws?.default_ai_apps || ['general-notes'];
  
  // Check for strategy meeting based on content (before title-based combinations)
  const strategyResult = detectStrategyMeeting(transcriptPreview, duration);
  if (strategyResult.isStrategy) {
    console.log(`[Apps] Strategy meeting detected (signals: ${strategyResult.signalCount}, duration: ${duration}min)`);
    return {
      apps: [
        { id: 'executive-strategy', weight: 0.6 },
        { id: 'qbr-analyzer', weight: 0.25 },
        { id: 'general-notes', weight: 0.15 }
      ],
      combination: 'Executive Strategy',
      confidence: strategyResult.confidence,
      source: 'content-strategy'
    };
  }
  
  // Check for combination matches from index
  const combinations = AI_APPS._index?.common_combinations || [];
  for (const combo of combinations) {
    let match = true;
    if (combo.trigger?.external !== undefined && combo.trigger.external !== isExternal) {
      match = false;
    }
    if (match && combo.trigger?.title_keywords) {
      const hasKeyword = combo.trigger.title_keywords.some(kw => titleLower.includes(kw.toLowerCase()));
      if (!hasKeyword) match = false;
    }
    if (match) {
      return {
        apps: combo.apps,
        combination: combo.name,
        confidence: 'high',
        source: 'combination'
      };
    }
  }
  
  // Individual app scoring
  const appScores = {};
  for (const [appId, app] of Object.entries(AI_APPS)) {
    if (appId.startsWith('_')) continue;
    let score = 0;
    const detect = app.auto_detect || {};
    
    // External check
    if (detect.external_required !== undefined) {
      if (detect.external_required !== isExternal) continue;
      score += 5;
    }
    
    // Title keywords
    if (detect.title_keywords) {
      for (const kw of detect.title_keywords) {
        if (titleLower.includes(kw.toLowerCase())) score += 10;
      }
    }
    
    // Content signals (check transcript preview for app-specific signals)
    if (detect.content_signals && transcriptPreview) {
      const previewLower = transcriptPreview.toLowerCase();
      for (const signal of detect.content_signals) {
        if (previewLower.includes(signal.toLowerCase())) score += 3;
      }
    }
    
    // Negative keywords
    if (detect.title_negative) {
      for (const kw of detect.title_negative) {
        if (titleLower.includes(kw.toLowerCase())) score -= 15;
      }
    }
    
    // Fallback
    if (detect.fallback) score = Math.max(score, 1);
    
    // Boost if in workspace defaults
    if (defaultApps.includes(appId)) score += 5;
    
    if (score > 0) appScores[appId] = score;
  }
  
  // Sort and take top 3
  const sorted = Object.entries(appScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  
  if (sorted.length === 0) {
    return {
      apps: [{ id: 'general-notes', weight: 1.0 }],
      combination: null,
      confidence: 'low',
      source: 'fallback'
    };
  }
  
  // Calculate weights
  const total = sorted.reduce((sum, [_, s]) => sum + s, 0);
  const apps = sorted.map(([id, s]) => ({
    id,
    weight: Math.round((s / total) * 100) / 100
  }));
  
  // Normalize
  const weightSum = apps.reduce((sum, a) => sum + a.weight, 0);
  for (const app of apps) {
    app.weight = Math.round((app.weight / weightSum) * 100) / 100;
  }
  
  return {
    apps,
    combination: null,
    confidence: sorted[0][1] >= 15 ? 'high' : 'medium',
    source: 'scored'
  };
}

function autoDetect(data) {
  const { title, participants, transcript, duration } = data;
  
  // Detect if this is a singular recording (phone recording without actual attendees)
  const singularResult = detectSingularRecording(transcript);
  if (singularResult.isSingular) {
    console.log(`[AutoDetect] Singular recording detected (null ratio: ${singularResult.nullRatio?.toFixed(2)})`);
  }
  
  // Use more transcript for content-based detection (first 5000 chars)
  const transcriptForWorkspace = (transcript || '').substring(0, 5000);
  const workspaceResult = detectWorkspace(participants, title, transcriptForWorkspace);
  
  const isExternal = detectExternal(participants);
  
  // Use first 2000 chars for app suggestion (includes strategy detection)
  const transcriptPreview = (transcript || '').substring(0, 2000);
  const appSuggestion = suggestAIApps(title, participants, transcriptPreview, workspaceResult.workspace, duration);
  
  // Determine meeting type from primary app
  let meetingType = 'general';
  if (appSuggestion.apps?.length > 0) {
    const primaryApp = AI_APPS[appSuggestion.apps[0].id];
    meetingType = primaryApp?.category || 'general';
  }
  
  return {
    workspace: workspaceResult.workspace,
    workspaceConfidence: workspaceResult.confidence,
    workspaceSource: workspaceResult.source || 'standard',
    isExternal,
    meetingType,
    suggestedApps: appSuggestion.apps,
    suggestedCombination: appSuggestion.combination,
    appConfidence: appSuggestion.confidence,
    appSource: appSuggestion.source,
    // Singular recording detection
    isSingularRecording: singularResult.isSingular,
    singularConfidence: singularResult.confidence,
    // Recommend recording type based on detection
    recommendedRecordingType: singularResult.isSingular ? 'singular' : 'normal'
  };
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

function buildPrompt(workspace, apps, customContext, transcript, meetingData) {
  const ws = WORKSPACES[workspace] || WORKSPACES['chrt'];
  const parts = [];
  
  // Recording type and detail level
  const recordingType = meetingData.recordingType || 'normal';
  const detailLevel = meetingData.detailLevel || 'standard';
  
  // Workspace context
  parts.push(`# Context\n`);
  parts.push(`You are analyzing a meeting for ${ws.display_name || ws.name}.`);
  parts.push(`Role: ${ws.role === 'sales' ? 'Sales analyst' : 'Advisory meeting analyst'}`);
  
  // Handle singular recording (recorded conversation without actual meeting attendees)
  if (recordingType === 'singular') {
    parts.push(`\n**IMPORTANT: Singular Recording Mode**`);
    parts.push(`This is a recorded conversation where the speaker(s) did not join as meeting participants.`);
    parts.push(`The attendee list may only show the recorder. Focus on identifying all speakers from voice/context.`);
    parts.push(`Attribute quotes and insights to the correct speaker based on conversation context.\n`);
  }
  
  // Handle context meeting (detailed notes needed)
  if (detailLevel === 'context') {
    parts.push(`\n**IMPORTANT: Context Meeting - Detailed Notes Required**`);
    parts.push(`This meeting provides important context that needs comprehensive documentation.`);
    parts.push(`Capture MORE detail than usual:`);
    parts.push(`- Document specific examples, stories, and anecdotes mentioned`);
    parts.push(`- Preserve nuanced opinions and perspectives with exact quotes`);
    parts.push(`- Note any background information, history, or context shared`);
    parts.push(`- Capture institutional knowledge and tribal wisdom`);
    parts.push(`- Include tangential but potentially valuable insights`);
    parts.push(`- Record any numbers, metrics, dates, or specific data points\n`);
  }
  
  if (ws.analysis_context) {
    parts.push(ws.analysis_context);
  }
  if (ws.methodology?.primary) {
    parts.push(`Primary methodology: ${ws.methodology.primary}`);
  }
  parts.push('');
  
  // App-specific instructions
  if (apps && apps.length > 0) {
    parts.push(`# Analysis Requirements\n`);
    parts.push(`Analyze this meeting using the following frameworks (weights indicate relative importance):\n`);
    
    for (const appSpec of apps) {
      const app = AI_APPS[appSpec.id];
      if (!app) continue;
      
      const weight = Math.round((appSpec.weight || 0.33) * 100);
      parts.push(`## ${app.name} (${weight}% weight)`);
      parts.push(`${app.description}\n`);
      
      // Extraction targets
      if (app.extraction_targets) {
        parts.push(`Extract:`);
        for (const target of app.extraction_targets) {
          parts.push(`- ${target.field}: ${target.prompt}`);
        }
        parts.push('');
      }
      
      // Scoring rubric
      if (app.scoring?.enabled && app.scoring?.criteria) {
        parts.push(`Scoring Rubric (0-${app.scoring.max_score}):`);
        for (const criterion of app.scoring.criteria) {
          parts.push(`- ${criterion.name}: ${criterion.question}`);
        }
        parts.push('');
      }
      
      // System prompt addition
      if (app.system_prompt) {
        parts.push(`Additional instructions: ${app.system_prompt}\n`);
      }
    }
  }
  
  // Custom context
  if (customContext) {
    parts.push(`# User-Specified Focus\n${customContext}\n`);
  }
  
  // Output format
  parts.push(`# Output Format`);
  parts.push(`Format your response as a structured Obsidian markdown note with frontmatter.`);
  parts.push(`Include:`);
  if (detailLevel === 'context') {
    parts.push(`- Comprehensive executive summary (4-6 sentences)`);
    parts.push(`- Detailed key points organized by topic with supporting quotes`);
    parts.push(`- Background context and institutional knowledge captured`);
    parts.push(`- Specific examples, stories, and anecdotes with attribution`);
    parts.push(`- All numbers, metrics, dates, and data points mentioned`);
    parts.push(`- Action items with owners (use #hudson, #aaron, #kyle tags)`);
    parts.push(`- Key quotes worth preserving (with speaker attribution)`);
    parts.push(`- Follow-up recommendations and open questions`);
  } else {
    parts.push(`- Executive summary (2-3 sentences)`);
    parts.push(`- Key points by topic`);
    parts.push(`- Action items with owners (use #hudson, #aaron, #kyle tags)`);
    parts.push(`- Any scoring/rubric results`);
    parts.push(`- Follow-up recommendations`);
  }
  parts.push('');
  
  // Meeting metadata
  parts.push(`# Meeting Details`);
  parts.push(`- Title: ${meetingData.title || 'Unknown'}`);
  parts.push(`- Date: ${meetingData.dateStr || new Date().toISOString().split('T')[0]}`);
  parts.push(`- Attendees: ${meetingData.attendees || 'Not recorded'}`);
  parts.push(`- Duration: ${meetingData.durationMins || '?'} minutes`);
  parts.push('');
  
  // Transcript
  parts.push(`# Transcript\n${transcript}`);
  
  return parts.join('\n');
}

function buildMetaPrompt(userGoals) {
  return `You are an expert Prompt Engineer. Your task is to write a precise, effective system prompt for analyzing a meeting transcript.

The user wants the analysis to focus on:
${userGoals}

Write a detailed prompt that will guide an LLM to analyze the transcript with these specific goals in mind.

The prompt should:
1. Be specific about what to extract
2. Include output format instructions
3. Request evidence/quotes where relevant
4. Be structured for Obsidian markdown output

Output ONLY the prompt text, nothing else.`;
}

// =============================================================================
// GEMINI API
// =============================================================================

function selectModel(transcriptLength) {
  const tokens = Math.ceil(transcriptLength / 4);
  if (tokens > 100000) return 'gemini-1.5-pro';
  if (tokens < 5000) return 'gemini-2.0-flash-lite';
  return 'gemini-2.0-flash';
}

async function callGemini(systemPrompt, userPrompt, model) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
    });

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message));
          } else if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
            resolve(json.candidates[0].content.parts[0].text);
          } else {
            reject(new Error('Unexpected response: ' + JSON.stringify(json).substring(0, 300)));
          }
        } catch (e) {
          reject(new Error('Parse error: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// =============================================================================
// CLAUDE API (FALLBACK)
// =============================================================================

async function callClaude(systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    if (!ANTHROPIC_API_KEY) {
      reject(new Error('ANTHROPIC_API_KEY not configured'));
      return;
    }

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message));
          } else if (json.content?.[0]?.text) {
            resolve(json.content[0].text);
          } else {
            reject(new Error('Unexpected Claude response: ' + JSON.stringify(json).substring(0, 300)));
          }
        } catch (e) {
          reject(new Error('Parse error: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// Call with Gemini, fallback to Claude if error
async function callAI(systemPrompt, userPrompt, model) {
  let usedModel = model;
  let keyRotationNeeded = false;
  
  // Try Gemini first
  if (GEMINI_API_KEY) {
    try {
      const result = await callGemini(systemPrompt, userPrompt, model);
      return { content: result, model: usedModel, keyRotationNeeded: false };
    } catch (geminiError) {
      console.error(`[AI] Gemini failed: ${geminiError.message}`);
      
      // Check if it's an API key issue
      if (geminiError.message.includes('API key') || 
          geminiError.message.includes('401') || 
          geminiError.message.includes('403') ||
          geminiError.message.includes('invalid') ||
          geminiError.message.includes('expired')) {
        keyRotationNeeded = true;
        console.error('[AI] ⚠️ GEMINI API KEY MAY NEED ROTATION');
      }
      
      // Fall back to Claude
      if (ANTHROPIC_API_KEY) {
        console.log('[AI] Falling back to Claude...');
        try {
          const result = await callClaude(systemPrompt, userPrompt);
          return { 
            content: result, 
            model: 'claude-sonnet-4', 
            keyRotationNeeded,
            fallbackUsed: true,
            fallbackReason: geminiError.message
          };
        } catch (claudeError) {
          throw new Error(`Both APIs failed. Gemini: ${geminiError.message}, Claude: ${claudeError.message}`);
        }
      } else {
        throw geminiError;
      }
    }
  } else if (ANTHROPIC_API_KEY) {
    // No Gemini key, use Claude directly
    const result = await callClaude(systemPrompt, userPrompt);
    return { content: result, model: 'claude-sonnet-4', keyRotationNeeded: false };
  } else {
    throw new Error('No API keys configured (GEMINI_API_KEY or ANTHROPIC_API_KEY)');
  }
}

// =============================================================================
// HTTP SERVER
// =============================================================================

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const sendJson = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Health check
  if (req.url === '/health' && req.method === 'GET') {
    return sendJson(200, {
      status: 'ok',
      service: 'ai-analyze-v2',
      version: '2.1.0',
      workspaces: Object.keys(WORKSPACES),
      apps: Object.keys(AI_APPS).filter(k => !k.startsWith('_')).length,
      geminiKeyConfigured: !!GEMINI_API_KEY,
      claudeKeyConfigured: !!ANTHROPIC_API_KEY,
      fallbackAvailable: !!ANTHROPIC_API_KEY
    });
  }

  // List workspaces
  if (req.url === '/workspaces' && req.method === 'GET') {
    const list = Object.values(WORKSPACES).map(ws => ({
      id: ws.id,
      name: ws.display_name || ws.name,
      role: ws.role,
      hubspot: ws.hubspot_enabled || false,
      defaultApps: ws.default_ai_apps || []
    }));
    return sendJson(200, { workspaces: list });
  }

  // List apps
  if (req.url === '/apps' && req.method === 'GET') {
    const list = Object.entries(AI_APPS)
      .filter(([k]) => !k.startsWith('_'))
      .map(([_, app]) => ({
        id: app.id,
        name: app.name,
        category: app.category,
        icon: app.icon,
        description: app.description,
        hasScoring: app.scoring?.enabled || false
      }));
    return sendJson(200, { apps: list });
  }

  // Reload configs
  if (req.url === '/reload' && req.method === 'POST') {
    reloadConfigs();
    return sendJson(200, { status: 'reloaded' });
  }

  // Auto-detect
  if (req.url === '/auto-detect' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const result = autoDetect(data);
        console.log(`[AutoDetect] ${data.title} -> ${result.workspace} (${result.workspaceConfidence}), apps: ${result.suggestedApps?.map(a => a.id).join(', ')}`);
        return sendJson(200, result);
      } catch (e) {
        return sendJson(400, { error: e.message });
      }
    });
    return;
  }

  // Analyze meeting v2
  if (req.url === '/analyze-meeting-v2' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const {
          transcript,
          workspace = 'chrt',
          apps = [],
          mode = 'standard',
          customContext = '',
          title,
          dateStr,
          attendees,
          durationMins,
          recordingType = 'normal',
          detailLevel = 'standard'
        } = data;
        
        console.log(`[Analyze] ${title} | workspace: ${workspace} | mode: ${mode} | apps: ${apps.map(a => a.id).join(', ')}`);
        
        const model = selectModel((transcript || '').length);
        let systemPrompt, userPrompt;
        
        if (mode === 'custom' && customContext) {
          // Meta-prompting: first generate prompt, then execute
          console.log(`[Analyze] Custom mode - generating meta-prompt...`);
          const metaPrompt = buildMetaPrompt(customContext);
          const metaResult = await callAI(
            'You are an expert prompt engineer.',
            metaPrompt,
            'gemini-2.0-flash'
          );
          systemPrompt = metaResult.content;
          userPrompt = `# Meeting: ${title}\nDate: ${dateStr}\nAttendees: ${attendees}\n\n# Transcript\n${transcript}`;
        } else {
          // Standard mode - use app configs
          const meetingData = { title, dateStr, attendees, durationMins, recordingType, detailLevel };
          const fullPrompt = buildPrompt(workspace, apps, customContext, transcript, meetingData);
          systemPrompt = 'You are an expert meeting analyst. Analyze the following and produce structured Obsidian markdown output.';
          userPrompt = fullPrompt;
        }
        
        const result = await callAI(systemPrompt, userPrompt, model);
        
        // Clean markdown fences
        let content = result.content.replace(/^```(?:markdown)?\n?/gm, '').replace(/\n?```$/gm, '').trim();
        
        // Add key rotation warning if needed
        if (result.keyRotationNeeded) {
          content = `> [!warning] ⚠️ GEMINI API KEY NEEDS ROTATION\n> The Gemini API key appears to be invalid or expired. Please rotate the key.\n> Fallback to Claude was used for this analysis.\n\n` + content;
        } else if (result.fallbackUsed) {
          content = `> [!info] Used Claude fallback\n> Reason: ${result.fallbackReason}\n\n` + content;
        }
        
        console.log(`[Analyze] Complete | model: ${result.model} | output: ${content.length} chars`);
        
        return sendJson(200, {
          content,
          model: result.model,
          workspace,
          apps: apps.map(a => a.id),
          mode,
          keyRotationNeeded: result.keyRotationNeeded || false,
          fallbackUsed: result.fallbackUsed || false
        });
      } catch (e) {
        console.error('[Analyze] Error:', e.message);
        return sendJson(500, { error: e.message });
      }
    });
    return;
  }

  // Legacy endpoint (backwards compatible)
  if (req.url === '/analyze-meeting' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        // Convert to v2 format
        const meetingType = data.meetingType || 'general';
        const appMap = {
          'sales': [{ id: 'spiced-analyzer', weight: 0.5 }, { id: 'discovery-scorecard', weight: 0.3 }, { id: 'competitor-tracker', weight: 0.2 }],
          'research': [{ id: 'customer-interview', weight: 0.7 }, { id: 'general-notes', weight: 0.3 }],
          'internal': [{ id: 'team-sync', weight: 0.7 }, { id: 'general-notes', weight: 0.3 }],
          'general': [{ id: 'general-notes', weight: 1.0 }]
        };
        
        const v2Data = {
          ...data,
          apps: appMap[meetingType] || appMap['general'],
          mode: 'standard'
        };
        
        // Reuse v2 logic
        const model = selectModel((data.transcript || '').length);
        const fullPrompt = buildPrompt(
          data.workspace || 'chrt',
          v2Data.apps,
          '',
          data.transcript,
          data
        );
        
        const result = await callAI(
          'You are an expert meeting analyst.',
          fullPrompt,
          model
        );
        
        let content = result.content.replace(/^```(?:markdown)?\n?/gm, '').replace(/\n?```$/gm, '').trim();
        
        // Add key rotation warning if needed
        if (result.keyRotationNeeded) {
          content = `> [!warning] ⚠️ GEMINI API KEY NEEDS ROTATION\n> Please rotate the Gemini API key.\n\n` + content;
        }
        
        return sendJson(200, { content, model: result.model, meetingType, keyRotationNeeded: result.keyRotationNeeded || false });
      } catch (e) {
        console.error('[Analyze Legacy] Error:', e.message);
        return sendJson(500, { error: e.message });
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Analyze v2 service running on port ${PORT}`);
  console.log(`Workspaces: ${Object.keys(WORKSPACES).join(', ')}`);
  console.log(`AI Apps: ${Object.keys(AI_APPS).filter(k => !k.startsWith('_')).length} loaded`);
  console.log(`API Key configured: ${!!GEMINI_API_KEY}`);
});


