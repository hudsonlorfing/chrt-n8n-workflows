/**
 * Google Apps Script: Pipeline Results Processor
 *
 * All-in-one endpoint for n8n workflow 4.2 (Pipeline Monitor - Results).
 * Receives PhantomBuster crawl results + profile, then handles everything
 * server-side to keep n8n memory usage near zero:
 *
 *   1. Reads Master List + New Leads defaultProfileUrl for deduping
 *   2. Identifies unique profiles (not in either sheet)
 *   3. Identifies profiles needing connectionFrom → "both"
 *   4. Appends unique profiles to New Leads (ALL PB fields preserved)
 *   5. Updates connectionFrom to "both" for overlapping profiles
 *   6. Looks up conferenceTag from Conferences tab when searchUrl is provided
 *   7. Returns a complete result summary
 *
 * Dedup key: defaultProfileUrl (the canonical LinkedIn vanity URL)
 *
 * Request: POST {
 *   profiles: [ { defaultProfileUrl, firstName, lastName, ... }, ... ],
 *   profile: "kyle"|"hudson",
 *   searchUrl: "https://linkedin.com/sales/search/..." (optional — triggers conference tag lookup)
 * }
 *
 * Deploy: Extensions > Apps Script > Deploy > Web App
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * Spreadsheet: 1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8
 *   - Master List  (read defaultProfileUrl + connectionFrom for dedup, update connectionFrom)
 *   - New Leads    (read defaultProfileUrl + connectionFrom for dedup, append new, update connectionFrom)
 *   - Conferences  (read salesNavUrl + tag to resolve conferenceTag from searchUrl)
 */

var SPREADSHEET_ID = '1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8';

