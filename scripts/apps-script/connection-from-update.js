/**
 * Google Apps Script: Batch Update connectionFrom
 *
 * Replaces the Loop Over Items in n8n workflow 4 (Lead Pipeline Monitor).
 * Receives an array of { defaultProfileUrl, _sheet } items and sets
 * connectionFrom = "both" for each matching row in the specified sheet.
 *
 * Deploy: Extensions > Apps Script > Deploy > Web App
 *   - Execute as: Me
 *   - Who has access: Anyone
 *   - Copy the URL into the n8n "Batch Update connectionFrom" node
 *
 * Spreadsheet: 1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8
 *   - Master List (sheet where connectionFrom may be updated)
 *   - New Leads   (sheet where connectionFrom may be updated)
 */

var SPREADSHEET_ID = '1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8';

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var updates = payload.updates;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return _jsonResponse({ ok: false, error: 'Missing or empty updates array' });
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Group updates by sheet name for efficient batch processing
    var bySheet = {};
    for (var i = 0; i < updates.length; i++) {
      var sheetName = updates[i]._sheet || 'New Leads';
      if (!bySheet[sheetName]) bySheet[sheetName] = [];
      bySheet[sheetName].push(updates[i]);
    }

    var totalUpdated = 0;
    var totalNotFound = 0;
    var results = [];

    // Process each sheet
    var sheetNames = Object.keys(bySheet);
    for (var s = 0; s < sheetNames.length; s++) {
      var sheetName = sheetNames[s];
      var sheetUpdates = bySheet[sheetName];
      var sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        // Sheet not found — mark all as not found
        for (var j = 0; j < sheetUpdates.length; j++) {
          results.push({
            url: sheetUpdates[j].defaultProfileUrl,
            sheet: sheetName,
            updated: false,
            error: 'Sheet not found'
          });
          totalNotFound++;
        }
        continue;
      }

      var lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        for (var j = 0; j < sheetUpdates.length; j++) {
          results.push({
            url: sheetUpdates[j].defaultProfileUrl,
            sheet: sheetName,
            updated: false,
            error: 'Sheet is empty'
          });
          totalNotFound++;
        }
        continue;
      }

      // Read headers to find column indices
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var urlColIdx = headers.indexOf('defaultProfileUrl');
      var cfColIdx = headers.indexOf('connectionFrom');

      if (urlColIdx === -1 || cfColIdx === -1) {
        for (var j = 0; j < sheetUpdates.length; j++) {
          results.push({
            url: sheetUpdates[j].defaultProfileUrl,
            sheet: sheetName,
            updated: false,
            error: 'Required column not found (defaultProfileUrl or connectionFrom)'
          });
          totalNotFound++;
        }
        continue;
      }

      // Read all URLs from the sheet for batch matching
      var urlData = sheet.getRange(2, urlColIdx + 1, lastRow - 1, 1).getValues();
      var normalizedSheetUrls = urlData.map(function(row) { return _normalizeUrl(row[0]); });

      // Build a set of URLs to update for fast lookup
      var urlsToUpdate = {};
      for (var j = 0; j < sheetUpdates.length; j++) {
        var normUrl = _normalizeUrl(sheetUpdates[j].defaultProfileUrl);
        if (normUrl) {
          urlsToUpdate[normUrl] = sheetUpdates[j];
        }
      }

      // Find all matching rows and batch-update connectionFrom
      var matchedRows = []; // { row, url }
      for (var r = 0; r < normalizedSheetUrls.length; r++) {
        if (normalizedSheetUrls[r] && urlsToUpdate[normalizedSheetUrls[r]]) {
          var rowNum = r + 2; // +2: 0-indexed array + header row
          matchedRows.push({ row: rowNum, url: normalizedSheetUrls[r] });
          delete urlsToUpdate[normalizedSheetUrls[r]]; // prevent double-counting
        }
      }

      // Batch write: update each matched row's connectionFrom cell
      for (var m = 0; m < matchedRows.length; m++) {
        sheet.getRange(matchedRows[m].row, cfColIdx + 1).setValue('both');
        results.push({
          url: matchedRows[m].url,
          sheet: sheetName,
          updated: true,
          row: matchedRows[m].row
        });
        totalUpdated++;
      }

      // Report any URLs that weren't found in this sheet
      var remaining = Object.keys(urlsToUpdate);
      for (var k = 0; k < remaining.length; k++) {
        results.push({
          url: remaining[k],
          sheet: sheetName,
          updated: false,
          error: 'Row not found'
        });
        totalNotFound++;
      }
    }

    return _jsonResponse({
      ok: true,
      totalRequested: updates.length,
      totalUpdated: totalUpdated,
      totalNotFound: totalNotFound,
      results: results
    });

  } catch (err) {
    return _jsonResponse({ ok: false, error: err.message, stack: err.stack });
  }
}

// GET handler for health check
function doGet(e) {
  return _jsonResponse({
    ok: true,
    message: 'Batch Update connectionFrom endpoint is live',
    usage: 'POST { updates: [{ defaultProfileUrl, _sheet: "Master List"|"New Leads" }] }'
  });
}

// ─── Helpers ───

function _normalizeUrl(url) {
  if (!url) return '';
  return String(url).replace(/^https?:\/\/www\./i, 'https://')
            .replace(/\/+$/, '')
            .toLowerCase()
            .trim();
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
