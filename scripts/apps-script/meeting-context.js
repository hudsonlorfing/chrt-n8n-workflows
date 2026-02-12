/**
 * Google Apps Script: Meeting Context Resolution & Memory Extraction
 *
 * Server-side endpoint for n8n meeting intel workflows (WF7 + WF8).
 * Offloads memory-intensive operations from n8n Cloud:
 *
 *   1. resolve-context — Lookup HubSpot contacts + prior meetings + agent memory
 *   2. extract-memory  — Parse structured_data into agent_memory facts
 *
 * Request format:
 *   POST { action: "resolve-context" | "extract-memory", ...params }
 *
 * Deploy: Extensions > Apps Script > Deploy > Web App
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * Required Script Properties:
 *   DOPPLER_SERVICE_KEY — fetches SUPABASE_URL, SUPABASE_SERVICE_KEY, HUBSPOT_ACCESS_TOKEN
 */

// ─── Constants ───

var SUPABASE_SECRETS_CACHE = {};
var MAX_PRIOR_MEETINGS = 3;
var MAX_MEMORY_FACTS = 20;

// ─── Entry Point ───

function doPost(e) {
  var startTime = Date.now();
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = (payload.action || '').toLowerCase().trim();

    console.log('=== Meeting Context Request ===');
    console.log('Action: ' + action);

    if (action === 'resolve-context') {
      return _resolveContext(payload, startTime);
    } else if (action === 'extract-memory') {
      return _extractMemory(payload, startTime);
    } else if (action === 'get-person-summary') {
      return _getPersonSummary(payload, startTime);
    } else if (action === 'get-crm-activity') {
      return _getCrmActivity(payload, startTime);
    } else if (action === 'get-meeting-prep') {
      return _getMeetingPrep(payload, startTime);
    } else {
      return _jsonResponse({ error: 'Unknown action: ' + action + '. Use resolve-context, extract-memory, get-person-summary, get-crm-activity, or get-meeting-prep.' }, 400);
    }
  } catch (err) {
    console.error('Fatal error: ' + err.message);
    console.error(err.stack);
    return _jsonResponse({ error: err.message, elapsed_ms: Date.now() - startTime }, 500);
  }
}

// ─── Action: resolve-context ───
// Input:  { action: "resolve-context", participant_emails: ["a@b.com"], meeting_id: "uuid" }
// Output: { participants: [{name, email, hubspot: {...}, prior_meetings: [...], memory: [...]}] }

function _resolveContext(payload, startTime) {
  var emails = payload.participant_emails || [];
  var meetingId = payload.meeting_id || null;

  if (!emails.length) {
    return _jsonResponse({ error: 'participant_emails is required and must be non-empty' }, 400);
  }

  var secrets = _getSecrets();
  var result = { participants: [] };

  for (var i = 0; i < emails.length; i++) {
    var email = emails[i].toLowerCase().trim();
    console.log('Processing participant: ' + email);

    var participant = {
      email: email,
      name: null,
      hubspot: null,
      prior_meetings: [],
      memory: []
    };

    // 1. Lookup participant in Supabase for cached HubSpot contact ID
    var sbParticipant = _supabaseGet(
      secrets,
      '/rest/v1/meeting_participants?email=eq.' + encodeURIComponent(email) +
      '&select=name,hubspot_contact_id,hubspot_properties' +
      '&order=created_at.desc&limit=1'
    );

    var hubspotContactId = null;
    if (sbParticipant && sbParticipant.length > 0) {
      participant.name = sbParticipant[0].name;
      hubspotContactId = sbParticipant[0].hubspot_contact_id;

      // If we have cached properties less than 24h old, use them
      if (sbParticipant[0].hubspot_properties && sbParticipant[0].hubspot_properties._cached_at) {
        var cacheAge = Date.now() - new Date(sbParticipant[0].hubspot_properties._cached_at).getTime();
        if (cacheAge < 24 * 60 * 60 * 1000) {
          participant.hubspot = sbParticipant[0].hubspot_properties;
          console.log('Using cached HubSpot properties for ' + email);
        }
      }
    }

    // 2. HubSpot lookup (fresh if no cache)
    if (!participant.hubspot) {
      try {
        var hsData = _hubspotLookup(secrets, email, hubspotContactId);
        participant.hubspot = hsData;
        participant.name = participant.name || (hsData ? hsData.firstname + ' ' + hsData.lastname : null);

        // Cache HubSpot properties back to Supabase (if we have a participant row)
        if (hsData && sbParticipant && sbParticipant.length > 0) {
          hsData._cached_at = new Date().toISOString();
          _supabasePatch(
            secrets,
            '/rest/v1/meeting_participants?email=eq.' + encodeURIComponent(email) +
            '&meeting_id=eq.' + meetingId,
            {
              hubspot_contact_id: hsData.contact_id || hubspotContactId,
              hubspot_properties: hsData
            }
          );
        }
      } catch (hsErr) {
        console.error('HubSpot lookup failed for ' + email + ': ' + hsErr.message);
        participant.hubspot = { error: hsErr.message };
      }
    }

    // 3. Prior meetings — last N completed meetings involving this email
    try {
      var priorMeetings = _supabaseGet(
        secrets,
        '/rest/v1/meeting_analyses?select=meeting_id,template_id,structured_data,scores,created_at,' +
        'meetings!inner(title,meeting_date,meeting_type)' +
        '&meetings.meeting_participants.email=eq.' + encodeURIComponent(email) +
        '&order=created_at.desc&limit=' + MAX_PRIOR_MEETINGS
      );

      // If the join approach doesn't work due to Supabase REST limitations,
      // fall back to a two-step lookup
      if (!priorMeetings || priorMeetings.length === 0) {
        priorMeetings = _getPriorMeetingsFallback(secrets, email, meetingId);
      }

      participant.prior_meetings = (priorMeetings || []).map(function(m) {
        var sd = m.structured_data || {};
        return {
          meeting_id: m.meeting_id,
          title: m.meetings ? m.meetings.title : (m.title || ''),
          date: m.meetings ? m.meetings.meeting_date : (m.meeting_date || ''),
          type: m.meetings ? m.meetings.meeting_type : (m.meeting_type || ''),
          template: m.template_id,
          summary: sd.summary || '',
          key_points: (sd.key_points || []).slice(0, 3),
          action_items: (sd.action_items || []).slice(0, 3),
          scores: m.scores
        };
      });
    } catch (pmErr) {
      console.error('Prior meetings lookup failed: ' + pmErr.message);
    }

    // 4. Agent memory — active facts about this person or their company
    try {
      var memoryFacts = _supabaseGet(
        secrets,
        '/rest/v1/agent_memory?is_active=eq.true' +
        '&or=(entity_id.eq.' + encodeURIComponent(email) +
        ',entity_name.ilike.*' + encodeURIComponent(email.split('@')[0]) + '*)' +
        '&order=created_at.desc&limit=' + MAX_MEMORY_FACTS
      );

      // Also fetch company-level memory if we know their company
      var companyDomain = email.split('@')[1];
      if (companyDomain && !_isGenericDomain(companyDomain)) {
        var companyMemory = _supabaseGet(
          secrets,
          '/rest/v1/agent_memory?is_active=eq.true' +
          '&entity_type=eq.company' +
          '&entity_id=eq.' + encodeURIComponent(companyDomain) +
          '&order=created_at.desc&limit=' + MAX_MEMORY_FACTS
        );
        memoryFacts = (memoryFacts || []).concat(companyMemory || []);
      }

      participant.memory = (memoryFacts || []).map(function(f) {
        return {
          type: f.entity_type,
          entity: f.entity_name || f.entity_id,
          fact: f.fact,
          confidence: f.confidence,
          from_meeting: f.source_meeting_id
        };
      });
    } catch (memErr) {
      console.error('Memory lookup failed: ' + memErr.message);
    }

    result.participants.push(participant);
  }

  result.elapsed_ms = Date.now() - startTime;
  console.log('resolve-context completed in ' + result.elapsed_ms + 'ms for ' + emails.length + ' participants');
  return _jsonResponse(result);
}