function doPost(e) {
  var startTime = Date.now();
  try {
    var payload = JSON.parse(e.postData.contents);
    var profiles = payload.profiles || [];
    var currentProfile = (payload.profile || '').toLowerCase().trim();
    var searchUrl = (payload.searchUrl || '').trim();

    console.log('=== Pipeline Results Processor ===');
    console.log('Profile: ' + currentProfile + ' | Phantom profiles: ' + profiles.length);
    if (searchUrl) console.log('searchUrl: ' + searchUrl);

    if (!currentProfile || (currentProfile !== 'kyle' && currentProfile !== 'hudson')) {
      console.error('Invalid profile: "' + currentProfile + '"');
      return _jsonResponse({ ok: false, error: 'Invalid profile — must be "kyle" or "hudson"' });
    }

    if (!profiles.length) {
      console.log('No profiles to process — returning empty');
      return _jsonResponse({ ok: true, stats: { phantom: 0, unique: 0, duplicates: 0, toUpdate: 0, appended: 0, updated: 0 } });
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // ── Step 0: Resolve conferenceTag from searchUrl via Conferences tab ──

    var conferenceTag = '';
    if (searchUrl) {
      conferenceTag = _resolveConferenceTag(ss, searchUrl);
      console.log('Resolved conferenceTag: "' + conferenceTag + '"');
    }

    // ── Step 1: Read defaultProfileUrl + connectionFrom from both sheets ──

    var masterData = _readDefaultUrlsAndCF(ss, 'Master List');
    var newLeadsData = _readDefaultUrlsAndCF(ss, 'New Leads');

    console.log('Master List: ' + masterData.count + ' defaultProfileUrls loaded');
    console.log('New Leads: ' + newLeadsData.count + ' defaultProfileUrls loaded');
    console.log('Sheet read time: ' + (Date.now() - startTime) + 'ms');

    // ── Step 2: Dedupe phantom profiles against both sheets ──

    var uniqueProfiles = [];
    var profilesToUpdate = []; // { row, sheetName }
    var duplicateCount = 0;
    var noUrlCount = 0;

    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i];
      var url = _normalizeUrl(p.defaultProfileUrl || '');

      if (!url) {
        noUrlCount++;
        uniqueProfiles.push(p); // no URL — treat as unique to be safe
        continue;
      }

      var masterMatch = masterData.urlMap[url] || null;
      var newLeadsMatch = newLeadsData.urlMap[url] || null;

      if (!masterMatch && !newLeadsMatch) {
        uniqueProfiles.push(p);
        continue;
      }

      duplicateCount++;

      // URL exists — only update connectionFrom to "both" when the existing
      // value differs from currentProfile (and isn't already "both")
      if (masterMatch && masterMatch.connectionFrom !== currentProfile && masterMatch.connectionFrom !== 'both') {
        profilesToUpdate.push({ row: masterMatch.row, sheetName: 'Master List' });
      }
      if (newLeadsMatch && newLeadsMatch.connectionFrom !== currentProfile && newLeadsMatch.connectionFrom !== 'both') {
        profilesToUpdate.push({ row: newLeadsMatch.row, sheetName: 'New Leads' });
      }
    }

    console.log('=== Dedupe Results ===');
    console.log('Unique (new): ' + uniqueProfiles.length);
    console.log('Duplicates: ' + duplicateCount);
    console.log('No defaultProfileUrl (treated as unique): ' + noUrlCount);
    console.log('ConnectionFrom updates needed: ' + profilesToUpdate.length);

    // Log first 3 duplicates for verification
    if (duplicateCount > 0) {
      console.log('=== Sample Duplicates (first 3) ===');
      var dupesSeen = 0;
      for (var d = 0; d < profiles.length && dupesSeen < 3; d++) {
        var dp = profiles[d];
        var dUrl = _normalizeUrl(dp.defaultProfileUrl || '');
        if (!dUrl) continue;
        var inMaster = !!masterData.urlMap[dUrl];
        var inNewLeads = !!newLeadsData.urlMap[dUrl];
        if (inMaster || inNewLeads) {
          console.log((dupesSeen + 1) + '. ' + (dp.fullName || dp.firstName) + ' | ' + dp.defaultProfileUrl + ' | found in: ' + (inMaster ? 'Master' : '') + (inMaster && inNewLeads ? '+' : '') + (inNewLeads ? 'NewLeads' : ''));
          dupesSeen++;
        }
      }
    }

    // ── Step 3: Append unique profiles to New Leads (ALL PB fields) ──

    var appendedCount = 0;
    if (uniqueProfiles.length > 0) {
      appendedCount = _appendToNewLeads(ss, uniqueProfiles, currentProfile, conferenceTag);
      console.log('Appended ' + appendedCount + ' profiles to New Leads');
    }

    // ── Step 3b: Append conferenceTag to existing duplicates in BOTH sheets ──

    var tagUpdatedCount = 0;
    if (conferenceTag && duplicateCount > 0) {
      var nlTagUpdated = _appendConferenceTagToExisting(ss, profiles, newLeadsData, 'New Leads', conferenceTag);
      var mlTagUpdated = _appendConferenceTagToExisting(ss, profiles, masterData, 'Master List', conferenceTag);
      tagUpdatedCount = nlTagUpdated + mlTagUpdated;
      console.log('Appended conferenceTag: ' + nlTagUpdated + ' New Leads, ' + mlTagUpdated + ' Master List');
    }

    // ── Step 4: Update connectionFrom to "both" for overlapping profiles ──

    var updatedCount = 0;
    if (profilesToUpdate.length > 0) {
      updatedCount = _batchUpdateConnectionFrom(ss, profilesToUpdate);
      console.log('Updated ' + updatedCount + ' profiles to connectionFrom="both"');
    }

    // ── Step 5: Log top unique profiles for debugging ──

    if (uniqueProfiles.length > 0) {
      console.log('=== Top Unique Profiles (first 5) ===');
      for (var j = 0; j < Math.min(uniqueProfiles.length, 5); j++) {
        var up = uniqueProfiles[j];
        console.log((j + 1) + '. ' + (up.fullName || up.firstName + ' ' + up.lastName) + ' | ' + (up.defaultProfileUrl || 'no url'));
      }
      if (uniqueProfiles.length > 5) console.log('... and ' + (uniqueProfiles.length - 5) + ' more');
    }

    var elapsed = Date.now() - startTime;
    console.log('=== Done in ' + elapsed + 'ms ===');

    return _jsonResponse({
      ok: true,
      profile: currentProfile,
      conferenceTag: conferenceTag,
      stats: {
        phantom: profiles.length,
        unique: uniqueProfiles.length,
        duplicates: duplicateCount,
        noUrl: noUrlCount,
        toUpdate: profilesToUpdate.length,
        appended: appendedCount,
        updated: updatedCount,
        tagUpdated: tagUpdatedCount,
        masterListSize: masterData.count,
        newLeadsSize: newLeadsData.count,
        elapsedMs: elapsed
      }
    });

  } catch (err) {
    console.error('FATAL: ' + err.message + '\n' + err.stack);
    return _jsonResponse({ ok: false, error: err.message, stack: err.stack });
  }
}

