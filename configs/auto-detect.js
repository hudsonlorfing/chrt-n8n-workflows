/**
 * Auto-Detection Algorithm (ADA) for Meeting Analysis
 * 
 * Detects:
 * 1. Workspace (Chrt, ShedPro, GoodLux, Personal)
 * 2. AI Apps to apply with weights
 * 3. Meeting classification
 */

const fs = require('fs');
const path = require('path');

// Load configuration files
const CONFIG_DIR = path.join(__dirname);

function loadWorkspaces() {
  const workspacesDir = path.join(CONFIG_DIR, 'workspaces');
  const workspaces = {};
  
  try {
    const files = fs.readdirSync(workspacesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(workspacesDir, file), 'utf8'));
      workspaces[data.id] = data;
    }
  } catch (e) {
    console.error('Error loading workspaces:', e.message);
  }
  
  return workspaces;
}

function loadAIApps() {
  const appsDir = path.join(CONFIG_DIR, 'ai-apps');
  const apps = {};
  
  try {
    const indexFile = path.join(appsDir, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    
    for (const appId of index.apps) {
      const appFile = path.join(appsDir, `${appId}.json`);
      if (fs.existsSync(appFile)) {
        const data = JSON.parse(fs.readFileSync(appFile, 'utf8'));
        apps[data.id] = data;
      }
    }
    
    // Also load combinations
    apps._combinations = index.common_combinations;
    apps._categories = index.categories;
  } catch (e) {
    console.error('Error loading AI apps:', e.message);
  }
  
  return apps;
}

// Cache loaded configs
let _workspaces = null;
let _aiApps = null;

function getWorkspaces() {
  if (!_workspaces) _workspaces = loadWorkspaces();
  return _workspaces;
}

function getAIApps() {
  if (!_aiApps) _aiApps = loadAIApps();
  return _aiApps;
}

/**
 * Detect workspace from participant emails and meeting title
 */
function detectWorkspace(participants, title) {
  const workspaces = getWorkspaces();
  const scores = {};
  
  // Initialize scores
  for (const wsId of Object.keys(workspaces)) {
    scores[wsId] = 0;
  }
  
  // Score based on participant domains
  const participantEmails = participants.map(p => 
    typeof p === 'string' ? p : (p.email || '')
  ).filter(e => e.includes('@'));
  
  for (const email of participantEmails) {
    const domain = email.split('@')[1]?.toLowerCase();
    
    for (const [wsId, ws] of Object.entries(workspaces)) {
      if (ws.domain_patterns) {
        for (const pattern of ws.domain_patterns) {
          if (domain === pattern.toLowerCase() || domain?.endsWith('.' + pattern.toLowerCase())) {
            scores[wsId] += 10;
          }
        }
      }
    }
  }
  
  // Score based on title keywords
  const titleLower = title.toLowerCase();
  
  for (const [wsId, ws] of Object.entries(workspaces)) {
    // Check company name in title
    if (titleLower.includes(ws.name.toLowerCase())) {
      scores[wsId] += 15;
    }
    
    // Check customer segment keywords (for Chrt)
    if (ws.customer_segments) {
      for (const segment of ws.customer_segments) {
        if (segment.pain_keywords) {
          for (const keyword of segment.pain_keywords) {
            if (titleLower.includes(keyword.toLowerCase())) {
              scores[wsId] += 2;
            }
          }
        }
      }
    }
    
    // Check terminology
    if (ws.terminology) {
      for (const term of Object.keys(ws.terminology)) {
        if (titleLower.includes(term.toLowerCase())) {
          scores[wsId] += 3;
        }
      }
    }
  }
  
  // Find highest scoring workspace
  let bestWorkspace = 'chrt'; // Default
  let bestScore = 0;
  
  for (const [wsId, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestWorkspace = wsId;
    }
  }
  
  // If no clear winner, check if all internal (personal)
  if (bestScore === 0) {
    const internalDomains = ['chrt.com', 'shedpro.io', 'goodlux.io', 'lorfing.com'];
    const allInternal = participantEmails.every(email => {
      const domain = email.split('@')[1]?.toLowerCase();
      return internalDomains.some(id => domain === id || domain?.endsWith('.' + id));
    });
    
    // Default to chrt for business meetings
    bestWorkspace = 'chrt';
  }
  
  return {
    workspace: bestWorkspace,
    confidence: bestScore > 10 ? 'high' : bestScore > 5 ? 'medium' : 'low',
    scores
  };
}

/**
 * Detect if meeting has external participants
 */
function detectExternal(participants, hostDomain = 'chrt.com') {
  const participantEmails = participants.map(p => 
    typeof p === 'string' ? p : (p.email || '')
  ).filter(e => e.includes('@'));
  
  const internalDomains = ['chrt.com', 'shedpro.io', 'goodlux.io', 'lorfing.com', 'getchrt.com'];
  
  for (const email of participantEmails) {
    const domain = email.split('@')[1]?.toLowerCase();
    const isInternal = internalDomains.some(id => domain === id);
    if (!isInternal && domain) {
      return true;
    }
  }
  
  return false;
}

/**
 * Suggest AI Apps based on meeting metadata
 */
function suggestAIApps(title, participants, transcriptPreview = '') {
  const apps = getAIApps();
  const isExternal = detectExternal(participants);
  const titleLower = title.toLowerCase();
  const suggestions = [];
  
  // First, check for combination matches
  for (const combo of (apps._combinations || [])) {
    let matchScore = 0;
    
    // Check external requirement
    if (combo.trigger.external !== undefined) {
      if (combo.trigger.external === isExternal) {
        matchScore += 5;
      } else {
        continue; // Skip if external requirement doesn't match
      }
    }
    
    // Check title keywords
    if (combo.trigger.title_keywords) {
      for (const keyword of combo.trigger.title_keywords) {
        if (titleLower.includes(keyword.toLowerCase())) {
          matchScore += 10;
        }
      }
    }
    
    if (matchScore >= 10) {
      suggestions.push({
        combination: combo.name,
        apps: combo.apps,
        matchScore,
        source: 'combination'
      });
    }
  }
  
  // If we have a good combination match, use it
  if (suggestions.length > 0) {
    // Sort by match score and return best
    suggestions.sort((a, b) => b.matchScore - a.matchScore);
    return {
      suggested: suggestions[0].apps,
      combination: suggestions[0].combination,
      confidence: suggestions[0].matchScore >= 15 ? 'high' : 'medium',
      alternatives: suggestions.slice(1, 3).map(s => ({
        name: s.combination,
        apps: s.apps
      }))
    };
  }
  
  // Individual app matching
  const appScores = {};
  
  for (const [appId, app] of Object.entries(apps)) {
    if (appId.startsWith('_')) continue; // Skip meta fields
    
    let score = 0;
    const detect = app.auto_detect || {};
    
    // Check external requirement
    if (detect.external_required !== undefined) {
      if (detect.external_required !== isExternal) {
        continue; // Skip if doesn't match
      }
      score += 5;
    }
    
    // Check title keywords
    if (detect.title_keywords) {
      for (const keyword of detect.title_keywords) {
        if (titleLower.includes(keyword.toLowerCase())) {
          score += 10;
        }
      }
    }
    
    // Check negative keywords (reduce score)
    if (detect.title_negative) {
      for (const keyword of detect.title_negative) {
        if (titleLower.includes(keyword.toLowerCase())) {
          score -= 15;
        }
      }
    }
    
    // Check content signals (if transcript preview available)
    if (detect.content_signals && transcriptPreview) {
      const previewLower = transcriptPreview.toLowerCase();
      for (const signal of detect.content_signals) {
        if (previewLower.includes(signal.toLowerCase())) {
          score += 5;
        }
      }
    }
    
    // Fallback app gets low base score
    if (detect.fallback) {
      score = Math.max(score, 1);
    }
    
    if (score > 0) {
      appScores[appId] = score;
    }
  }
  
  // Sort apps by score
  const sortedApps = Object.entries(appScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3); // Top 3 apps
  
  if (sortedApps.length === 0) {
    // Default to general notes
    return {
      suggested: [{ id: 'general-notes', weight: 1.0 }],
      combination: 'General',
      confidence: 'low',
      alternatives: []
    };
  }
  
  // Calculate weights based on scores
  const totalScore = sortedApps.reduce((sum, [_, score]) => sum + score, 0);
  const suggestedApps = sortedApps.map(([id, score]) => ({
    id,
    weight: Math.round((score / totalScore) * 100) / 100
  }));
  
  // Normalize weights to sum to 1
  const weightSum = suggestedApps.reduce((sum, app) => sum + app.weight, 0);
  for (const app of suggestedApps) {
    app.weight = Math.round((app.weight / weightSum) * 100) / 100;
  }
  
  return {
    suggested: suggestedApps,
    combination: null,
    confidence: sortedApps[0][1] >= 15 ? 'high' : sortedApps[0][1] >= 10 ? 'medium' : 'low',
    alternatives: []
  };
}

/**
 * Full auto-detection pipeline
 */
function autoDetect(meetingData) {
  const {
    title,
    participants = [],
    transcript = '',
    duration = 0
  } = meetingData;
  
  // Detect workspace
  const workspaceResult = detectWorkspace(participants, title);
  
  // Detect external
  const isExternal = detectExternal(participants);
  
  // Get transcript preview (first 1000 chars)
  const transcriptPreview = transcript.substring(0, 1000);
  
  // Suggest AI apps
  const appSuggestion = suggestAIApps(title, participants, transcriptPreview);
  
  // Determine meeting type
  let meetingType = 'general';
  if (appSuggestion.suggested.length > 0) {
    const apps = getAIApps();
    const primaryApp = apps[appSuggestion.suggested[0].id];
    if (primaryApp) {
      meetingType = primaryApp.category || 'general';
    }
  }
  
  return {
    workspace: workspaceResult.workspace,
    workspaceConfidence: workspaceResult.confidence,
    isExternal,
    meetingType,
    suggestedApps: appSuggestion.suggested,
    suggestedCombination: appSuggestion.combination,
    appConfidence: appSuggestion.confidence,
    alternatives: appSuggestion.alternatives,
    metadata: {
      title,
      participantCount: participants.length,
      transcriptLength: transcript.length,
      durationMinutes: duration
    }
  };
}

/**
 * Get workspace context for prompt generation
 */
function getWorkspaceContext(workspaceId) {
  const workspaces = getWorkspaces();
  return workspaces[workspaceId] || workspaces['chrt'];
}

/**
 * Get AI App configuration
 */
function getAppConfig(appId) {
  const apps = getAIApps();
  return apps[appId];
}

/**
 * Get all available apps for UI
 */
function getAvailableApps() {
  const apps = getAIApps();
  const available = [];
  
  for (const [id, app] of Object.entries(apps)) {
    if (id.startsWith('_')) continue;
    available.push({
      id: app.id,
      name: app.name,
      category: app.category,
      icon: app.icon,
      description: app.description,
      hasScoring: app.scoring?.enabled || false
    });
  }
  
  return available;
}

module.exports = {
  autoDetect,
  detectWorkspace,
  detectExternal,
  suggestAIApps,
  getWorkspaceContext,
  getAppConfig,
  getAvailableApps,
  getWorkspaces,
  getAIApps
};