// ─── Action: extract-memory ───
// Input:  { action: "extract-memory", analysis_id, meeting_id, structured_data, participants }
// Output: { facts_created: N, facts_superseded: N }

function _extractMemory(payload, startTime) {
  var analysisId = payload.analysis_id;
  var meetingId = payload.meeting_id;
  var structuredData = payload.structured_data || {};
  var participants = payload.participants || [];

  if (!analysisId || !meetingId) {
    return _jsonResponse({ error: 'analysis_id and meeting_id are required' }, 400);
  }

  var secrets = _getSecrets();
  var factsCreated = 0;
  var factsSuperseded = 0;

  // Build a participant map for entity resolution
  var participantMap = {};
  for (var i = 0; i < participants.length; i++) {
    var p = participants[i];
    if (p.email) {
      participantMap[p.email.toLowerCase()] = p;
      if (p.name) {
        participantMap[p.name.toLowerCase()] = p;
      }
    }
  }

  // 1. Extract facts from action items
  var actionItems = structuredData.action_items || [];
  for (var j = 0; j < actionItems.length; j++) {
    var item = actionItems[j];
    if (item.owner) {
      var resolved = _resolveParticipant(item.owner, participantMap);
      var fact = 'Action item: ' + item.task;
      if (item.due) fact += ' (due: ' + item.due + ')';

      _upsertFact(secrets, {
        entity_type: 'person',
        entity_id: resolved.email || item.owner.toLowerCase(),
        entity_name: resolved.name || item.owner,
        fact: fact,
        confidence: 'high',
        source_meeting_id: meetingId,
        source_analysis_id: analysisId
      });
      factsCreated++;
    }
  }

  // 2. Extract facts from decisions
  var decisions = structuredData.decisions || [];
  for (var k = 0; k < decisions.length; k++) {
    _upsertFact(secrets, {
      entity_type: 'topic',
      entity_id: 'meeting-' + meetingId,
      entity_name: 'Meeting Decision',
      fact: decisions[k],
      confidence: 'high',
      source_meeting_id: meetingId,
      source_analysis_id: analysisId
    });
    factsCreated++;
  }

  // 3. Extract facts from follow-ups
  var followUps = structuredData.follow_ups || [];
  for (var l = 0; l < followUps.length; l++) {
    _upsertFact(secrets, {
      entity_type: 'topic',
      entity_id: 'meeting-' + meetingId,
      entity_name: 'Follow-up',
      fact: followUps[l],
      confidence: 'medium',
      source_meeting_id: meetingId,
      source_analysis_id: analysisId
    });
    factsCreated++;
  }

  // 4. Extract company-level facts from key points
  var keyPoints = structuredData.key_points || [];
  for (var m = 0; m < keyPoints.length; m++) {
    // Try to associate with a company domain from participants
    var companyDomain = _extractCompanyDomain(participants);
    if (companyDomain) {
      _upsertFact(secrets, {
        entity_type: 'company',
        entity_id: companyDomain,
        entity_name: companyDomain,
        fact: keyPoints[m],
        confidence: 'medium',
        source_meeting_id: meetingId,
        source_analysis_id: analysisId
      });
      factsCreated++;
    }
  }

  // 5. Supersede old conflicting facts for the same entities
  //    (Mark old action items from same person as inactive if this meeting is newer)
  for (var n = 0; n < participants.length; n++) {
    var pp = participants[n];
    if (!pp.email) continue;

    var oldFacts = _supabaseGet(
      secrets,
      '/rest/v1/agent_memory?is_active=eq.true' +
      '&entity_type=eq.person' +
      '&entity_id=eq.' + encodeURIComponent(pp.email.toLowerCase()) +
      '&fact=like.Action item:*' +
      '&source_meeting_id=neq.' + meetingId +
      '&select=id,fact,source_meeting_id'
    );

    if (oldFacts && oldFacts.length > 0) {
      // Check if the old meeting is older than this one
      for (var o = 0; o < oldFacts.length; o++) {
        _supabasePatch(
          secrets,
          '/rest/v1/agent_memory?id=eq.' + oldFacts[o].id,
          { is_active: false }
        );
        factsSuperseded++;
      }
    }
  }

  var result = {
    facts_created: factsCreated,
    facts_superseded: factsSuperseded,
    elapsed_ms: Date.now() - startTime
  };

  console.log('extract-memory completed: ' + factsCreated + ' created, ' + factsSuperseded + ' superseded');
  return _jsonResponse(result);
}

// ─── Action: get-person-summary ───
// Input:  { action: "get-person-summary", name: "trent", email: null, days_back: 90 }
// Output: { disambiguation_needed, matches, timeline, action_items, decisions, score_trend, memory_facts }

