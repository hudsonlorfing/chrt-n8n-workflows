/**
 * Google Apps Script: Batch Update Master List
 * 
 * Deployed as a Web App to receive POST requests from n8n workflow 2
 * (LinkedIn Outreach) after PhantomBuster processes connection requests.
 * 
 * Endpoint accepts:
 *   POST { profile: "kyle"|"hudson", updates: [{ defaultProfileUrl, status, sentDate }, ...] }
 * 
 * For each update, finds the row by defaultProfileUrl and writes:
 *   - kyleSentDate or hudsonSentDate (based on profile)
 *   - inviteResults (the status string)
 * 
 * Deploy: Extensions > Apps Script > Deploy > Web App
 *   - Execute as: Me
 *   - Who has access: Anyone
 *   - Copy the URL into the n8n "Batch Update Master List" node
 * 
 * Spreadsheet: Master List in 1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8
 */

const SPREADSHEET_ID = '1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8';
const SHEET_NAME = 'Master List';

/**
 * Normalize a LinkedIn profile URL for matching.
 * Strips www., trailing slash, and lowercases.
 * "https://www.linkedin.com/in/john-doe/" -> "https://linkedin.com/in/john-doe"
 */
function _normalizeUrl(url) {
  if (!url) return '';
  return url.replace(/^https?:\/\/www\./i, 'https://')
            .replace(/\/+$/, '')
            .toLowerCase();
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { profile, updates } = payload;

    if (!profile || !updates || !Array.isArray(updates)) {
      return _jsonResponse({ ok: false, error: 'Missing profile or updates array' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return _jsonResponse({ ok: false, error: 'Sheet "' + SHEET_NAME + '" not found' });
    }

    // Read headers once to find column indices
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const urlCol = headers.indexOf('defaultProfileUrl');
    const kyleCol = headers.indexOf('kyleSentDate');
    const hudsonCol = headers.indexOf('hudsonSentDate');
    const resultsCol = headers.indexOf('inviteResults');

    if (urlCol === -1) {
      return _jsonResponse({ ok: false, error: 'Column "defaultProfileUrl" not found in headers' });
    }

    const dateCol = profile === 'kyle' ? kyleCol : hudsonCol;
    if (dateCol === -1) {
      return _jsonResponse({ ok: false, error: 'Date column for profile "' + profile + '" not found' });
    }

    // Pre-read all URLs from the defaultProfileUrl column for normalized matching
    const lastRow = sheet.getLastRow();
    const urlData = sheet.getRange(2, urlCol + 1, lastRow - 1, 1).getValues(); // skip header row
    const normalizedSheetUrls = urlData.map(function(row) { return _normalizeUrl(row[0]); });

    const results = [];
    for (var i = 0; i < updates.length; i++) {
      var upd = updates[i];
      if (!upd.defaultProfileUrl) {
        results.push({ url: '', updated: false, error: 'Empty defaultProfileUrl' });
        continue;
      }

      var normalizedInput = _normalizeUrl(upd.defaultProfileUrl);

      // Find matching row by normalized URL
      var matchIdx = normalizedSheetUrls.indexOf(normalizedInput);
      if (matchIdx !== -1) {
        var row = matchIdx + 2; // +2 because array is 0-based and we skipped header
        // Write the sent date for this profile
        sheet.getRange(row, dateCol + 1).setValue(upd.sentDate || '');
        // Write invite results
        if (resultsCol !== -1) {
          sheet.getRange(row, resultsCol + 1).setValue(upd.status || '');
        }
        results.push({ url: upd.defaultProfileUrl, normalized: normalizedInput, updated: true, row: row });
      } else {
        results.push({ url: upd.defaultProfileUrl, normalized: normalizedInput, updated: false, error: 'Row not found' });
      }
    }

    return _jsonResponse({
      ok: true,
      profile: profile,
      totalUpdates: updates.length,
      successCount: results.filter(function(r) { return r.updated; }).length,
      failCount: results.filter(function(r) { return !r.updated; }).length,
      results: results
    });

  } catch (err) {
    return _jsonResponse({ ok: false, error: err.message, stack: err.stack });
  }
}

// GET handler for health check / testing
function doGet(e) {
  return _jsonResponse({
    ok: true,
    message: 'Batch Update Master List endpoint is live',
    usage: 'POST { profile: "kyle"|"hudson", updates: [{ defaultProfileUrl, status, sentDate }] }'
  });
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
