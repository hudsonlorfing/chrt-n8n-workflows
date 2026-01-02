const http = require('http');
const https = require('https');
const PORT = 3851;

// Keys stored securely on VPS via environment variable
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function analyzeWithClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message || JSON.stringify(json.error)));
          } else {
            resolve(json.content?.[0]?.text || '');
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

const server = http.createServer(async (req, res) => {
  if (req.url === '/analyze-meeting' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        console.log('[AI] Analyzing meeting:', data.title);
        
        const prompt = `You are a meeting analysis expert. Create a structured Obsidian markdown note.

**Meeting:**
- Title: ${data.title}
- Date: ${data.dateStr}
- Attendees: ${data.attendees || 'Not specified'}
- Purpose: ${data.purpose || 'Not specified'}
- Focus: ${data.focusAreas || 'None'}

**Transcript:**
${(data.transcript || '').substring(0, 80000)}

**Output this EXACT format (keep the quotes around wiki links):**

---
up:
  - "[[Calendar]]"
in:
  - "[[Meetings]]"
related:
created: ${data.dateStr}
tags:
  - meeting
---
# ${data.title}

> [One sentence summary]

## Meeting Details
| | |
|---|---|
| **Date** | ${data.dateStr} |
| **Attendees** | ${data.attendees || 'Not recorded'} |
| **Duration** | ${Math.round((data.duration || 0) / 60) || '?'} min |

## Summary
[3-4 sentence summary]

## Key Points
- [Point 1]
- [Point 2]

## Action Items
- [ ] [Action with owner] #hudson

## Decisions
- [Decisions made]

## Follow-up
- [Next steps]

## Notes
[Additional details]`;

        const result = await analyzeWithClaude(prompt);
        
        // Clean response - remove markdown code fences if present
        let content = result.replace(/^```(?:markdown)?\n?/gm, '').replace(/\n?```$/gm, '').trim();
        
        console.log('[AI] Analysis complete, length:', content.length);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content, model: 'claude-sonnet-4-20250514' }));
      } catch (e) {
        console.error('[AI] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ai-analyze' }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('AI Analyze service running on port ' + PORT);
});

