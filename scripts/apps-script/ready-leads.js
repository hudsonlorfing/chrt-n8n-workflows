/**
 * Google Apps Script: Fetch Ready Leads for Outreach
 *
 * Server-side endpoint for n8n workflow 2.1 (LinkedIn Outreach - Send).
 * Reads Master List, filters/sorts/limits, and returns only the leads
 * ready for outreach — keeping n8n memory usage near zero.
 *
 * Request: POST { profile: "kyle"|"hudson", minScore: 7, limit: 10 }
 *
 * CONFERENCE MODE: When a conference is active (Conferences tab has status=TRUE
 * and today <= end date), the endpoint:
 *   - Overrides minScore to 8
 *   - Only returns leads tagged with an active conference tag
 *   - Requires BOTH kyleSentDate AND hudsonSentDate to be blank
 *   - Auto-disables expired conferences (today > end date)
 *   - Detects exhaustion: if no conference leads remain for this profile,
 *     returns conferenceExhausted flag and falls through to normal ICP leads
 *
 * NORMAL MODE filters (all server-side):
 *   1. score >= minScore (configurable from n8n)
 *   2. connectionFrom matches profile (or "both")
 *   3. kyleSentDate or hudsonSentDate is blank (based on profile)
 *   4. defaultProfileUrl / profileUrl is not empty
 *   5. segment !== "Skip"
 *
 * Returns leads sorted by score descending, limited to `limit` rows.
 *
 * Deploy: Extensions > Apps Script > Deploy > Web App
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * Spreadsheet: 1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8
 *   - Master List  (read only)
 *   - Conferences   (read/write — auto-disable expired conferences)
 */

var SPREADSHEET_ID = '1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8';

