/**
 * @deprecated — This VPS filesystem store is replaced by Supabase
 * (meeting_analyses + meeting_participants tables).
 * Kept for reference only. Do not deploy or update.
 * Deprecated: 2026-02-10
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = 3852;
const STORE_DIR = '/root/meeting-store';

// Ensure store directory exists
if (!fs.existsSync(STORE_DIR)) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

// Health check
app.get('/health', (req, res) => {
  const files = fs.readdirSync(STORE_DIR).filter(f => f.endsWith('.json'));
  res.json({ 
    status: 'ok', 
    service: 'meeting-store',
    storedMeetings: files.length
  });
});

// Store meeting data
app.post('/store', (req, res) => {
  try {
    const { hash, meeting } = req.body;
    
    if (!hash || !meeting) {
      return res.status(400).json({ error: 'Missing hash or meeting data' });
    }
    
    const filePath = path.join(STORE_DIR, `${hash}.json`);
    const data = {
      ...meeting,
      storedAt: new Date().toISOString(),
      hash
    };
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`[Store] Saved meeting ${hash}: ${meeting.title}`);
    
    res.json({ 
      success: true, 
      hash,
      message: `Meeting stored: ${meeting.title}`
    });
  } catch (error) {
    console.error('[Store] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Retrieve meeting data
app.get('/retrieve/:hash', (req, res) => {
  try {
    const { hash } = req.params;
    const filePath = path.join(STORE_DIR, `${hash}.json`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Meeting not found', hash });
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`[Retrieve] Found meeting ${hash}: ${data.title}`);
    
    res.json(data);
  } catch (error) {
    console.error('[Retrieve] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List stored meetings
app.get('/list', (req, res) => {
  try {
    const files = fs.readdirSync(STORE_DIR).filter(f => f.endsWith('.json'));
    const meetings = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), 'utf8'));
      return {
        hash: data.hash,
        title: data.title,
        personName: data.personName,
        workspace: data.workspace,
        storedAt: data.storedAt
      };
    });
    res.json({ count: meetings.length, meetings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete meeting
app.delete('/delete/:hash', (req, res) => {
  try {
    const { hash } = req.params;
    const filePath = path.join(STORE_DIR, `${hash}.json`);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Delete] Removed meeting ${hash}`);
      res.json({ success: true, deleted: hash });
    } else {
      res.status(404).json({ error: 'Meeting not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Meeting store running on port ${PORT}`);
  console.log(`Store directory: ${STORE_DIR}`);
});
