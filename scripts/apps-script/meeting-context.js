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
    } else {
      return _jsonResponse({ error: 'Unknown action: ' + action + '. Use resolve-context or extract-memory.' }, 400);
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
