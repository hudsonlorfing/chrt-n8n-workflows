/**
 * HoldingSheet Writer — Apps Script Web App
 *
 * Accepts POST requests with LinkedIn profile URLs and writes them to
 * the HoldingSheet that PhantomBuster reads from.
 *
 * POST payload:
 *   { "urls": ["https://linkedin.com/in/...", ...] }
 *
 * Actions:
 *   1. Clears all existing data from Sheet1 (except header)
 *   2. Writes new URLs to column A (with header "linkedInProfileUrl")
 *   3. Returns count of URLs written
 *
 * Deploy: Extensions > Apps Script > Deploy > Web App
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * Spreadsheet: 1xPgob7BwDoDGAOtDPBTvKzhQHl2FUZkJhJG0gEHWdgo (HoldingSheet)
 */

var SPREADSHEET_ID = '1xPgob7BwDoDGAOtDPBTvKzhQHl2FUZkJhJG0gEHWdgo';
var SHEET_NAME = 'Sheet1';

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var urls = payload.urls || [];

    if (!urls.length) {
      return _jsonResponse({ ok: false, error: 'No URLs provided' });
    }

    console.log('Writing ' + urls.length + ' URLs to HoldingSheet');

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return _jsonResponse({ ok: false, error: 'Sheet not found: ' + SHEET_NAME });
    }

    // Clear all existing data
    sheet.clearContents();

    // Write header + URLs
    var data = [['linkedInProfileUrl']];
    for (var i = 0; i < urls.length; i++) {
      data.push([urls[i]]);
    }

    sheet.getRange(1, 1, data.length, 1).setValues(data);

    console.log('Successfully wrote ' + urls.length + ' URLs');

    return _jsonResponse({
      ok: true,
      count: urls.length,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID
    });

  } catch (err) {
    console.error('Error: ' + err.message);
    return _jsonResponse({ ok: false, error: err.message });
  }
}

function doGet(e) {
  // GET returns current sheet contents for debugging
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    var lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return _jsonResponse({ ok: true, count: 0, urls: [] });
    }

    var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var urls = data.map(function(row) { return row[0]; }).filter(Boolean);

    return _jsonResponse({ ok: true, count: urls.length, urls: urls });
  } catch (err) {
    return _jsonResponse({ ok: false, error: err.message });
  }
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