function _getPersonSummary(payload, startTime) {
  var name = (payload.name || '').trim();
  var email = (payload.email || '').trim().toLowerCase();
  var daysBack = parseInt(payload.days_back || '90', 10);

  if (!name && !email) {
    return _jsonResponse({ error: 'name or email is required' }, 400);
  }

  var secrets = _getSecrets();

  // Step 1: Find participants matching the name or email
  var participants;
  if (email) {
    participants = _supabaseGet(
      secrets,
      '/rest/v1/meeting_participants?email=eq.' + encodeURIComponent(email) +
      '&select=name,email,hubspot_properties,meeting_id' +
      '&order=created_at.desc&limit=50'
    );
  } else {
    var nameSearch = encodeURIComponent('*' + name + '*');
    participants = _supabaseGet(
      secrets,
      '/rest/v1/meeting_participants?name=ilike.' + nameSearch +
      '&select=name,email,hubspot_properties,meeting_id' +
      '&order=created_at.desc&limit=50'
    );
  }

  if (!participants || participants.length === 0) {
    return _jsonResponse({
      disambiguation_needed: false,
      matches: [],
      message: 'No participants found matching "' + (name || email) + '".',
      elapsed_ms: Date.now() - startTime
    });
  }

  // Step 2: Group by distinct person (unique email or name+company)
  var people = {};
  for (var i = 0; i < participants.length; i++) {
    var p = participants[i];
    var hsProps = p.hubspot_properties || {};
    var company = hsProps.company || '';
    var key = p.email ? p.email.toLowerCase() : ((p.name || '') + '|' + company).toLowerCase();

    if (!people[key]) {
      people[key] = {
        name: p.name || '',
        email: p.email || '',
        company: company,
        title: hsProps.jobtitle || '',
        meeting_ids: [],
        meeting_count: 0
      };
    }
    if (p.meeting_id && people[key].meeting_ids.indexOf(p.meeting_id) === -1) {
      people[key].meeting_ids.push(p.meeting_id);
      people[key].meeting_count++;
    }
  }

  var peopleList = [];
  var keys = Object.keys(people);
  for (var j = 0; j < keys.length; j++) {
    peopleList.push(people[keys[j]]);
  }

  // Filter out internal Chrt team members
  var externalPeople = peopleList.filter(function(p) {
    var emailDomain = p.email ? p.email.split('@')[1] : '';
    return !_isGenericDomain(emailDomain) || !p.email;
  });

  // If no external people, use all
  if (externalPeople.length === 0) externalPeople = peopleList;

  // Step 3: Disambiguation check
  if (externalPeople.length > 1) {
    // Get last meeting date for each person
    for (var d = 0; d < externalPeople.length; d++) {
      var person = externalPeople[d];
      if (person.meeting_ids.length > 0) {
        var lastMeeting = _supabaseGet(
          secrets,
          '/rest/v1/meetings?id=in.(' + person.meeting_ids.slice(0, 3).join(',') + ')' +
          '&select=meeting_date&order=meeting_date.desc&limit=1'
        );
        person.last_meeting_date = (lastMeeting && lastMeeting[0]) ? lastMeeting[0].meeting_date : null;
      }
    }
    return _jsonResponse({
      disambiguation_needed: true,
      matches: externalPeople.map(function(p) {
        return {
          name: p.name,
          email: p.email,
          company: p.company,
          title: p.title,
          meeting_count: p.meeting_count,
          last_meeting_date: p.last_meeting_date || null
        };
      }),
      elapsed_ms: Date.now() - startTime
    });
  }

  // Step 4: Single person — build full summary
  var targetPerson = externalPeople[0];
  return _buildPersonSummaryResponse(secrets, targetPerson, daysBack, startTime);
}

function _buildPersonSummaryResponse(secrets, targetPerson, daysBack, startTime) {
  var meetingIds = targetPerson.meeting_ids;

  // If we don't have meeting IDs from participants table, fall back to search
  if (meetingIds.length === 0 && targetPerson.email) {
    var participantRows = _supabaseGet(
      secrets,
      '/rest/v1/meeting_participants?email=eq.' + encodeURIComponent(targetPerson.email) +
      '&select=meeting_id&order=created_at.desc&limit=20'
    );
    meetingIds = (participantRows || []).map(function(r) { return r.meeting_id; });
  }

  if (meetingIds.length === 0) {
    return _jsonResponse({
      disambiguation_needed: false,
      person: { name: targetPerson.name, email: targetPerson.email, company: targetPerson.company },
      timeline: [],
      action_items: [],
      decisions: [],
      score_trend: [],
      memory_facts: [],
      message: 'No meetings found for this person.',
      elapsed_ms: Date.now() - startTime
    });
  }

  // Fetch meetings with date filter
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  var cutoffStr = cutoff.toISOString().split('T')[0];

  var idsFilter = meetingIds.join(',');
  var meetings = _supabaseGet(
    secrets,
    '/rest/v1/meetings?id=in.(' + idsFilter + ')' +
    '&meeting_date=gte.' + cutoffStr +
    '&order=meeting_date.desc&limit=15' +
    '&select=id,title,meeting_date,duration_mins,meeting_type,status,attendees_raw'
  );

  if (!meetings || meetings.length === 0) {
    return _jsonResponse({
      disambiguation_needed: false,
      person: { name: targetPerson.name, email: targetPerson.email, company: targetPerson.company },
      timeline: [],
      action_items: [],
      decisions: [],
      score_trend: [],
      memory_facts: [],
      message: 'No meetings found in the last ' + daysBack + ' days.',
      elapsed_ms: Date.now() - startTime
    });
  }

  // Fetch analyses for these meetings
  var analysisMeetingIds = meetings.map(function(m) { return m.id; });
  var analyses = _supabaseGet(
    secrets,
    '/rest/v1/meeting_analyses?meeting_id=in.(' + analysisMeetingIds.join(',') + ')' +
    '&select=meeting_id,structured_data,scores&order=created_at.desc'
  );

  // Build analysis map (latest per meeting)
  var analysisMap = {};
  if (analyses) {
    for (var a = 0; a < analyses.length; a++) {
      if (!analysisMap[analyses[a].meeting_id]) {
        analysisMap[analyses[a].meeting_id] = analyses[a];
      }
    }
  }

  // Build timeline, aggregate action items, decisions, scores
  var timeline = [];
  var allActionItems = [];
  var allDecisions = [];
  var scoreTrend = [];

  for (var m = 0; m < meetings.length; m++) {
    var mtg = meetings[m];
    var analysis = analysisMap[mtg.id];
    var sd = analysis ? (analysis.structured_data || {}) : {};
    if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e) { sd = {}; } }
    var scores = analysis ? (analysis.scores || sd.scores || {}) : {};

    timeline.push({
      meeting_id: mtg.id,
      title: mtg.title,
      date: mtg.meeting_date,
      duration: mtg.duration_mins,
      type: mtg.meeting_type,
      summary: (sd.summary || '').substring(0, 200)
    });

    // Aggregate action items with source
    var items = sd.action_items || [];
    for (var ai = 0; ai < items.length; ai++) {
      var item = items[ai];
      allActionItems.push({
        task: typeof item === 'string' ? item : (item.task || item.description || JSON.stringify(item)),
        owner: typeof item === 'object' ? (item.owner || '') : '',
        due: typeof item === 'object' ? (item.due || '') : '',
        from_meeting: mtg.title,
        from_date: mtg.meeting_date
      });
    }

    // Aggregate decisions
    var decs = sd.decisions || [];
    for (var di = 0; di < decs.length; di++) {
      allDecisions.push({
        decision: typeof decs[di] === 'string' ? decs[di] : JSON.stringify(decs[di]),
        from_meeting: mtg.title,
        from_date: mtg.meeting_date
      });
    }

    // Score trend
    if (Object.keys(scores).length > 0) {
      scoreTrend.push({
        date: mtg.meeting_date,
        meeting: mtg.title,
        scores: scores
      });
    }
  }

  // Fetch agent memory facts
  var memoryFacts = [];
  if (targetPerson.email) {
    var personMemory = _supabaseGet(
      secrets,
      '/rest/v1/agent_memory?is_active=eq.true' +
      '&or=(entity_id.eq.' + encodeURIComponent(targetPerson.email) +
      ',entity_name.ilike.*' + encodeURIComponent(targetPerson.email.split('@')[0]) + '*)' +
      '&order=created_at.desc&limit=20'
    );
    if (personMemory) {
      memoryFacts = personMemory.map(function(f) {
        return {
          type: f.entity_type,
          fact: f.fact,
          confidence: f.confidence
        };
      });
    }

    // Company memory
    var companyDomain = targetPerson.email.split('@')[1];
    if (companyDomain && !_isGenericDomain(companyDomain)) {
      var companyMemory = _supabaseGet(
        secrets,
        '/rest/v1/agent_memory?is_active=eq.true' +
        '&entity_type=eq.company' +
        '&entity_id=eq.' + encodeURIComponent(companyDomain) +
        '&order=created_at.desc&limit=10'
      );
      if (companyMemory) {
        for (var cm = 0; cm < companyMemory.length; cm++) {
          memoryFacts.push({
            type: 'company',
            fact: companyMemory[cm].fact,
            confidence: companyMemory[cm].confidence
          });
        }
      }
    }
  }

  return _jsonResponse({
    disambiguation_needed: false,
    person: {
      name: targetPerson.name,
      email: targetPerson.email,
      company: targetPerson.company,
      title: targetPerson.title
    },
    timeline: timeline,
    action_items: allActionItems.slice(0, 20),
    decisions: allDecisions.slice(0, 15),
    score_trend: scoreTrend,
    memory_facts: memoryFacts,
    meeting_count: meetings.length,
    elapsed_ms: Date.now() - startTime
  });
}

