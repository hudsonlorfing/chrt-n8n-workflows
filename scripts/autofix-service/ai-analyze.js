const http = require('http');
const https = require('https');
const PORT = 3851;

// Keys stored securely on VPS via environment variable
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// =============================================================================
// MODEL SELECTION
// =============================================================================

function selectModel(transcriptLength, meetingType) {
  // Gemini model selection based on transcript size and complexity
  const estimatedTokens = Math.ceil(transcriptLength / 4);
  
  // Very long transcripts need the pro model with larger context
  if (estimatedTokens > 100000) {
    return 'gemini-1.5-pro';
  }
  
  // Simple/short meetings use lite for cost savings
  if (meetingType === 'internal' && estimatedTokens < 5000) {
    return 'gemini-2.0-flash-lite';
  }
  if (meetingType === 'general' && estimatedTokens < 3000) {
    return 'gemini-2.0-flash-lite';
  }
  
  // Default to flash for good balance of speed/quality/cost
  return 'gemini-2.0-flash';
}

// =============================================================================
// SYSTEM PROMPTS
// =============================================================================

const SALES_SYSTEM_PROMPT = `You are an elite sales intelligence analyst for Chrt, a time-critical logistics technology company. Your job is to analyze meeting transcripts and extract maximum value for the sales team.

**Company Context:**
Chrt builds a unified platform ("Courier OS") connecting three customer segments:
1. Shippers: Labs, hospitals, OPOs, manufacturers needing urgent deliveries
2. Forwarders: 3PLs, freight brokers, IACs coordinating shipments
3. Couriers: Last-mile delivery companies, medical couriers

**Primary Framework: SPICED**
- Situation: Facts and context (tech stack, volume, team)
- Pain: The specific challenge driving the search
- Impact: Quantified outcome (BOTH Rational $$ AND Emotional career/stress)
- Critical Event: Deadline with consequences (creates urgency)
- E/Decision: Process, criteria, stakeholders

**Bowtie Lifecycle Stages:**
Awareness → Education → Selection → Commit → Onboarding → Adoption → Expansion → Advocate

**Revenue Expansion Signals to Detect:**
- Insurance: Shipper's Interest, MTC Spike, OccAcc, Cold Chain (Parsyl), Delay (Otonomi)
- IoT: Tive Solo 5G, Parsyl Sensors, BLE Labels, Fleet GPS

**Your Output Must Include:**
1. Meeting Classification & Bowtie Stage
2. Executive Summary (2-3 sentences)
3. SPICED Analysis (comprehensive)
4. MEDDPICC Qualification Score
5. Key Quotes (with attribution)
6. Action Items (tagged with #hudson, #aaron, #kyle)
7. Expansion Opportunities (Insurance/IoT signals)
8. Sales Coaching Feedback
9. CRM Update Recommendations

Be direct. Quote liberally. Flag BOTH rational AND emotional impact—deals with only rational impact stall.`;

const GENERAL_SYSTEM_PROMPT = `You are a professional meeting analyst. Your job is to analyze meeting transcripts and produce clear, actionable meeting notes.

**Your Output Must Include:**
1. Meeting Overview (attendees, type, purpose)
2. Executive Summary (2-3 sentences)
3. Key Discussion Points (by topic)
4. Decisions Made (with rationale and owner)
5. Action Items (tagged with #hudson, #aaron, #kyle)
6. Key Quotes (with attribution)
7. Follow-up Items

Be concise. Focus on action. Tag all items with owners.`;

const INTERNAL_SYSTEM_PROMPT = `You are a meeting analyst for Chrt's internal team. Your job is to analyze team meeting transcripts and produce actionable notes focused on decisions, ownership, and progress tracking.

**Chrt Team Members:**
- Hudson Lorfing (#hudson) - Owner/CEO
- Aaron Carver (#aaron) - Team
- Kyle Reagan (#kyle) - Team

**Your Output Must Include:**
1. Meeting Overview (type, attendees)
2. Meeting Objective & Outcome
3. Decisions Made (with owner and due date)
4. Action Items by Person:
   - Hudson #hudson: [items]
   - Aaron #aaron: [items]
   - Kyle #kyle: [items]
   - Unassigned: [items needing owner]
5. Blockers & Risks
6. Progress Updates (done/in progress/next)
7. Parking Lot (tabled items)
8. Next Steps

Every action item and decision MUST have an owner. If ownership wasn't assigned, flag it as "Unassigned (needs owner)".`;

