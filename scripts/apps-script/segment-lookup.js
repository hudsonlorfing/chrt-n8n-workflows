/**
 * Google Apps Script: Segment & Connection Lookup
 *
 * Batch endpoint for n8n workflow 3.3 (Connection Sync → HubSpot).
 * Takes an array of LinkedIn profile URLs and returns their segment
 * values + LinkedIn connection data from the Master List.
 *
 * Request: POST { urls: ["https://linkedin.com/in/johndoe", ...] }
 *
 * Returns:
 *   {
 *     ok: true,
 *     segments: {
 *       "https://linkedin.com/in/johndoe": "Shipper-Healthcare",
 *       ...
 *     },
 *     connections: {
 *       "https://linkedin.com/in/johndoe": ["kyle", "hudson"],
 *       ...
 *     },
 *     found: 42,
 *     notFound: 3,
 *     elapsed_ms: 1234
 *   }
 *
 * The `connections` map lists which team profiles are connected
 * (determined by non-empty *ConnectDate columns in the Master List).
 * Extensible: add a new "{name}ConnectDate" column and it's auto-detected.
 *
 * Deploy: Extensions > Apps Script > Deploy > Web App
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * Spreadsheet: 1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8
 *   - Master List (read only — profileUrl, segment, *ConnectDate columns)
 */

var SPREADSHEET_ID = '1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8';

function doPost(e) {
  var startTime = Date.now();
  try {
    var payload = JSON.parse(e.postData.contents);
    var urls = payload.urls || [];

    console.log('=== Segment Lookup Request ===');
    console.log('URLs to look up: ' + urls.length);

    if (!urls.length) {
      return _jsonResponse({ ok: true, segments: {}, found: 0, notFound: 0, elapsed_ms: Date.now() - startTime });
    }

    // Normalize input URLs for matching
    var normalizedInput = {};
    for (var i = 0; i < urls.length; i++) {
      var norm = _normalizeUrl(urls[i]);
      if (norm) {
        normalizedInput[norm] = urls[i]; // map normalized → original
      }
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Master List');
    if (!sheet) {
      return _jsonResponse({ ok: false, error: 'Master List sheet not found' });
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow < 2) {
      return _jsonResponse({ ok: true, segments: {}, found: 0, notFound: urls.length, elapsed_ms: Date.now() - startTime });
    }

    // Read headers to find column indices
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var urlCol = -1;
    var urlCol2 = -1;
    var segmentCol = -1;
    var connectDateCols = []; // { col: index, name: "kyle" } for any *ConnectDate column

    for (var h = 0; h < headers.length; h++) {
      var header = String(headers[h] || '').trim();
      var headerLower = header.toLowerCase();
      if (headerLower === 'defaultprofileurl') urlCol = h;
      else if (headerLower === 'profileurl') urlCol2 = h;
      else if (headerLower === 'segment') segmentCol = h;
      else if (headerLower.endsWith('connectdate')) {
        // Extract profile name: "kyleConnectDate" → "kyle", "hudsonConnectDate" → "hudson"
        var profileName = header.replace(/ConnectDate$/i, '').toLowerCase();
        if (profileName) {
          connectDateCols.push({ col: h, name: profileName });
        }
      }
    }

    console.log('ConnectDate columns found: ' + connectDateCols.map(function(c) { return c.name; }).join(', '));

    if (segmentCol === -1) {
      return _jsonResponse({ ok: false, error: 'segment column not found in Master List' });
    }
    if (urlCol === -1 && urlCol2 === -1) {
      return _jsonResponse({ ok: false, error: 'No URL column found in Master List' });
    }

    // Read all data at once to avoid multiple getRange calls
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    console.log('Read ' + data.length + ' Master List rows in ' + (Date.now() - startTime) + 'ms');

    // Build segments and connections maps
    var segments = {};
    var connections = {};
    var found = 0;

    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      var rowUrl = '';
      if (urlCol >= 0) rowUrl = _normalizeUrl(String(row[urlCol] || ''));
      if (!rowUrl && urlCol2 >= 0) rowUrl = _normalizeUrl(String(row[urlCol2] || ''));
      if (!rowUrl) continue;

      // Check if this URL is in our lookup set
      if (normalizedInput[rowUrl]) {
        var originalUrl = normalizedInput[rowUrl];
        var segment = String(row[segmentCol] || '').trim();
        if (segment) {
          segments[originalUrl] = segment;
          found++;
        }

        // Check which profiles are connected (non-empty ConnectDate)
        var connectedProfiles = [];
        for (var c = 0; c < connectDateCols.length; c++) {
          var dateVal = row[connectDateCols[c].col];
          if (dateVal && String(dateVal).trim()) {
            connectedProfiles.push(connectDateCols[c].name);
          }
        }
        if (connectedProfiles.length > 0) {
          connections[originalUrl] = connectedProfiles;
        }
      }
    }

    var notFound = urls.length - found;
    console.log('Found: ' + found + ' | Not found: ' + notFound + ' | Connections mapped: ' + Object.keys(connections).length + ' | Elapsed: ' + (Date.now() - startTime) + 'ms');

    return _jsonResponse({
      ok: true,
      segments: segments,
      connections: connections,
      found: found,
      notFound: notFound,
      elapsed_ms: Date.now() - startTime
    });

  } catch (err) {
    console.error('Fatal error: ' + err.message);
    console.error(err.stack);
    return _jsonResponse({ ok: false, error: err.message, elapsed_ms: Date.now() - startTime });
  }
}

// Also support GET for health check
function doGet() {
  return _jsonResponse({ ok: true, service: 'segment-lookup', version: '1.1' });
}

function _normalizeUrl(url) {
  if (!url) return '';
  url = url.trim().toLowerCase();
  // Remove query string and trailing slashes
  url = url.split('?')[0].replace(/\/+$/, '');
  // Ensure consistent format
  if (url.indexOf('linkedin.com/in/') === -1 && url.indexOf('linkedin.com/company/') === -1) return url;
  return url;
}

function _jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