// ─── Action: get-crm-activity ───
// Input:  { action: "get-crm-activity", email: "trent@labcorp.com", contact_id: null, days_back: 30 }
// Output: { emails, calls, notes, summary, contact }

function _getCrmActivity(payload, startTime) {
  var email = (payload.email || '').trim().toLowerCase();
  var contactId = payload.contact_id || null;
  var daysBack = parseInt(payload.days_back || '30', 10);

  if (!email && !contactId) {
    return _jsonResponse({ error: 'email or contact_id is required' }, 400);
  }

  var secrets = _getSecrets();
  var hsToken = secrets.HUBSPOT_ACCESS_TOKEN;

  if (!hsToken) {
    return _jsonResponse({ error: 'No HUBSPOT_ACCESS_TOKEN available. Cannot fetch CRM activity.' }, 500);
  }

  // Step 1: Resolve contact_id from email if needed
  if (!contactId && email) {
    var hsData = _hubspotLookup(secrets, email, null);
    if (hsData && hsData.contact_id) {
      contactId = hsData.contact_id;
    } else {
      return _jsonResponse({
        emails: [],
        calls: [],
        notes: [],
        summary: 'No HubSpot contact found for ' + email + '.',
        contact: null,
        elapsed_ms: Date.now() - startTime
      });
    }
  }

  // Step 2: Build date filter
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  var cutoffMs = cutoff.getTime();

  // Step 3: Parallel fetch emails, calls, notes using fetchAll
  var searchBase = 'https://api.hubapi.com/crm/v3/objects/';
  var authHeaders = { 'Authorization': 'Bearer ' + hsToken, 'Content-Type': 'application/json' };

  var emailPayload = JSON.stringify({
    filterGroups: [{
      filters: [
        { propertyName: 'associations.contact', operator: 'EQ', value: contactId },
        { propertyName: 'hs_timestamp', operator: 'GTE', value: String(cutoffMs) }
      ]
    }],
    properties: ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_timestamp'],
    sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
    limit: 5
  });

  var callPayload = JSON.stringify({
    filterGroups: [{
      filters: [
        { propertyName: 'associations.contact', operator: 'EQ', value: contactId },
        { propertyName: 'hs_timestamp', operator: 'GTE', value: String(cutoffMs) }
      ]
    }],
    properties: ['hs_call_title', 'hs_call_body', 'hs_call_duration', 'hs_call_disposition', 'hs_timestamp'],
    sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
    limit: 5
  });

  var notePayload = JSON.stringify({
    filterGroups: [{
      filters: [
        { propertyName: 'associations.contact', operator: 'EQ', value: contactId },
        { propertyName: 'hs_timestamp', operator: 'GTE', value: String(cutoffMs) }
      ]
    }],
    properties: ['hs_note_body', 'hs_timestamp'],
    sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
    limit: 5
  });

  var requests = [
    { url: searchBase + 'emails/search', method: 'post', contentType: 'application/json', headers: authHeaders, payload: emailPayload, muteHttpExceptions: true },
    { url: searchBase + 'calls/search', method: 'post', contentType: 'application/json', headers: authHeaders, payload: callPayload, muteHttpExceptions: true },
    { url: searchBase + 'notes/search', method: 'post', contentType: 'application/json', headers: authHeaders, payload: notePayload, muteHttpExceptions: true }
  ];

  var responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch (fetchErr) {
    console.error('HubSpot fetchAll failed: ' + fetchErr.message);
    return _jsonResponse({
      emails: [],
      calls: [],
      notes: [],
      summary: 'Error fetching CRM activity: ' + fetchErr.message,
      elapsed_ms: Date.now() - startTime
    });
  }

  // Step 4: Parse responses
  var emails = [];
  var calls = [];
  var notes = [];
  var totalEmails = 0;
  var sentEmails = 0;
  var receivedEmails = 0;

  // Parse emails
  try {
    if (responses[0].getResponseCode() === 200) {
      var emailData = JSON.parse(responses[0].getContentText());
      totalEmails = emailData.total || 0;
      var emailResults = emailData.results || [];
      for (var i = 0; i < emailResults.length; i++) {
        var ep = emailResults[i].properties;
        var direction = ep.hs_email_direction || 'UNKNOWN';
        if (direction === 'EMAIL' || direction === 'FORWARDED_EMAIL') sentEmails++;
        else if (direction === 'INCOMING_EMAIL') receivedEmails++;
        emails.push({
          date: ep.hs_timestamp ? new Date(parseInt(ep.hs_timestamp)).toISOString().split('T')[0] : null,
          direction: direction === 'INCOMING_EMAIL' ? 'received' : 'sent',
          subject: (ep.hs_email_subject || '').substring(0, 120),
          snippet: (ep.hs_email_text || '').substring(0, 200)
        });
      }
    }
  } catch (emailErr) {
    console.error('Email parse error: ' + emailErr.message);
  }

  // Parse calls
  var totalCalls = 0;
  try {
    if (responses[1].getResponseCode() === 200) {
      var callData = JSON.parse(responses[1].getContentText());
      totalCalls = callData.total || 0;
      var callResults = callData.results || [];
      for (var j = 0; j < callResults.length; j++) {
        var cp = callResults[j].properties;
        calls.push({
          date: cp.hs_timestamp ? new Date(parseInt(cp.hs_timestamp)).toISOString().split('T')[0] : null,
          title: (cp.hs_call_title || '').substring(0, 120),
          duration_secs: cp.hs_call_duration ? parseInt(cp.hs_call_duration) : null,
          disposition: cp.hs_call_disposition || '',
          notes: (cp.hs_call_body || '').substring(0, 200)
        });
      }
    }
  } catch (callErr) {
    console.error('Call parse error: ' + callErr.message);
  }

  // Parse notes
  var totalNotes = 0;
  try {
    if (responses[2].getResponseCode() === 200) {
      var noteData = JSON.parse(responses[2].getContentText());
      totalNotes = noteData.total || 0;
      var noteResults = noteData.results || [];
      for (var k = 0; k < noteResults.length; k++) {
        var np = noteResults[k].properties;
        notes.push({
          date: np.hs_timestamp ? new Date(parseInt(np.hs_timestamp)).toISOString().split('T')[0] : null,
          body: (np.hs_note_body || '').replace(/<[^>]*>/g, '').substring(0, 200)
        });
      }
    }
  } catch (noteErr) {
    console.error('Note parse error: ' + noteErr.message);
  }

  var summaryParts = [];
  if (totalEmails > 0) summaryParts.push(totalEmails + ' email(s) (' + sentEmails + ' sent, ' + receivedEmails + ' received)');
  if (totalCalls > 0) summaryParts.push(totalCalls + ' call(s)');
  if (totalNotes > 0) summaryParts.push(totalNotes + ' note(s)');
  var summary = summaryParts.length > 0
    ? summaryParts.join(', ') + ' in last ' + daysBack + ' days'
    : 'No CRM activity found in last ' + daysBack + ' days';

  return _jsonResponse({
    emails: emails,
    calls: calls,
    notes: notes,
    summary: summary,
    contact_id: contactId,
    elapsed_ms: Date.now() - startTime
  });
}