// ── Read defaultProfileUrl + connectionFrom from a sheet ──
// Returns { urlMap: { normalizedUrl: { connectionFrom, row } }, count }

function _readDefaultUrlsAndCF(ss, sheetName) {
  var result = { urlMap: {}, count: 0 };
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return result;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return result;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var urlColIdx = headers.indexOf('defaultProfileUrl');
  var cfColIdx = headers.indexOf('connectionFrom');

  if (urlColIdx === -1) {
    console.warn(sheetName + ': defaultProfileUrl column not found');
    return result;
  }

  var dataRows = lastRow - 1;
  var urlData = sheet.getRange(2, urlColIdx + 1, dataRows, 1).getValues();
  var cfData = cfColIdx !== -1
    ? sheet.getRange(2, cfColIdx + 1, dataRows, 1).getValues()
    : null;

  for (var r = 0; r < dataRows; r++) {
    var url = _normalizeUrl(urlData[r][0]);
    if (!url) continue;
    var connectionFrom = cfData ? String(cfData[r][0] || '').trim().toLowerCase() : '';
    result.urlMap[url] = { connectionFrom: connectionFrom, row: r + 2 }; // 1-indexed, skip header
    result.count++;
  }

  return result;
}

// ── Append unique profiles to New Leads, preserving ALL PB fields ──

function _appendToNewLeads(ss, uniqueProfiles, currentProfile, conferenceTag) {
  var sheet = ss.getSheetByName('New Leads');
  if (!sheet) return 0;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Map each profile to a row matching the sheet headers
  var rows = uniqueProfiles.map(function(p) {
    return headers.map(function(header) {
      // Special case: connectionFrom always gets the current profile
      if (header === 'connectionFrom') return currentProfile;
      // Special case: conferenceTags gets the resolved conference tag
      if (header === 'conferenceTags') return conferenceTag || '';
      // Map PB fields to sheet headers (exact match)
      if (p[header] !== undefined && p[header] !== null) return p[header];
      // Try common alias (PB uses camelCase with different casing)
      if (header === 'linkedInProfileUrl' && p.linkedinProfileUrl) return p.linkedinProfileUrl;
      if (header === 'fullName' && !p.fullName) return ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
      return '';
    });
  });

  if (rows.length > 0) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, headers.length).setValues(rows);
    console.log('Appended ' + rows.length + ' rows to New Leads at row ' + (lastRow + 1));
  }

  return rows.length;
}

// ── Batch update connectionFrom to "both" using row numbers ──

function _batchUpdateConnectionFrom(ss, profilesToUpdate) {
  // Group by sheet
  var bySheet = {};
  for (var i = 0; i < profilesToUpdate.length; i++) {
    var item = profilesToUpdate[i];
    var sheetName = item.sheetName || 'New Leads';
    if (!bySheet[sheetName]) bySheet[sheetName] = [];
    bySheet[sheetName].push(item.row);
  }

  var totalUpdated = 0;
  var sheetNames = Object.keys(bySheet);

  for (var s = 0; s < sheetNames.length; s++) {
    var sheetName = sheetNames[s];
    var rows = bySheet[sheetName];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    var sheetHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var cfColIdx = sheetHeaders.indexOf('connectionFrom');
    if (cfColIdx === -1) continue;

    for (var r = 0; r < rows.length; r++) {
      sheet.getRange(rows[r], cfColIdx + 1).setValue('both');
      totalUpdated++;
    }

    console.log('Updated ' + rows.length + ' rows in ' + sheetName + ' to connectionFrom="both"');
  }

  return totalUpdated;
}