const RESEARCH_SYSTEM_PROMPT = `You are a customer research analyst for Chrt, a time-critical logistics technology company. Your job is to analyze research interviews and extract deep insights about customer needs, pain points, and opportunities.

**Chrt Segments:**
1. Shippers: Labs, hospitals, OPOs, manufacturers needing urgent deliveries
2. Forwarders: 3PLs, freight brokers, IACs coordinating shipments
3. Couriers: Last-mile delivery companies, medical couriers

**Target Industries:** Healthcare, Aerospace, Industrial

**Your Output Must Include:**
1. Participant Profile (name, role, company, segment, industry)
2. Executive Summary (3-4 sentences)
3. Current State Analysis (tech stack, operations, vendors)
4. Pain Points Extracted (with severity 🔴/🟡/🔵, quotes, impact)
5. Jobs to Be Done
6. Key Quotes (categorized: pain, ideal solution, decision making, trends)
7. Buying Signals & Warning Signs
8. Segment Insights (how this applies to Shippers/Forwarders/Couriers)
9. Product Implications (feature needs, validation)
10. Competitive Intelligence
11. Follow-up Opportunities

Quotes are gold—capture as many relevant quotes as possible with proper attribution. Tie insights back to segments. Distinguish fact from inference.`;

const SYSTEM_PROMPTS = {
  sales: SALES_SYSTEM_PROMPT,
  general: GENERAL_SYSTEM_PROMPT,
  internal: INTERNAL_SYSTEM_PROMPT,
  research: RESEARCH_SYSTEM_PROMPT
};

// =============================================================================
// OUTPUT FORMAT TEMPLATES
// =============================================================================

function getOutputTemplate(meetingType, data) {
  const baseTemplate = `---
up:
  - "[[Calendar]]"
in:
  - "[[Meetings]]"
related:
created: ${data.dateStr}
tags:
  - meeting
  - ${meetingType}
---
# ${data.title}

> [One sentence summary]

## Meeting Details
| | |
|---|---|
| **Date** | ${data.dateStr} |
| **Attendees** | ${data.attendees || 'Not recorded'} |
| **Duration** | ${Math.round((data.duration || 0) / 60) || '?'} min |`;

  const typeSpecificSections = {
    sales: `
## Summary
[3-4 paragraph summary with SPICED context]

## Bowtie Stage
[Stage: Awareness/Education/Selection/Commit/Onboarding/Adoption/Expansion]

## SPICED Analysis
### Situation
[Tech stack, company size, industry, geography]

### Pain
[Primary pain point with quotes]

### Impact
**Rational:** [$$$ impact]
**Emotional:** [Career/stress impact]

### Critical Event
[Deadline with consequences]

### Decision
[Process, criteria, stakeholders]

## Key Points
- [Point 1]
- [Point 2]

## Action Items
- [ ] [Action] #hudson
- [ ] [Action] #aaron

## Expansion Opportunities
**Insurance:** [Signals detected]
**IoT:** [Signals detected]

## Decisions
- [Decisions made]

## Sales Coaching
**What went well:** [Feedback]
**Areas for improvement:** [Feedback]

## Follow-up
- [Next steps]

## Notes
[Additional details]`,

    general: `
## Summary
[2-3 sentence summary]

## Key Points
- [Point 1]
- [Point 2]

## Action Items
- [ ] [Action with owner] #hudson
- [ ] [Action with owner] #aaron

## Decisions
| Decision | Rationale | Owner |
|----------|-----------|-------|
| [Decision] | [Why] | [Who] |

## Follow-up
- [Next steps]

## Notes
[Additional details]`,

    internal: `
## Objective & Outcome
**Objective:** [What this meeting was trying to accomplish]
**Outcome:** [Was it achieved?]

## Decisions
| # | Decision | Owner | Due |
|---|----------|-------|-----|
| 1 | [Decision] | #owner | [Date] |

## Action Items

### Hudson #hudson
- [ ] [Action] (Due: )

### Aaron #aaron
- [ ] [Action] (Due: )

### Kyle #kyle
- [ ] [Action] (Due: )

### Unassigned
- [ ] [Action - needs owner]

## Blockers & Risks
| Blocker | Impact | Owner | Mitigation |
|---------|--------|-------|------------|
| [Issue] | [Impact] | [Who] | [Solution] |

## Progress
**Completed:** [Items done]
**In Progress:** [Current work]
**Next:** [Upcoming]

## Parking Lot
- [Tabled items]

## Next Steps
- [What's next]`,

    research: `
## Participant Profile
| | |
|---|---|
| **Name** | [Name] |
| **Title** | [Role] |
| **Company** | [Company] |
| **Segment** | Shipper / Forwarder / Courier |
| **Industry** | Healthcare / Aerospace / Industrial |

## Executive Summary
[3-4 sentences about who this is, their challenges, and key insight]

## Current State
**Tech Stack:** [What they use]
**Operations:** [How they work]
**Vendors:** [Who they use today]

## Pain Points

### Pain 1: [Name]
- **Description:** [What's the problem?]
- **Quote:** "[Exact quote]"
- **Severity:** 🔴 High / 🟡 Medium / 🔵 Low
- **Impact:** [What it costs them]

### Pain 2: [Name]
[Same structure]

## Key Quotes

**On Current Pain:**
> "[Quote]" — [Name], [Title]

**On Ideal Solution:**
> "[Quote]" — [Name], [Title]

## Buying Signals
- [Signal with evidence]

## Warning Signs
- [Risk with evidence]

## Segment Insights
**Shippers:** [If applicable]
**Forwarders:** [If applicable]
**Couriers:** [If applicable]

## Product Implications
| Feature | Need | Priority | Evidence |
|---------|------|----------|----------|
| [Feature] | [What they said] | High/Med/Low | "[Quote]" |

## Follow-up
- [ ] [Next steps]

## Notes
[Additional details]`
  };

  return baseTemplate + (typeSpecificSections[meetingType] || typeSpecificSections.general);
}