function doPost(e) {
  var startTime = Date.now();
  try {
    var payload = JSON.parse(e.postData.contents);
    var profile = (payload.profile || '').toLowerCase().trim();
    var minScore = payload.minScore !== undefined ? parseFloat(payload.minScore) : 7;
    var limit = parseInt(payload.limit) || 10;

    console.log('=== Ready Leads Request ===');
    console.log('Profile: ' + profile + ' | minScore: ' + minScore + ' | limit: ' + limit);

    if (!profile || (profile !== 'kyle' && profile !== 'hudson')) {
      console.error('Invalid profile: "' + profile + '"');
      return _jsonResponse({ ok: false, error: 'Invalid profile — must be "kyle" or "hudson"' });
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // ── Step 0: Read Conferences tab and detect conference mode ──

    var conferenceMode = false;
    var activeConferences = [];
    var conferenceExhausted = false;
    var exhaustedFor = '';

    var confResult = _readAndManageConferences(ss);
    activeConferences = confResult.active;

    var activeTags = [];
    if (activeConferences.length > 0) {
      conferenceMode = true;
      activeTags = activeConferences.map(function(c) { return c.tag.toLowerCase(); });
      console.log('CONFERENCE MODE: ' + activeConferences.length + ' active conference(s)');
      console.log('Active tags: ' + activeTags.join(', '));
      console.log('Conference leads will be prioritized first (score >= ' + minScore + ')');
    } else {
      console.log('NORMAL MODE: no active conferences');
    }

    var sheet = ss.getSheetByName('Master List');
    if (!sheet) {
      console.error('Master List sheet not found');
      return _jsonResponse({ ok: false, error: 'Master List sheet not found' });
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    console.log('Sheet size: ' + (lastRow - 1) + ' rows x ' + lastCol + ' cols');

    if (lastRow < 2) {
      console.log('Sheet is empty — returning 0 leads');
      return _jsonResponse({ ok: true, count: 0, leads: [], conferenceMode: conferenceMode, message: 'Master List is empty' });
    }

    // ── Read headers and data ──

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    console.log('Read ' + data.length + ' rows in ' + (Date.now() - startTime) + 'ms');

    // Column indices
    var colIdx = {};
    var needed = ['score', 'connectionFrom', 'kyleSentDate', 'hudsonSentDate',
                  'defaultProfileUrl', 'profileUrl', 'segment', 'conferenceTags'];
    for (var h = 0; h < headers.length; h++) {
      if (needed.indexOf(headers[h]) !== -1) {
        colIdx[headers[h]] = h;
      }
    }

    // Log which columns we found (and which are missing)
    var found = [];
    var missing = [];
    for (var n = 0; n < needed.length; n++) {
      if (colIdx[needed[n]] !== undefined) {
        found.push(needed[n] + '=' + colIdx[needed[n]]);
      } else {
        missing.push(needed[n]);
      }
    }
    console.log('Columns found: ' + found.join(', '));
    if (missing.length > 0) {
      console.warn('Columns MISSING: ' + missing.join(', '));
    }

    // Validate required columns exist
    if (colIdx.score === undefined || colIdx.connectionFrom === undefined) {
      console.error('Missing required columns — cannot filter');
      return _jsonResponse({ ok: false, error: 'Missing required columns: score, connectionFrom' });
    }

    // ── Single-pass filter: collect leads into three tiers ──
    //
    // Tier 1 (confExclusive): Conference leads where NEITHER profile has sent yet
    //         → maximize unique coverage across Kyle + Hudson
    // Tier 2 (confOverlap):   Conference leads where the OTHER profile sent but THIS hasn't
    //         → fallback: better to double-connect than miss the conference
    // Tier 3 (normalLeads):   Regular ICP leads (no conference tag)
    //

    var confExclusive = [];  // neither profile has sent
    var confOverlap = [];    // other profile sent, this profile hasn't
    var normalLeads = [];
    var sentDateCol = profile === 'kyle' ? 'kyleSentDate' : 'hudsonSentDate';
    var otherSentDateCol = profile === 'kyle' ? 'hudsonSentDate' : 'kyleSentDate';
    var skipped = { lowScore: 0, wrongProfile: 0, alreadySent: 0, noUrl: 0, skipSegment: 0 };

    for (var r = 0; r < data.length; r++) {
      var row = data[r];

      // 1. score >= minScore
      var score = parseFloat(row[colIdx.score]);
      if (isNaN(score) || score < minScore) { skipped.lowScore++; continue; }

      // 2. connectionFrom matches profile (or "both")
      var connectionFrom = String(row[colIdx.connectionFrom] || '').trim().toLowerCase();
      if (connectionFrom !== profile && connectionFrom !== 'both') { skipped.wrongProfile++; continue; }

      // 3. Has a profile URL
      var url = String(row[colIdx.defaultProfileUrl] || '').trim() ||
                String(row[colIdx.profileUrl] || '').trim();
      if (!url) { skipped.noUrl++; continue; }

      // 4. segment !== Skip
      if (colIdx.segment !== undefined) {
        var segment = String(row[colIdx.segment] || '').trim();
        if (segment === 'Skip') { skipped.skipSegment++; continue; }
      }

      // 5. This profile must NOT have already sent
      var mySent = colIdx[sentDateCol] !== undefined ? String(row[colIdx[sentDateCol]] || '').trim() : '';
      if (mySent !== '') { skipped.alreadySent++; continue; }

      // 6. Check if this is a conference lead with an active tag
      var isConferenceLead = false;
      if (conferenceMode && colIdx.conferenceTags !== undefined) {
        var confTags = String(row[colIdx.conferenceTags] || '').trim().toLowerCase();
        if (confTags) {
          var tagList = confTags.split(',').map(function(t) { return t.trim(); });
          for (var at = 0; at < activeTags.length; at++) {
            if (tagList.indexOf(activeTags[at]) !== -1) { isConferenceLead = true; break; }
          }
        }
      }

      // Build lead object
      var lead = {};
      for (var c = 0; c < headers.length; c++) {
        lead[headers[c]] = row[c];
      }
      lead._score = score;
      lead._isConference = isConferenceLead;

      if (isConferenceLead) {
        // Check if the OTHER profile has already sent to this person
        var otherSent = colIdx[otherSentDateCol] !== undefined ? String(row[colIdx[otherSentDateCol]] || '').trim() : '';
        if (otherSent === '') {
          lead._tier = 1;
          confExclusive.push(lead);
        } else {
          lead._tier = 2;
          confOverlap.push(lead);
        }
      } else {
        lead._tier = 3;
        normalLeads.push(lead);
      }
    }

    // ── Log results ──

    console.log('=== Filter Results ===');
    if (conferenceMode) {
      console.log('Tier 1 — Conference exclusive (neither sent): ' + confExclusive.length);
      console.log('Tier 2 — Conference overlap (other sent): ' + confOverlap.length);
    }
    console.log('Tier 3 — Normal leads: ' + normalLeads.length);
    console.log('Skipped — lowScore (<' + minScore + '): ' + skipped.lowScore);
    console.log('Skipped — wrongProfile (not ' + profile + '/both): ' + skipped.wrongProfile);
    console.log('Skipped — alreadySent (' + sentDateCol + ' filled): ' + skipped.alreadySent);
    console.log('Skipped — noUrl: ' + skipped.noUrl);
    console.log('Skipped — skipSegment: ' + skipped.skipSegment);

    // ── Conference exhaustion check ──

    if (conferenceMode && confExclusive.length === 0 && confOverlap.length === 0) {
      var otherProfile = profile === 'kyle' ? 'hudson' : 'kyle';
      var otherExhausted = _checkOtherProfileExhausted(data, colIdx, headers, activeTags, otherProfile);
      exhaustedFor = otherExhausted ? 'both' : profile;
      conferenceExhausted = true;
      console.log('Conference leads EXHAUSTED for: ' + exhaustedFor);
    }

    // ── Sort: Tier 1 first, then Tier 2, then Tier 3 (each by score desc) ──

    confExclusive.sort(function(a, b) { return b._score - a._score; });
    confOverlap.sort(function(a, b) { return b._score - a._score; });
    normalLeads.sort(function(a, b) { return b._score - a._score; });
    var filtered = confExclusive.concat(confOverlap).concat(normalLeads);

    // ── Limit ──

    var limited = filtered.slice(0, limit);

    // Log top leads for debugging
    if (limited.length > 0) {
      var t1InBatch = limited.filter(function(l) { return l._tier === 1; }).length;
      var t2InBatch = limited.filter(function(l) { return l._tier === 2; }).length;
      var t3InBatch = limited.length - t1InBatch - t2InBatch;
      console.log('=== Top ' + limited.length + ' Leads (exclusive: ' + t1InBatch + ', overlap: ' + t2InBatch + ', normal: ' + t3InBatch + ') ===');
      var tierLabel = { 1: '[CONF] ', 2: '[CONF-OVERLAP] ', 3: '' };
      for (var i = 0; i < Math.min(limited.length, 5); i++) {
        var l = limited[i];
        console.log((i + 1) + '. ' + (tierLabel[l._tier] || '') + (l.fullName || 'N/A') + ' | score=' + l._score + ' | ' + (l.defaultProfileUrl || l.profileUrl || 'no url'));
      }
      if (limited.length > 5) {
        console.log('... and ' + (limited.length - 5) + ' more');
      }
    }

    // Clean up internal fields
    var leads = limited.map(function(lead) {
      delete lead._score;
      delete lead._isConference;
      delete lead._tier;
      return lead;
    });

    var elapsed = Date.now() - startTime;
    console.log('=== Done in ' + elapsed + 'ms — returning ' + leads.length + ' leads ===');

    var response = {
      ok: true,
      profile: profile,
      minScore: minScore,
      conferenceMode: conferenceMode,
      totalMatched: filtered.length,
      count: leads.length,
      leads: leads,
      _debug: {
        sheetRows: data.length,
        elapsedMs: elapsed
      }
    };

    // Add conference exhaustion info if applicable
    if (conferenceExhausted) {
      response.conferenceExhausted = true;
      response.exhaustedFor = exhaustedFor;
      // Include active conference info for the Slack alert in 2.1
      if (activeConferences.length > 0) {
        response.conferenceName = activeConferences[0].name;
        response.conferenceEndDate = activeConferences[0].end;
      }
    }

    return _jsonResponse(response);

  } catch (err) {
    console.error('FATAL: ' + err.message + '\n' + err.stack);
    return _jsonResponse({ ok: false, error: err.message, stack: err.stack });
  }
}

// ── Read Conferences tab, auto-disable expired, return active conferences ──

function _readAndManageConferences(ss) {
  var result = { active: [], disabled: 0 };
  var confSheet = ss.getSheetByName('Conferences');
  if (!confSheet) {
    console.log('Conferences tab not found — normal mode');
    return result;
  }

  var lastRow = confSheet.getLastRow();
  if (lastRow < 2) {
    console.log('Conferences tab is empty — normal mode');
    return result;
  }

  var headers = confSheet.getRange(1, 1, 1, confSheet.getLastColumn()).getValues()[0];
  // Case-insensitive header lookup
  var headersLower = headers.map(function(h) { return String(h).trim().toLowerCase(); });
  var nameIdx = headersLower.indexOf('name');
  var tagIdx = headersLower.indexOf('tag');
  var statusIdx = headersLower.indexOf('status');
  var startIdx = headersLower.indexOf('start');
  var endIdx = headersLower.indexOf('end');

  if (tagIdx === -1 || statusIdx === -1) {
    console.warn('Conferences tab missing required columns (tag, status). Headers found: ' + JSON.stringify(headers));
    return result;
  }

  var data = confSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var status = row[statusIdx];

    // Only process rows with status = TRUE
    if (status !== true && String(status).toUpperCase() !== 'TRUE') continue;

    var tag = String(row[tagIdx] || '').trim();
    if (!tag) continue;

    // Check if conference has expired
    var endDate = endIdx !== -1 ? new Date(row[endIdx]) : null;
    if (endDate && !isNaN(endDate.getTime())) {
      endDate.setHours(23, 59, 59, 999); // End of day
      if (today > endDate) {
        // Auto-disable expired conference
        confSheet.getRange(i + 2, statusIdx + 1).setValue(false);
        result.disabled++;
        console.log('Auto-disabled expired conference: "' + tag + '" (ended ' + row[endIdx] + ')');
        continue;
      }
    }

    // Conference is active
    var conf = {
      name: nameIdx !== -1 ? String(row[nameIdx] || '').trim() : tag,
      tag: tag,
      start: startIdx !== -1 ? String(row[startIdx] || '') : '',
      end: endIdx !== -1 ? String(row[endIdx] || '') : ''
    };

    // Deduplicate by tag (multiple rows per conference allowed)
    var alreadyAdded = false;
    for (var a = 0; a < result.active.length; a++) {
      if (result.active[a].tag === conf.tag) { alreadyAdded = true; break; }
    }
    if (!alreadyAdded) {
      result.active.push(conf);
    }
  }

  if (result.disabled > 0) {
    console.log('Auto-disabled ' + result.disabled + ' expired conference row(s)');
  }

  return result;
}

// ── Check if the other profile is also exhausted for conference leads ──

function _checkOtherProfileExhausted(data, colIdx, headers, activeTags, otherProfile) {
  for (var r = 0; r < data.length; r++) {
    var row = data[r];

    // score >= 8
    var score = parseFloat(row[colIdx.score]);
    if (isNaN(score) || score < 8) continue;

    // Has active conference tag
    var confTags = colIdx.conferenceTags !== undefined
      ? String(row[colIdx.conferenceTags] || '').trim().toLowerCase()
      : '';
    if (!confTags) continue;

    var tagList = confTags.split(',').map(function(t) { return t.trim(); });
    var hasActiveTag = false;
    for (var at = 0; at < activeTags.length; at++) {
      if (tagList.indexOf(activeTags[at]) !== -1) { hasActiveTag = true; break; }
    }
    if (!hasActiveTag) continue;

    // connectionFrom matches otherProfile or "both"
    var cf = String(row[colIdx.connectionFrom] || '').trim().toLowerCase();
    if (cf !== otherProfile && cf !== 'both') continue;

    // BOTH kyleSentDate AND hudsonSentDate must be blank
    var kyleSent = colIdx.kyleSentDate !== undefined ? String(row[colIdx.kyleSentDate] || '').trim() : '';
    var hudsonSent = colIdx.hudsonSentDate !== undefined ? String(row[colIdx.hudsonSentDate] || '').trim() : '';
    if (kyleSent !== '' || hudsonSent !== '') continue;

    // Has profile URL
    var url = String(row[colIdx.defaultProfileUrl] || '').trim() ||
              String(row[colIdx.profileUrl] || '').trim();
    if (!url) continue;

    // Not Skip
    if (colIdx.segment !== undefined) {
      var seg = String(row[colIdx.segment] || '').trim();
      if (seg === 'Skip') continue;
    }

    // Found at least one available lead for the other profile
    return false;
  }

  // No leads found for the other profile either
  return true;
}

function doGet(e) {
  return _jsonResponse({
    ok: true,
    message: 'Ready Leads endpoint is live (conference mode supported)',
    usage: 'POST { profile: "kyle"|"hudson", minScore: 7, limit: 10 }'
  });
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