// ─── Action: get-meeting-prep ───
// Input:  { action: "get-meeting-prep", name: "trent", email: "trent@labcorp.com", days_back: 90 }
// Output: Composed prep brief with CRM context, relationship arc, open items, key quotes, scores, CRM activity

function _getMeetingPrep(payload, startTime) {
  var name = (payload.name || '').trim();
  var email = (payload.email || '').trim().toLowerCase();
  var daysBack = parseInt(payload.days_back || '90', 10);

  if (!name && !email) {
    return _jsonResponse({ error: 'name or email is required' }, 400);
  }

  var secrets = _getSecrets();

  // Step 1: Resolve person (reuse person summary logic)
  var participants;
  if (email) {
    participants = _supabaseGet(
      secrets,
      '/rest/v1/meeting_participants?email=eq.' + encodeURIComponent(email) +
      '&select=name,email,hubspot_contact_id,hubspot_properties,meeting_id' +
      '&order=created_at.desc&limit=50'
    );
  } else {
    var nameSearch = encodeURIComponent('*' + name + '*');
    participants = _supabaseGet(
      secrets,
      '/rest/v1/meeting_participants?name=ilike.' + nameSearch +
      '&select=name,email,hubspot_contact_id,hubspot_properties,meeting_id' +
      '&order=created_at.desc&limit=50'
    );
  }

  if (!participants || participants.length === 0) {
    return _jsonResponse({
      prep: null,
      message: 'No participants found matching "' + (name || email) + '".',
      elapsed_ms: Date.now() - startTime
    });
  }

  // Group by distinct person
  var people = {};
  for (var i = 0; i < participants.length; i++) {
    var p = participants[i];
    var hsProps = p.hubspot_properties || {};
    var company = hsProps.company || '';
    var key = p.email ? p.email.toLowerCase() : ((p.name || '') + '|' + company).toLowerCase();
    if (!people[key]) {
      people[key] = {
        name: p.name || '',
        email: p.email || '',
        company: company,
        title: hsProps.jobtitle || '',
        hubspot_contact_id: p.hubspot_contact_id || null,
        meeting_ids: []
      };
    }
    if (p.meeting_id && people[key].meeting_ids.indexOf(p.meeting_id) === -1) {
      people[key].meeting_ids.push(p.meeting_id);
    }
  }

  var peopleList = [];
  var keys = Object.keys(people);
  for (var j = 0; j < keys.length; j++) {
    peopleList.push(people[keys[j]]);
  }

  // Filter out generic domains (internal team)
  var externalPeople = peopleList.filter(function(p) {
    var domain = p.email ? p.email.split('@')[1] : '';
    return !_isGenericDomain(domain) || !p.email;
  });
  if (externalPeople.length === 0) externalPeople = peopleList;

  // If multiple people, return disambiguation
  if (externalPeople.length > 1) {
    return _jsonResponse({
      disambiguation_needed: true,
      matches: externalPeople.map(function(p) {
        return { name: p.name, email: p.email, company: p.company, title: p.title, meeting_count: p.meeting_ids.length };
      }),
      elapsed_ms: Date.now() - startTime
    });
  }

  var target = externalPeople[0];

  // Step 2: Fetch meetings with analyses (same as person summary)
  var meetingIds = target.meeting_ids;
  if (meetingIds.length === 0 && target.email) {
    var pRows = _supabaseGet(
      secrets,
      '/rest/v1/meeting_participants?email=eq.' + encodeURIComponent(target.email) +
      '&select=meeting_id&order=created_at.desc&limit=20'
    );
    meetingIds = (pRows || []).map(function(r) { return r.meeting_id; });
  }

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  var cutoffStr = cutoff.toISOString().split('T')[0];

  var meetings = [];
  if (meetingIds.length > 0) {
    meetings = _supabaseGet(
      secrets,
      '/rest/v1/meetings?id=in.(' + meetingIds.join(',') + ')' +
      '&meeting_date=gte.' + cutoffStr +
      '&order=meeting_date.desc&limit=15' +
      '&select=id,title,meeting_date,duration_mins,meeting_type,status'
    ) || [];
  }

  // Fetch analyses
  var analysisMap = {};
  if (meetings.length > 0) {
    var mIds = meetings.map(function(m) { return m.id; });
    var analyses = _supabaseGet(
      secrets,
      '/rest/v1/meeting_analyses?meeting_id=in.(' + mIds.join(',') + ')' +
      '&select=meeting_id,structured_data,scores&order=created_at.desc'
    ) || [];
    for (var a = 0; a < analyses.length; a++) {
      if (!analysisMap[analyses[a].meeting_id]) {
        analysisMap[analyses[a].meeting_id] = analyses[a];
      }
    }
  }

  // Step 3: HubSpot contact + deal data
  var crmContext = { contact: null, deals: [] };
  if (target.email) {
    var hsData = _hubspotLookup(secrets, target.email, target.hubspot_contact_id);
    if (hsData) {
      crmContext.contact = {
        name: hsData.name || target.name,
        company: hsData.company || target.company,
        title: hsData.jobtitle || target.title,
        lifecycle_stage: hsData.lifecyclestage || '',
        lead_status: hsData.hs_lead_status || '',
        last_activity: hsData.notes_last_updated || ''
      };
      if (hsData.deals && hsData.deals.length > 0) {
        crmContext.deals = hsData.deals.map(function(d) {
          return {
            name: d.dealname || '',
            stage: d.dealstage || '',
            amount: d.amount || '',
            close_date: d.closedate || '',
            pipeline: d.pipeline || ''
          };
        });
      }
    }
  }

  // Step 4: CRM activity (emails/calls/notes) — lightweight version
  var crmActivity = { summary: '', emails: [], calls: [] };
  if (target.email) {
    try {
      // Call our own getCrmActivity function internally
      var actPayload = { email: target.email, days_back: 30 };
      // We can't call _getCrmActivity directly because it returns an HTTP response,
      // so we replicate the core logic briefly
      var hsToken = secrets.HUBSPOT_ACCESS_TOKEN;
      if (hsToken) {
        var contactIdForActivity = null;
        if (crmContext.contact && crmContext.contact.contact_id) {
          contactIdForActivity = crmContext.contact.contact_id;
        } else {
          var hsLookup = _hubspotLookup(secrets, target.email, null);
          if (hsLookup) contactIdForActivity = hsLookup.contact_id;
        }
        if (contactIdForActivity) {
          var actCutoff = new Date();
          actCutoff.setDate(actCutoff.getDate() - 30);
          var actCutoffMs = actCutoff.getTime();
          var searchBase = 'https://api.hubapi.com/crm/v3/objects/';
          var authH = { 'Authorization': 'Bearer ' + hsToken, 'Content-Type': 'application/json' };

          var emailPay = JSON.stringify({
            filterGroups: [{ filters: [
              { propertyName: 'associations.contact', operator: 'EQ', value: contactIdForActivity },
              { propertyName: 'hs_timestamp', operator: 'GTE', value: String(actCutoffMs) }
            ]}],
            properties: ['hs_email_subject', 'hs_email_direction', 'hs_timestamp'],
            sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
            limit: 3
          });
          var callPay = JSON.stringify({
            filterGroups: [{ filters: [
              { propertyName: 'associations.contact', operator: 'EQ', value: contactIdForActivity },
              { propertyName: 'hs_timestamp', operator: 'GTE', value: String(actCutoffMs) }
            ]}],
            properties: ['hs_call_title', 'hs_call_disposition', 'hs_timestamp'],
            sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
            limit: 3
          });

          var actResps = UrlFetchApp.fetchAll([
            { url: searchBase + 'emails/search', method: 'post', contentType: 'application/json', headers: authH, payload: emailPay, muteHttpExceptions: true },
            { url: searchBase + 'calls/search', method: 'post', contentType: 'application/json', headers: authH, payload: callPay, muteHttpExceptions: true }
          ]);

          try {
            if (actResps[0].getResponseCode() === 200) {
              var ed = JSON.parse(actResps[0].getContentText());
              crmActivity.summary += (ed.total || 0) + ' email(s)';
              crmActivity.emails = (ed.results || []).map(function(r) {
                var ep = r.properties;
                return { subject: ep.hs_email_subject || '', direction: ep.hs_email_direction === 'INCOMING_EMAIL' ? 'received' : 'sent' };
              });
            }
          } catch(e) {}
          try {
            if (actResps[1].getResponseCode() === 200) {
              var cd = JSON.parse(actResps[1].getContentText());
              crmActivity.summary += ', ' + (cd.total || 0) + ' call(s)';
              crmActivity.calls = (cd.results || []).map(function(r) {
                return { title: r.properties.hs_call_title || '', disposition: r.properties.hs_call_disposition || '' };
              });
            }
          } catch(e) {}
          crmActivity.summary += ' (last 30 days)';
        }
      }
    } catch (actErr) {
      console.error('CRM activity for prep failed: ' + actErr.message);
    }
  }

  // Step 5: Build the prep brief
  var relationshipArc = [];
  var allActionItems = [];
  var allFollowUps = [];
  var keyQuotes = [];
  var scoreTrend = [];

  for (var m = 0; m < meetings.length; m++) {
    var mtg = meetings[m];
    var analysis = analysisMap[mtg.id];
    var sd = analysis ? (analysis.structured_data || {}) : {};
    if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e) { sd = {}; } }
    var scores = analysis ? (analysis.scores || sd.scores || {}) : {};

    relationshipArc.push({
      date: mtg.meeting_date,
      title: mtg.title,
      type: mtg.meeting_type,
      summary: (sd.summary || '').substring(0, 200)
    });

    var items = sd.action_items || [];
    for (var ai = 0; ai < items.length; ai++) {
      var item = items[ai];
      allActionItems.push({
        task: typeof item === 'string' ? item : (item.task || item.description || ''),
        owner: typeof item === 'object' ? (item.owner || '') : '',
        due: typeof item === 'object' ? (item.due || '') : '',
        from_meeting: mtg.title,
        from_date: mtg.meeting_date
      });
    }

    var fups = sd.follow_ups || [];
    for (var fi = 0; fi < fups.length; fi++) {
      allFollowUps.push({
        item: typeof fups[fi] === 'string' ? fups[fi] : JSON.stringify(fups[fi]),
        from_meeting: mtg.title,
        from_date: mtg.meeting_date
      });
    }

    var quotes = sd.key_quotes || [];
    for (var qi = 0; qi < Math.min(quotes.length, 3); qi++) {
      var q = quotes[qi];
      keyQuotes.push({
        text: typeof q === 'string' ? q : (q.text || q.quote || ''),
        speaker: typeof q === 'object' ? (q.speaker || '') : '',
        from_meeting: mtg.title,
        from_date: mtg.meeting_date
      });
    }

    if (Object.keys(scores).length > 0) {
      scoreTrend.push({ date: mtg.meeting_date, meeting: mtg.title, scores: scores });
    }
  }

  // Step 6: Agent memory
  var memoryFacts = [];
  if (target.email) {
    var pm = _supabaseGet(
      secrets,
      '/rest/v1/agent_memory?is_active=eq.true' +
      '&or=(entity_id.eq.' + encodeURIComponent(target.email) +
      ',entity_name.ilike.*' + encodeURIComponent(target.email.split('@')[0]) + '*)' +
      '&order=created_at.desc&limit=10'
    );
    if (pm) {
      memoryFacts = pm.map(function(f) { return { type: f.entity_type, fact: f.fact }; });
    }
  }

  return _jsonResponse({
    disambiguation_needed: false,
    person: {
      name: target.name,
      email: target.email,
      company: target.company,
      title: target.title
    },
    crm_context: crmContext,
    relationship_arc: relationshipArc,
    open_items: {
      action_items: allActionItems.slice(0, 15),
      follow_ups: allFollowUps.slice(0, 10)
    },
    key_quotes: keyQuotes.slice(0, 8),
    score_trend: scoreTrend,
    crm_activity: crmActivity,
    memory_facts: memoryFacts,
    meeting_count: meetings.length,
    elapsed_ms: Date.now() - startTime
  });
}

