/**
 * Google Apps Script: Conference Target Checker
 *
 * Lightweight endpoint for n8n workflow 3.4 (Conference Follow-Up).
 * Takes a LinkedIn profile URL and checks if the person is tagged
 * for an active conference in the Master List.
 *
 * Request: POST { linkedinUrl: "https://linkedin.com/in/..." }
 *
 * Response: {
 *   isConferenceTarget: true/false,
 *   conferenceName: "AirCargo Conference 2026",
 *   conferenceTag: "airCargo26"
 * }
 *
 * Logic:
 *   1. Reads Master List: finds row matching defaultProfileUrl
 *   2. Reads conferenceTags from that row
 *   3. Reads Conferences tab: finds active conferences (status=TRUE, today <= end)
 *   4. Returns match info if conferenceTags overlap with active conferences
 *
 * Deploy: Extensions > Apps Script > Deploy > Web App
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * Spreadsheet: 1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8
 *   - Master List  (read defaultProfileUrl + conferenceTags)
 *   - Conferences   (read active conferences)
 */

var SPREADSHEET_ID = '1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8';

function doPost(e) {
  var startTime = Date.now();
  try {
    var payload = JSON.parse(e.postData.contents);
    var linkedinUrl = (payload.linkedinUrl || '').trim();

    console.log('=== Conference Check ===');
    console.log('LinkedIn URL: ' + linkedinUrl);

    if (!linkedinUrl) {
      return _jsonResponse({ ok: false, error: 'Missing linkedinUrl' });
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // ── Step 1: Find the profile in Master List ──

    var masterSheet = ss.getSheetByName('Master List');
    if (!masterSheet) {
      return _jsonResponse({ ok: false, error: 'Master List not found' });
    }

    var lastRow = masterSheet.getLastRow();
    if (lastRow < 2) {
      return _jsonResponse({ ok: true, isConferenceTarget: false, reason: 'Master List empty' });
    }

    var headers = masterSheet.getRange(1, 1, 1, masterSheet.getLastColumn()).getValues()[0];
    var urlColIdx = headers.indexOf('defaultProfileUrl');
    var confTagColIdx = headers.indexOf('conferenceTags');

    if (urlColIdx === -1) {
      return _jsonResponse({ ok: false, error: 'defaultProfileUrl column not found' });
    }
    if (confTagColIdx === -1) {
      return _jsonResponse({ ok: true, isConferenceTarget: false, reason: 'conferenceTags column not found' });
    }

    // Read only the two columns we need (efficient)
    var dataRows = lastRow - 1;
    var urlData = masterSheet.getRange(2, urlColIdx + 1, dataRows, 1).getValues();
    var tagData = masterSheet.getRange(2, confTagColIdx + 1, dataRows, 1).getValues();

    var normalizedInput = _normalizeUrl(linkedinUrl);
    var conferenceTags = '';

    for (var r = 0; r < dataRows; r++) {
      var rowUrl = _normalizeUrl(urlData[r][0]);
      if (rowUrl && rowUrl === normalizedInput) {
        conferenceTags = String(tagData[r][0] || '').trim();
        break;
      }
    }

    if (!conferenceTags) {
      console.log('No conference tags found for URL');
      return _jsonResponse({
        ok: true,
        isConferenceTarget: false,
        reason: 'No conferenceTags on profile'
      });
    }

    console.log('Found conferenceTags: ' + conferenceTags);

    // ── Step 2: Read active conferences ──

    var confSheet = ss.getSheetByName('Conferences');
    if (!confSheet) {
      return _jsonResponse({ ok: true, isConferenceTarget: false, reason: 'Conferences tab not found' });
    }

    var confLastRow = confSheet.getLastRow();
    if (confLastRow < 2) {
      return _jsonResponse({ ok: true, isConferenceTarget: false, reason: 'Conferences tab empty' });
    }

    var confHeaders = confSheet.getRange(1, 1, 1, confSheet.getLastColumn()).getValues()[0];
    // Case-insensitive header lookup
    var confHeadersLower = confHeaders.map(function(h) { return String(h).trim().toLowerCase(); });
    var nameIdx = confHeadersLower.indexOf('name');
    var tagIdx = confHeadersLower.indexOf('tag');
    var statusIdx = confHeadersLower.indexOf('status');
    var endIdx = confHeadersLower.indexOf('end');

    if (tagIdx === -1 || statusIdx === -1) {
      return _jsonResponse({ ok: true, isConferenceTarget: false, reason: 'Conferences tab missing columns' });
    }

    var confData = confSheet.getRange(2, 1, confLastRow - 1, confHeaders.length).getValues();
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var profileTags = conferenceTags.split(',').map(function(t) { return t.trim().toLowerCase(); });

    for (var i = 0; i < confData.length; i++) {
      var row = confData[i];
      var status = row[statusIdx];
      if (status !== true && String(status).toUpperCase() !== 'TRUE') continue;

      var tag = String(row[tagIdx] || '').trim().toLowerCase();
      if (!tag) continue;

      // Check if conference has ended
      var endDate = endIdx !== -1 ? new Date(row[endIdx]) : null;
      if (endDate && !isNaN(endDate.getTime())) {
        endDate.setHours(23, 59, 59, 999);
        if (today > endDate) continue; // expired
      }

      // Check if profile is tagged for this active conference
      if (profileTags.indexOf(tag) !== -1) {
        var confName = nameIdx !== -1 ? String(row[nameIdx] || '').trim() : tag;
        var elapsed = Date.now() - startTime;
        console.log('Match found: ' + confName + ' (' + tag + ') in ' + elapsed + 'ms');

        return _jsonResponse({
          ok: true,
          isConferenceTarget: true,
          conferenceName: confName,
          conferenceTag: tag
        });
      }
    }

    // Profile has conference tags but none match an active conference
    var elapsed = Date.now() - startTime;
    console.log('No active conference match in ' + elapsed + 'ms');

    return _jsonResponse({
      ok: true,
      isConferenceTarget: false,
      reason: 'Profile tagged but no matching active conference'
    });

  } catch (err) {
    console.error('FATAL: ' + err.message + '\n' + err.stack);
    return _jsonResponse({ ok: false, error: err.message, stack: err.stack });
  }
}

function doGet(e) {
  return _jsonResponse({
    ok: true,
    message: 'Conference Target Checker is live',
    usage: 'POST { linkedinUrl: "https://linkedin.com/in/..." }'
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