// ── Resolve conferenceTag from Conferences tab by matching searchUrl ──

function _resolveConferenceTag(ss, searchUrl) {
  var confSheet = ss.getSheetByName('Conferences');
  if (!confSheet) {
    console.log('Conferences tab not found — no conference tag resolution');
    return '';
  }

  var lastRow = confSheet.getLastRow();
  if (lastRow < 2) return '';

  var headers = confSheet.getRange(1, 1, 1, confSheet.getLastColumn()).getValues()[0];
  // Case-insensitive header lookup to handle any casing (Tag, tag, TAG, etc.)
  var headersLower = headers.map(function(h) { return String(h).trim().toLowerCase(); });
  var tagIdx = headersLower.indexOf('tag');
  var statusIdx = headersLower.indexOf('status');
  var salesNavUrlIdx = headersLower.indexOf('salesnavurl');

  if (tagIdx === -1 || salesNavUrlIdx === -1) {
    console.warn('Conferences tab missing required columns (tag, salesNavUrl). Headers found: ' + JSON.stringify(headers));
    return '';
  }

  var data = confSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var normalizedSearch = searchUrl.trim().toLowerCase();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowUrl = String(row[salesNavUrlIdx] || '').trim().toLowerCase();
    var rowStatus = statusIdx !== -1 ? row[statusIdx] : true;

    // Match searchUrl against salesNavUrl (normalize both, substring match either direction)
    if (rowUrl && (normalizedSearch.indexOf(rowUrl) !== -1 || rowUrl.indexOf(normalizedSearch) !== -1)) {
      var tag = String(row[tagIdx] || '').trim();
      if (tag) {
        console.log('Matched searchUrl to conference: "' + tag + '" (row ' + (i + 2) + ')');
        return tag;
      }
    }
  }

  console.log('No conference match for searchUrl');
  return '';
}

// ── Append conferenceTag to existing profiles in New Leads ──

function _appendConferenceTagToExisting(ss, phantomProfiles, sheetData, sheetName, conferenceTag) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return 0;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var confTagIdx = headers.indexOf('conferenceTags');
  if (confTagIdx === -1) {
    console.log('conferenceTags column not found in ' + sheetName + ' — skipping tag append');
    return 0;
  }

  var updated = 0;
  for (var i = 0; i < phantomProfiles.length; i++) {
    var url = _normalizeUrl(phantomProfiles[i].defaultProfileUrl || '');
    if (!url) continue;

    var match = sheetData.urlMap[url];
    if (!match) continue;

    // Read current conferenceTags value
    var currentTags = String(sheet.getRange(match.row, confTagIdx + 1).getValue() || '').trim();
    var tagList = currentTags ? currentTags.split(',').map(function(t) { return t.trim(); }) : [];

    // Append if not already present
    if (tagList.indexOf(conferenceTag) === -1) {
      tagList.push(conferenceTag);
      sheet.getRange(match.row, confTagIdx + 1).setValue(tagList.join(','));
      updated++;
    }
  }

  return updated;
}

function doGet(e) {
  return _jsonResponse({
    ok: true,
    message: 'Pipeline Results Processor is live',
    usage: 'POST { profiles: [...], profile: "kyle"|"hudson", searchUrl: "..." }'
  });
}

function _normalizeUrl(url) {
  if (!url) return '';
  return String(url).trim().toLowerCase()
    .replace('https://www.linkedin.com', 'https://linkedin.com')
    .replace(/\/+$/, '');
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