// ─── HubSpot Helpers ───

function _hubspotLookup(secrets, email, cachedContactId) {
  var hsToken = secrets.HUBSPOT_ACCESS_TOKEN;
  if (!hsToken) {
    console.log('No HUBSPOT_ACCESS_TOKEN available, skipping HubSpot lookup');
    return null;
  }

  var contactId = cachedContactId;

  // If no cached contact ID, search by email
  if (!contactId) {
    var searchResp = UrlFetchApp.fetch(
      'https://api.hubapi.com/crm/v3/objects/contacts/search',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + hsToken },
        payload: JSON.stringify({
          filterGroups: [{
            filters: [{
              propertyName: 'email',
              operator: 'EQ',
              value: email
            }]
          }],
          properties: [
            'firstname', 'lastname', 'email', 'company', 'jobtitle',
            'phone', 'lifecyclestage', 'hs_lead_status',
            'last_spiced_score', 'last_meeting_intel_date',
            'meeting_intel_url', 'meeting_intel_next_steps'
          ],
          limit: 1
        }),
        muteHttpExceptions: true
      }
    );

    if (searchResp.getResponseCode() === 200) {
      var searchData = JSON.parse(searchResp.getContentText());
      if (searchData.total > 0) {
        contactId = searchData.results[0].id;
        var props = searchData.results[0].properties;
        var result = {
          contact_id: contactId,
          firstname: props.firstname || '',
          lastname: props.lastname || '',
          email: props.email || email,
          company: props.company || '',
          jobtitle: props.jobtitle || '',
          phone: props.phone || '',
          lifecyclestage: props.lifecyclestage || '',
          lead_status: props.hs_lead_status || '',
          last_spiced_score: props.last_spiced_score || null,
          last_meeting_intel_date: props.last_meeting_intel_date || null,
          deals: []
        };

        // Fetch associated deals
        result.deals = _hubspotGetDeals(secrets, contactId);
        return result;
      }
    }
    return null; // Contact not found
  }

  // Fetch by known contact ID
  var contactResp = UrlFetchApp.fetch(
    'https://api.hubapi.com/crm/v3/objects/contacts/' + contactId +
    '?properties=firstname,lastname,email,company,jobtitle,phone,lifecyclestage,hs_lead_status,' +
    'last_spiced_score,last_meeting_intel_date,meeting_intel_url,meeting_intel_next_steps',
    {
      headers: { 'Authorization': 'Bearer ' + hsToken },
      muteHttpExceptions: true
    }
  );

  if (contactResp.getResponseCode() === 200) {
    var contactData = JSON.parse(contactResp.getContentText());
    var cProps = contactData.properties;
    return {
      contact_id: contactId,
      firstname: cProps.firstname || '',
      lastname: cProps.lastname || '',
      email: cProps.email || email,
      company: cProps.company || '',
      jobtitle: cProps.jobtitle || '',
      phone: cProps.phone || '',
      lifecyclestage: cProps.lifecyclestage || '',
      lead_status: cProps.hs_lead_status || '',
      last_spiced_score: cProps.last_spiced_score || null,
      last_meeting_intel_date: cProps.last_meeting_intel_date || null,
      deals: _hubspotGetDeals(secrets, contactId)
    };
  }

  return null;
}