// =============================================================================
// GEMINI API CALL
// =============================================================================

async function analyzeWithGemini(systemPrompt, userPrompt, model) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: userPrompt }]
      }],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.7
      }
    });

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message || JSON.stringify(json.error)));
          } else if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
            resolve(json.candidates[0].content.parts[0].text);
          } else {
            reject(new Error('Unexpected response format: ' + JSON.stringify(json).substring(0, 500)));
          }
        } catch (e) {
          reject(new Error('Parse error: ' + e.message + ' - ' + data.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(body);
    req.end();
  });
}

// =============================================================================
// HTTP SERVER
// =============================================================================

const server = http.createServer(async (req, res) => {
  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Main analyze endpoint - supports meetingType parameter
  if (req.url === '/analyze-meeting' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const meetingType = data.meetingType || 'general';
        const transcript = data.transcript || '';
        
        console.log(`[AI] Analyzing ${meetingType} meeting: ${data.title}`);
        
        // Select optimal model
        const model = selectModel(transcript.length, meetingType);
        console.log(`[AI] Using model: ${model} (transcript length: ${transcript.length})`);
        
        // Get system prompt for this meeting type
        const systemPrompt = SYSTEM_PROMPTS[meetingType] || SYSTEM_PROMPTS.general;
        
        // Get output template
        const outputTemplate = getOutputTemplate(meetingType, data);
        
        const userPrompt = `Analyze this meeting and create a structured Obsidian markdown note.

**Meeting:**
- Title: ${data.title}
- Date: ${data.dateStr}
- Attendees: ${data.attendees || 'Not specified'}
- Workspace: ${data.workspace || 'chrt'}

**Transcript:**
${transcript.substring(0, 500000)}

**Output this EXACT format (keep the quotes around wiki links):**

${outputTemplate}`;

        const result = await analyzeWithGemini(systemPrompt, userPrompt, model);
        
        // Clean response - remove markdown code fences if present
        let content = result.replace(/^```(?:markdown)?\n?/gm, '').replace(/\n?```$/gm, '').trim();
        
        console.log(`[AI] Analysis complete, length: ${content.length}, model: ${model}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          content, 
          model,
          meetingType,
          transcriptLength: transcript.length
        }));
      } catch (e) {
        console.error('[AI] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } 
  
  // Health check with capabilities
  else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      service: 'ai-analyze',
      provider: 'gemini',
      capabilities: {
        meetingTypes: ['sales', 'general', 'internal', 'research'],
        models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro']
      },
      apiKeyConfigured: !!GEMINI_API_KEY
    }));
  } 
  
  // List available meeting types
  else if (req.url === '/meeting-types') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      types: [
        { id: 'sales', name: 'Sales/Client', description: 'Full SPICED, MEDDPICC, sales coaching' },
        { id: 'general', name: 'General', description: 'Standard meeting notes' },
        { id: 'internal', name: 'Internal', description: 'Team syncs with ownership tracking' },
        { id: 'research', name: 'Research/Interview', description: 'Customer research and insights' }
      ]
    }));
  }
  
  else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('AI Analyze service running on port ' + PORT);
  console.log('Provider: Gemini');
  console.log('Meeting types: sales, general, internal, research');
  console.log('Models: gemini-2.0-flash, gemini-2.0-flash-lite, gemini-1.5-pro');
  console.log('API Key configured:', !!GEMINI_API_KEY);
});
