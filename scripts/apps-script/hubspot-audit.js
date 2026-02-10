/**
 * Google Apps Script: HubSpot Sync Audit
 *
 * Reads the Master List and identifies connected profiles that haven't
 * been synced to HubSpot yet. Returns full profile data including
 * location fields for conference outreach targeting.
 *
 * GET  — returns audit summary + unsynced profiles
 * POST — same, but accepts { includeAll: true } to also return synced profiles
 *
 * Spreadsheet: 1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8
 */

var SPREADSHEET_ID = '1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8';

function doGet(e) {
  var includeAll = (e && e.parameter && e.parameter.includeAll === 'true');
  return _runAudit(includeAll);
}

function doPost(e) {
  var payload = {};
  try { payload = JSON.parse(e.postData.contents); } catch (err) {}
  return _runAudit(payload.includeAll || false);
}

function _runAudit(includeAll) {
  var startTime = Date.now();
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Master List');
    if (!sheet) return _jsonResponse({ ok: false, error: 'Master List sheet not found' });

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return _jsonResponse({ ok: false, error: 'Master List is empty' });

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    // Column indices
    var col = {};
    var needed = [
      'defaultProfileUrl', 'fullName', 'firstName', 'lastName',
      'company', 'jobTitle', 'location', 'companyLocation',
      'industry', 'adj industry', 'score', 'segment',
      'kyleSentDate', 'kyleConnectDate', 'hudsonSentDate', 'hudsonConnectDate',
      'hubspotSync', 'connectionFrom', 'summary', 'headline'
    ];
    for (var i = 0; i < headers.length; i++) {
      if (needed.indexOf(headers[i]) !== -1) col[headers[i]] = i;
    }

    console.log('=== HubSpot Audit ===');
    console.log('Master List rows: ' + data.length);
    console.log('Columns found: ' + Object.keys(col).join(', '));

    var connected = [];
    var unsynced = [];
    var synced = [];
    var totalRows = data.length;

    for (var r = 0; r < data.length; r++) {
      var row = data[r];

      var kyleConnect = _str(row, col.kyleConnectDate);
      var hudsonConnect = _str(row, col.hudsonConnectDate);

      // Skip if not connected by either profile
      if (!kyleConnect && !hudsonConnect) continue;

      var profile = {
        row: r + 2,
        defaultProfileUrl: _str(row, col.defaultProfileUrl),
        fullName: _str(row, col.fullName),
        firstName: _str(row, col.firstName),
        lastName: _str(row, col.lastName),
        company: _str(row, col.company),
        jobTitle: _str(row, col.jobTitle),
        location: _str(row, col.location),
        companyLocation: _str(row, col.companyLocation),
        // Resolve best location: prefer person location, fall back to company location
        bestLocation: _str(row, col.location) || _str(row, col.companyLocation) || '',
        industry: _str(row, col.industry),
        adjIndustry: _str(row, col['adj industry']),
        score: _str(row, col.score),
        segment: _str(row, col.segment),
        headline: _str(row, col.headline),
        summary: _str(row, col.summary),
        kyleSentDate: _str(row, col.kyleSentDate),
        kyleConnectDate: kyleConnect,
        hudsonSentDate: _str(row, col.hudsonSentDate),
        hudsonConnectDate: hudsonConnect,
        hubspotSync: _str(row, col.hubspotSync),
        connectionFrom: _str(row, col.connectionFrom),
        connectedBy: (kyleConnect ? 'kyle' : '') + (kyleConnect && hudsonConnect ? '+' : '') + (hudsonConnect ? 'hudson' : '')
      };

      connected.push(profile);

      if (!profile.hubspotSync) {
        unsynced.push(profile);
      } else {
        synced.push(profile);
      }
    }

    // Location breakdown for unsynced profiles
    var locationCounts = {};
    var noLocationCount = 0;
    for (var u = 0; u < unsynced.length; u++) {
      var loc = unsynced[u].bestLocation;
      if (!loc) {
        noLocationCount++;
        continue;
      }
      // Extract state/region (last two parts typically: "City, State, Country")
      var parts = loc.split(',').map(function(s) { return s.trim(); });
      var region = parts.length >= 2 ? parts[parts.length - 2] : loc;
      locationCounts[region] = (locationCounts[region] || 0) + 1;
    }

    // Sort regions by count
    var topRegions = Object.keys(locationCounts).map(function(k) {
      return { region: k, count: locationCounts[k] };
    }).sort(function(a, b) { return b.count - a.count; });

    var elapsed = Date.now() - startTime;
    console.log('Connected: ' + connected.length + ' | Synced: ' + synced.length + ' | Unsynced: ' + unsynced.length);
    console.log('Done in ' + elapsed + 'ms');

    var response = {
      ok: true,
      summary: {
        totalMasterList: totalRows,
        connected: connected.length,
        synced: synced.length,
        unsynced: unsynced.length,
        unsyncedWithLocation: unsynced.length - noLocationCount,
        unsyncedNoLocation: noLocationCount,
        topRegions: topRegions.slice(0, 20),
        elapsedMs: elapsed
      },
      unsyncedProfiles: unsynced
    };

    if (includeAll) {
      response.syncedProfiles = synced;
    }

    return _jsonResponse(response);

  } catch (err) {
    console.error('FATAL: ' + err.message + '\n' + err.stack);
    return _jsonResponse({ ok: false, error: err.message });
  }
}

function _str(row, colIdx) {
  if (colIdx === undefined || colIdx === null) return '';
  return String(row[colIdx] || '').trim();
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