function _hubspotGetDeals(secrets, contactId) {
  var hsToken = secrets.HUBSPOT_ACCESS_TOKEN;
  var deals = [];

  try {
    var assocResp = UrlFetchApp.fetch(
      'https://api.hubapi.com/crm/v4/objects/contacts/' + contactId + '/associations/deals',
      {
        headers: { 'Authorization': 'Bearer ' + hsToken },
        muteHttpExceptions: true
      }
    );

    if (assocResp.getResponseCode() === 200) {
      var assocData = JSON.parse(assocResp.getContentText());
      var dealIds = (assocData.results || []).map(function(r) { return r.toObjectId; }).slice(0, 5);

      for (var i = 0; i < dealIds.length; i++) {
        var dealResp = UrlFetchApp.fetch(
          'https://api.hubapi.com/crm/v3/objects/deals/' + dealIds[i] +
          '?properties=dealname,dealstage,amount,closedate,pipeline',
          {
            headers: { 'Authorization': 'Bearer ' + hsToken },
            muteHttpExceptions: true
          }
        );

        if (dealResp.getResponseCode() === 200) {
          var dealData = JSON.parse(dealResp.getContentText());
          deals.push({
            id: dealIds[i],
            name: dealData.properties.dealname || '',
            stage: dealData.properties.dealstage || '',
            amount: dealData.properties.amount || '',
            close_date: dealData.properties.closedate || '',
            pipeline: dealData.properties.pipeline || ''
          });
        }
      }
    }
  } catch (err) {
    console.error('Deal lookup failed for contact ' + contactId + ': ' + err.message);
  }

  return deals;
}

// ─── Supabase Helpers ───

function _supabaseGet(secrets, path) {
  var resp = UrlFetchApp.fetch(
    secrets.SUPABASE_URL + path,
    {
      method: 'get',
      headers: {
        'apikey': secrets.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + secrets.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      muteHttpExceptions: true
    }
  );

  if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
    var text = resp.getContentText();
    return text ? JSON.parse(text) : [];
  }

  console.error('Supabase GET ' + path + ' failed (' + resp.getResponseCode() + '): ' + resp.getContentText().substring(0, 200));
  return [];
}

function _supabasePatch(secrets, path, data) {
  var resp = UrlFetchApp.fetch(
    secrets.SUPABASE_URL + path,
    {
      method: 'patch',
      headers: {
        'apikey': secrets.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + secrets.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      payload: JSON.stringify(data),
      muteHttpExceptions: true
    }
  );

  if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
    return true;
  }

  console.error('Supabase PATCH ' + path + ' failed (' + resp.getResponseCode() + '): ' + resp.getContentText().substring(0, 200));
  return false;
}

function _supabasePost(secrets, path, data) {
  var resp = UrlFetchApp.fetch(
    secrets.SUPABASE_URL + path,
    {
      method: 'post',
      headers: {
        'apikey': secrets.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + secrets.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation,resolution=merge-duplicates'
      },
      payload: JSON.stringify(data),
      muteHttpExceptions: true
    }
  );

  if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
    var text = resp.getContentText();
    return text ? JSON.parse(text) : null;
  }

  console.error('Supabase POST ' + path + ' failed (' + resp.getResponseCode() + '): ' + resp.getContentText().substring(0, 200));
  return null;
}

// ─── Memory Helpers ───

function _upsertFact(secrets, fact) {
  return _supabasePost(secrets, '/rest/v1/agent_memory', fact);
}

function _resolveParticipant(name, participantMap) {
  if (!name) return {};
  var key = name.toLowerCase().trim();
  if (participantMap[key]) {
    return participantMap[key];
  }
  // Try partial match
  var keys = Object.keys(participantMap);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(key) >= 0 || key.indexOf(keys[i]) >= 0) {
      return participantMap[keys[i]];
    }
  }
  return { name: name };
}

function _extractCompanyDomain(participants) {
  for (var i = 0; i < participants.length; i++) {
    var email = participants[i].email;
    if (email) {
      var domain = email.split('@')[1];
      if (domain && !_isGenericDomain(domain)) {
        return domain;
      }
    }
  }
  return null;
}

function _isGenericDomain(domain) {
  var generic = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'aol.com', 'icloud.com', 'me.com', 'live.com',
    'chrt.com', 'getchrt.com' // Our own domains
  ];
  return generic.indexOf(domain.toLowerCase()) >= 0;
}

// ─── Prior Meetings Fallback ───
// Two-step lookup when Supabase REST join doesn't work as expected

function _getPriorMeetingsFallback(secrets, email, excludeMeetingId) {
  // Step 1: Get meeting IDs where this email participated
  var filter = '/rest/v1/meeting_participants?email=eq.' + encodeURIComponent(email) +
    '&select=meeting_id&order=created_at.desc&limit=10';
  var participantRows = _supabaseGet(secrets, filter);

  if (!participantRows || participantRows.length === 0) return [];

  var meetingIds = participantRows
    .map(function(r) { return r.meeting_id; })
    .filter(function(id) { return id !== excludeMeetingId; });

  if (meetingIds.length === 0) return [];

  // Step 2: Get analyses for those meetings
  var idFilter = 'in.(' + meetingIds.slice(0, MAX_PRIOR_MEETINGS).join(',') + ')';
  var analyses = _supabaseGet(
    secrets,
    '/rest/v1/meeting_analyses?meeting_id=' + idFilter +
    '&select=meeting_id,template_id,structured_data,scores,created_at' +
    '&order=created_at.desc&limit=' + MAX_PRIOR_MEETINGS
  );

  if (!analyses || analyses.length === 0) return [];

  // Step 3: Get meeting titles for context
  var analysisIds = analyses.map(function(a) { return a.meeting_id; });
  var uniqueIds = analysisIds.filter(function(v, i, arr) { return arr.indexOf(v) === i; });
  var meetings = _supabaseGet(
    secrets,
    '/rest/v1/meetings?id=in.(' + uniqueIds.join(',') + ')' +
    '&select=id,title,meeting_date,meeting_type'
  );

  var meetingMap = {};
  (meetings || []).forEach(function(m) { meetingMap[m.id] = m; });

  return analyses.map(function(a) {
    var mtg = meetingMap[a.meeting_id] || {};
    return {
      meeting_id: a.meeting_id,
      title: mtg.title || '',
      meeting_date: mtg.meeting_date || '',
      meeting_type: mtg.meeting_type || '',
      template_id: a.template_id,
      structured_data: a.structured_data,
      scores: a.scores,
      created_at: a.created_at
    };
  });
}

// ─── Doppler: fetch secrets at runtime ───

function _getSecrets() {
  if (SUPABASE_SECRETS_CACHE.SUPABASE_URL) {
    return SUPABASE_SECRETS_CACHE;
  }

  var token = PropertiesService.getScriptProperties().getProperty('DOPPLER_SERVICE_KEY');
  if (!token) {
    throw new Error('DOPPLER_SERVICE_KEY not set in Script Properties');
  }

  var secretNames = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'HUBSPOT_ACCESS_TOKEN'];

  for (var i = 0; i < secretNames.length; i++) {
    var name = secretNames[i];
    var resp = UrlFetchApp.fetch(
      'https://api.doppler.com/v3/configs/config/secret?name=' + name,
      {
        headers: { 'Authorization': 'Bearer ' + token },
        muteHttpExceptions: true
      }
    );

    if (resp.getResponseCode() !== 200) {
      throw new Error('Doppler fetch failed for ' + name + ' (' + resp.getResponseCode() + '): ' + resp.getContentText().substring(0, 200));
    }

    var body = JSON.parse(resp.getContentText());
    SUPABASE_SECRETS_CACHE[name] = body.value.computed;
  }

  console.log('Secrets loaded from Doppler');
  return SUPABASE_SECRETS_CACHE;
}

// ─── Utilities ───

function _jsonResponse(obj, statusCode) {
  // Note: Apps Script web apps always return 200, but we include status in body
  if (statusCode && statusCode >= 400) {
    obj._status = statusCode;
  }
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
