/**
 * Google Apps Script: Lead Ingestion & ICP Scoring
 *
 * All-in-one endpoint for n8n workflow 1. n8n sends a lightweight
 * payload { processProfile, batchSize } and this script handles
 * everything server-side to keep n8n memory usage minimal:
 *
 *   1. Reads New Leads sheet
 *   2. Reads Master List URLs (profileUrl column only) for deduping
 *   3. Filters New Leads by connectionFrom === processProfile
 *   4. Dedupes against Master List
 *   5. Limits to batchSize
 *   6. Scores each lead via Claude API
 *   7. Batch-appends scored leads to Master List
 *   8. Batch-deletes processed leads from New Leads
 *   9. Returns a result summary
 *
 * Deploy: Extensions > Apps Script > Deploy > Web App
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * Batch cap: 125 (125 × 1.5s = ~188s, within 6-min web app limit)
 *
 * Required Script Property:
 *   DOPPLER_SERVICE_KEY — fetches ANTHROPIC_API_KEY from Doppler at runtime
 *
 * Spreadsheet: 1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8
 *   - Master List (append scored leads, read URLs for dedup)
 *   - New Leads  (read leads, delete processed)
 */

var SPREADSHEET_ID = '1KQ9NPfbFTsPMsC1gZ7BZNMKw9grnczwHtmCG-9Xx7R8';
var CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
var CLAUDE_MAX_TOKENS = 256;
var DELAY_BETWEEN_CALLS_MS = 1500; // 1.5s between Claude calls (~40 RPM)
var MAX_BATCH_SIZE = 125;

// ─── ICP Scoring Prompt ───

var ICP_PROMPT_TEMPLATE = [
  'Score this LinkedIn profile 0-10 for Chrt, a B2B SaaS for time-critical logistics. Return JSON only:',
  '{"score": <0-10>, "segment": "<Shipper-Healthcare|Shipper-Aerospace|Courier|Forwarder|Skip>", "reason": "<one sentence>", "hubspotIndustry": "<HUBSPOT_INDUSTRY_ENUM>"}',
  '',
  'For hubspotIndustry, map the LinkedIn industry to the closest HubSpot enum from the list at the bottom. Example: "Hospital & Health Care" -> "HOSPITAL_HEALTH_CARE", "Aviation & Aerospace" -> "AVIATION_AEROSPACE". Use exact enum values only.',
  '',
  '## ICP CRITERIA',
  '',
  '### SHIPPER-HEALTHCARE (7-10)',
  'Titles: CSCO, Director, VP Supply Chain, VP Lab Ops, Director Logistics/Transportation/Courier Ops, Supply Chain Manager, Director Field Ops, Case Logistics Manager',
  'Companies: Regional health systems, genetics/specialty labs, pharma/biotech, OPOs, tissue/blood banks, med device (surgical kits)',
  'Signals: "logistics" "supply chain" "courier" "specimen" in headline | 200-10K employees | Regional focus',
  '',
  '### SHIPPER-AEROSPACE (7-10)',
  'Titles: VP/SVP Supply Chain, Director, Director AOG Ops, VP Aftermarket/Customer Support, Materials Manager, CPO',
  'Companies: MRO facilities, aircraft component mfg, engine MROs (StandardAero, MTU), airline maintenance',
  'Signals: "AOG" "MRO" "aviation" "aerospace" | Aftermarket focus | Emergency parts',
  '*Avoid: if current role is Airspace, previous roles at Airspace is not an issue',
  '',
  '### COURIER (6-10)',
  'Titles: Owner/CEO/Founder, Director, Operations Manager, Dispatch Manager, Fleet Manager, GM',
  'Companies: Medical couriers, same-day/time-critical, cold chain specialists, regional networks',
  'Signals: "medical courier" "same-day" "cold chain" | 10-500 employees | Owner/operator',
  'Avoid: FedEx/UPS employees, DoorDash/Uber Eats, Amazon DSPs',
  '*Avoid: if current role is Airspace, previous roles at Airspace is not an issue',
  '',
  '### FORWARDER/AGENT (5-8)',
  'Titles: Operations Manager, Station Manager, Logistics Manager, Director, Network Manager',
  'Companies: Freight forwarders, 3PLs with last-mile, same-day logistics specialists',
  '*Avoid: if current role is Airspace, previous roles at Airspace is not an issue',
  '',
  '## SCORING: 10=Perfect fit, 8-9=Excellent, 6-7=Good, 4-5=Marginal, 1-3=Poor, 0=Skip',
  '',
  '## LEAD DATA',
  'Name: {{fullName}}',
  'Title: {{title}}',
  'Title Description: {{titleDescription}}',
  'Company: {{companyName}}',
  'Industry: {{industry}}',
  'Company Location: {{companyLocation}}',
  'Location: {{location}}',
  'Summary: {{summary}}',
  'Duration in Role: {{durationInRole}}',
  'Duration in Company: {{durationInCompany}}',
  'Previous Role: {{pastExperienceCompanyTitle}} @ {{pastExperienceCompanyName}}',
  'Previous Role Duration: {{pastExperienceDuration}}',
  '',
  '## INDUSTRY OPTIONS TO USE EXPLICITLY FROM HUBSPOT',
  'ACCOUNTING, AIRLINES_AVIATION, ALTERNATIVE_DISPUTE_RESOLUTION, ALTERNATIVE_MEDICINE, ANIMATION, APPAREL_FASHION, ARCHITECTURE_PLANNING, ARTS_AND_CRAFTS, AUTOMOTIVE, AVIATION_AEROSPACE, BANKING, BIOTECHNOLOGY, BROADCAST_MEDIA, BUILDING_MATERIALS, BUSINESS_SUPPLIES_AND_EQUIPMENT, CAPITAL_MARKETS, CHEMICALS, CIVIC_SOCIAL_ORGANIZATION, CIVIL_ENGINEERING, COMMERCIAL_REAL_ESTATE, COMPUTER_NETWORK_SECURITY, COMPUTER_GAMES, COMPUTER_HARDWARE, COMPUTER_NETWORKING, COMPUTER_SOFTWARE, INTERNET, CONSTRUCTION, CONSUMER_ELECTRONICS, CONSUMER_GOODS, CONSUMER_SERVICES, COSMETICS, DAIRY, DEFENSE_SPACE, DESIGN, EDUCATION_MANAGEMENT, E_LEARNING, ELECTRICAL_ELECTRONIC_MANUFACTURING, ENTERTAINMENT, ENVIRONMENTAL_SERVICES, EVENTS_SERVICES, EXECUTIVE_OFFICE, FACILITIES_SERVICES, FARMING, FINANCIAL_SERVICES, FINE_ART, FISHERY, FOOD_BEVERAGES, FOOD_PRODUCTION, FUND_RAISING, FURNITURE, GAMBLING_CASINOS, GLASS_CERAMICS_CONCRETE, GOVERNMENT_ADMINISTRATION, GOVERNMENT_RELATIONS, GRAPHIC_DESIGN, HEALTH_WELLNESS_AND_FITNESS, HIGHER_EDUCATION, HOSPITAL_HEALTH_CARE, HOSPITALITY, HUMAN_RESOURCES, IMPORT_AND_EXPORT, INDIVIDUAL_FAMILY_SERVICES, INDUSTRIAL_AUTOMATION, INFORMATION_SERVICES, INFORMATION_TECHNOLOGY_AND_SERVICES, INSURANCE, INTERNATIONAL_AFFAIRS, INTERNATIONAL_TRADE_AND_DEVELOPMENT, INVESTMENT_BANKING, INVESTMENT_MANAGEMENT, JUDICIARY, LAW_ENFORCEMENT, LAW_PRACTICE, LEGAL_SERVICES, LEGISLATIVE_OFFICE, LEISURE_TRAVEL_TOURISM, LIBRARIES, LOGISTICS_AND_SUPPLY_CHAIN, LUXURY_GOODS_JEWELRY, MACHINERY, MANAGEMENT_CONSULTING, MARITIME, MARKET_RESEARCH, MARKETING_AND_ADVERTISING, MECHANICAL_OR_INDUSTRIAL_ENGINEERING, MEDIA_PRODUCTION, MEDICAL_DEVICES, MEDICAL_PRACTICE, MENTAL_HEALTH_CARE, MILITARY, MINING_METALS, MOTION_PICTURES_AND_FILM, MUSEUMS_AND_INSTITUTIONS, MUSIC, NANOTECHNOLOGY, NEWSPAPERS, NON_PROFIT_ORGANIZATION_MANAGEMENT, OIL_ENERGY, ONLINE_MEDIA, OUTSOURCING_OFFSHORING, PACKAGE_FREIGHT_DELIVERY, PACKAGING_AND_CONTAINERS, PAPER_FOREST_PRODUCTS, PERFORMING_ARTS, PHARMACEUTICALS, PHILANTHROPY, PHOTOGRAPHY, PLASTICS, POLITICAL_ORGANIZATION, PRIMARY_SECONDARY_EDUCATION, PRINTING, PROFESSIONAL_TRAINING_COACHING, PROGRAM_DEVELOPMENT, PUBLIC_POLICY, PUBLIC_RELATIONS_AND_COMMUNICATIONS, PUBLIC_SAFETY, PUBLISHING, RAILROAD_MANUFACTURE, RANCHING, REAL_ESTATE, RECREATIONAL_FACILITIES_AND_SERVICES, RELIGIOUS_INSTITUTIONS, RENEWABLES_ENVIRONMENT, RESEARCH, RESTAURANTS, RETAIL, SECURITY_AND_INVESTIGATIONS, SEMICONDUCTORS, SHIPBUILDING, SPORTING_GOODS, SPORTS, STAFFING_AND_RECRUITING, SUPERMARKETS, TELECOMMUNICATIONS, TEXTILES, THINK_TANKS, TOBACCO, TRANSLATION_AND_LOCALIZATION, TRANSPORTATION_TRUCKING_RAILROAD, UTILITIES, VENTURE_CAPITAL_PRIVATE_EQUITY, VETERINARY, WAREHOUSING, WHOLESALE, WINE_AND_SPIRITS, WIRELESS, WRITING_AND_EDITING, MOBILE_GAMES'
].join('\n');

// ─── Main handler ───

function doPost(e) {
  var startTime = Date.now();
  try {
    var payload = JSON.parse(e.postData.contents);
    var processProfile = payload.processProfile || '';
    var batchSize = Math.min(parseInt(payload.batchSize) || 25, MAX_BATCH_SIZE);

    console.log('=== Lead Ingestion Request ===');
    console.log('processProfile: ' + processProfile + ' | batchSize: ' + batchSize);

    if (!processProfile) {
      console.error('Missing processProfile');
      return _jsonResponse({ ok: false, error: 'Missing processProfile (kyle or hudson)' });
    }

    var apiKey = _getAnthropicKey();
    if (!apiKey) {
      console.error('Failed to get Anthropic key from Doppler');
      return _jsonResponse({ ok: false, error: 'Failed to retrieve ANTHROPIC_API_KEY from Doppler' });
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var masterSheet = ss.getSheetByName('Master List');
    var newLeadsSheet = ss.getSheetByName('New Leads');

    if (!masterSheet || !newLeadsSheet) {
      console.error('Sheet not found — Master List: ' + !!masterSheet + ', New Leads: ' + !!newLeadsSheet);
      return _jsonResponse({ ok: false, error: 'Master List or New Leads sheet not found' });
    }

    // ── Step 1: Read Master List defaultProfileUrl for deduping ──

    var masterHeaders = masterSheet.getRange(1, 1, 1, masterSheet.getLastColumn()).getValues()[0];
    var masterCfColIdx = masterHeaders.indexOf('connectionFrom');
    var masterUrls = {};

    console.log('Master List headers (' + masterHeaders.length + ' cols): ' + masterHeaders.join(', '));
    console.log('Master List connectionFrom column index: ' + masterCfColIdx);

    var masterDefaultUrlColIdx = masterHeaders.indexOf('defaultProfileUrl');
    console.log('Master dedup column: defaultProfileUrl=' + masterDefaultUrlColIdx);

    var masterLastRow = masterSheet.getLastRow();
    if (masterLastRow > 1 && masterDefaultUrlColIdx !== -1) {
      var dataRows = masterLastRow - 1;
      var urlData = masterSheet.getRange(2, masterDefaultUrlColIdx + 1, dataRows, 1).getValues();
      for (var u = 0; u < dataRows; u++) {
        var normalizedUrl = _normalizeUrl(urlData[u][0]);
        if (normalizedUrl) masterUrls[normalizedUrl] = true;
      }
      console.log('Master List defaultProfileUrls loaded for dedup: ' + Object.keys(masterUrls).length);
    }

    // ── Step 1b: Check for active conferences ──

    var confResult = _readAndManageConferences(ss);
    var activeConferences = confResult.active;
    var conferenceMode = activeConferences.length > 0;
    var activeConferenceTags = {};

    if (conferenceMode) {
      console.log('CONFERENCE MODE: ' + activeConferences.length + ' active conference(s)');
      for (var ci = 0; ci < activeConferences.length; ci++) {
        activeConferenceTags[activeConferences[ci].tag.toLowerCase()] = true;
      }
      console.log('Active tags: ' + Object.keys(activeConferenceTags).join(', '));
    } else {
      console.log('NORMAL MODE: no active conferences');
    }

    // ── Step 2: Read New Leads, filter by profile, dedupe ──

    var newLeadsLastRow = newLeadsSheet.getLastRow();
    if (newLeadsLastRow < 2) {
      console.log('New Leads is empty — nothing to process');
      return _jsonResponse({ ok: true, processed: 0, appended: 0, deleted: 0, aiErrors: 0, errors: [], message: 'No new leads in sheet' });
    }

    var newLeadsHeaders = newLeadsSheet.getRange(1, 1, 1, newLeadsSheet.getLastColumn()).getValues()[0];
    var newLeadsData = newLeadsSheet.getRange(2, 1, newLeadsLastRow - 1, newLeadsHeaders.length).getValues();

    console.log('New Leads: ' + newLeadsData.length + ' rows, headers: ' + newLeadsHeaders.join(', '));

    // Build lead objects from rows
    var connectionFromIdx = newLeadsHeaders.indexOf('connectionFrom');
    var defaultUrlIdx = newLeadsHeaders.indexOf('defaultProfileUrl');
    var conferenceTagsIdx = newLeadsHeaders.indexOf('conferenceTags');

    console.log('New Leads connectionFrom col index: ' + connectionFromIdx);
    console.log('New Leads defaultProfileUrl col index: ' + defaultUrlIdx);
    console.log('New Leads conferenceTags col index: ' + conferenceTagsIdx);

    var filteredLeads = [];
    var skipped = { wrongProfile: 0, duplicate: 0, noUrl: 0, confBypass: 0 };

    for (var r = 0; r < newLeadsData.length; r++) {
      var row = newLeadsData[r];

      // Build a lead object from the row
      var lead = {};
      for (var c = 0; c < newLeadsHeaders.length; c++) {
        lead[newLeadsHeaders[c]] = row[c];
      }
      lead._sheetRow = r + 2; // 1-indexed, skip header

      // Check if lead has an active conference tag
      var hasActiveConfTag = false;
      if (conferenceMode && conferenceTagsIdx !== -1) {
        var leadTags = String(row[conferenceTagsIdx] || '').toLowerCase().split(',').map(function(t) { return t.trim(); });
        hasActiveConfTag = leadTags.some(function(t) { return t && activeConferenceTags[t]; });
      }
      lead._isConferenceTarget = hasActiveConfTag;

      // Filter by connectionFrom — must match processProfile or be "both"
      // Conference bypass: conference-tagged leads skip this filter (any profile can ingest them)
      var connectionFrom = (connectionFromIdx !== -1) ? String(row[connectionFromIdx]).trim().toLowerCase() : '';
      if (!hasActiveConfTag && connectionFrom !== processProfile && connectionFrom !== 'both') {
        skipped.wrongProfile++;
        continue;
      }
      if (hasActiveConfTag && connectionFrom !== processProfile && connectionFrom !== 'both') {
        skipped.confBypass++;
      }

      // Dedupe against Master List using defaultProfileUrl
      var leadUrl = _normalizeUrl(defaultUrlIdx !== -1 ? row[defaultUrlIdx] : '');
      if (!leadUrl) { skipped.noUrl++; continue; }
      if (masterUrls[leadUrl]) { skipped.duplicate++; continue; }

      filteredLeads.push(lead);
    }

    // ── Step 2b: Prioritize conference-tagged leads, then slice to batchSize ──

    var confLeads = filteredLeads.filter(function(l) { return l._isConferenceTarget; });
    var normalLeads = filteredLeads.filter(function(l) { return !l._isConferenceTarget; });

    if (conferenceMode) {
      console.log('Conference prioritization: ' + confLeads.length + ' conference leads FIRST, ' + normalLeads.length + ' normal leads after');
    }

    // Conference leads first, then normal — slice to batchSize
    filteredLeads = confLeads.concat(normalLeads).slice(0, batchSize);

    console.log('=== Filter Results ===');
    console.log('Batch: ' + filteredLeads.length + ' (conf: ' + confLeads.length + ', normal: ' + Math.max(0, filteredLeads.length - confLeads.length) + ')');
    console.log('Skipped — wrongProfile: ' + skipped.wrongProfile + ' | duplicate: ' + skipped.duplicate + ' | noUrl: ' + skipped.noUrl + ' | confBypass: ' + skipped.confBypass);

    if (filteredLeads.length > 0) {
      // Log first lead's connectionFrom to verify it's captured
      var sampleLead = filteredLeads[0];
      console.log('Sample lead connectionFrom: "' + (sampleLead.connectionFrom || '') + '" | name: ' + (sampleLead.fullName || sampleLead.firstName || 'N/A'));
    }

    if (filteredLeads.length === 0) {
      console.log('No unique leads for profile: ' + processProfile);
      return _jsonResponse({ ok: true, processed: 0, appended: 0, deleted: 0, aiErrors: 0, errors: [], message: 'No unique leads for profile: ' + processProfile });
    }

    // ── Step 3: Score each lead via Claude ──

    var scoredRows = [];
    var errors = [];
    var today = new Date().toISOString().split('T')[0];

    for (var i = 0; i < filteredLeads.length; i++) {
      var lead = filteredLeads[i];
      try {
        var aiResult = _scoreLead(apiKey, lead);
        var formattedRow = _formatRow(lead, aiResult, today);
        scoredRows.push(formattedRow);
      } catch (err) {
        errors.push({
          url: lead.defaultProfileUrl || lead.linkedInProfileUrl || '',
          error: err.message
        });
        var fallback = { score: 5, segment: 'Unknown', reason: 'AI scoring failed: ' + err.message, hubspotIndustry: '' };
        scoredRows.push(_formatRow(lead, fallback, today));
      }

      // Rate-limit guard
      if (i < filteredLeads.length - 1) {
        Utilities.sleep(DELAY_BETWEEN_CALLS_MS);
      }
    }

    // ── Step 4: Batch append to Master List ──

    // Log what _formatRow produced for connectionFrom
    if (scoredRows.length > 0) {
      var sampleRow = scoredRows[0];
      console.log('=== Append Debug ===');
      console.log('Sample scored row connectionFrom: "' + (sampleRow.connectionFrom || '(EMPTY)') + '"');
      console.log('connectionFrom in masterHeaders: ' + (masterHeaders.indexOf('connectionFrom') !== -1));
      console.log('connectionFrom column index in Master: ' + masterHeaders.indexOf('connectionFrom'));

      // Check for any keys in _formatRow that DON'T match a masterHeader
      var formatKeys = Object.keys(sampleRow);
      var unmapped = formatKeys.filter(function(k) { return masterHeaders.indexOf(k) === -1; });
      if (unmapped.length > 0) {
        console.warn('Keys in _formatRow NOT in masterHeaders: ' + unmapped.join(', '));
      }

      // Check for masterHeaders that have no matching _formatRow key
      var missingInFormat = masterHeaders.filter(function(h) { return sampleRow[h] === undefined; });
      if (missingInFormat.length > 0) {
        console.warn('masterHeaders with no _formatRow value (will be empty): ' + missingInFormat.join(', '));
      }
    }

    var appendData = scoredRows.map(function(row) {
      return masterHeaders.map(function(header) {
        return row[header] !== undefined ? row[header] : '';
      });
    });

    if (appendData.length > 0) {
      // Log the actual connectionFrom value being written
      var cfIdx = masterHeaders.indexOf('connectionFrom');
      if (cfIdx !== -1 && appendData[0]) {
        console.log('Actual connectionFrom value in first append row: "' + appendData[0][cfIdx] + '"');
      }
      var lastRow = masterSheet.getLastRow();
      masterSheet.getRange(lastRow + 1, 1, appendData.length, masterHeaders.length).setValues(appendData);
      console.log('Appended ' + appendData.length + ' rows to Master List at row ' + (lastRow + 1));
    }

    // ── Step 5: Batch delete processed leads from New Leads ──

    var deletedCount = _batchDeleteFromNewLeads(newLeadsSheet, scoredRows);

    // ── Return results ──

    var results = scoredRows.map(function(row) {
      return {
        url: row['defaultProfileUrl'] || row['profileUrl'] || '',
        fullName: row['fullName'] || '',
        score: row['score'],
        segment: row['segment'],
        status: 'appended'
      };
    });

    var elapsed = Date.now() - startTime;
    console.log('=== Done in ' + elapsed + 'ms — processed: ' + filteredLeads.length + ', appended: ' + scoredRows.length + ', deleted: ' + deletedCount + ' ===');

    return _jsonResponse({
      ok: true,
      processProfile: processProfile,
      processed: filteredLeads.length,
      appended: scoredRows.length,
      deleted: deletedCount,
      aiErrors: errors.length,
      errors: errors,
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
    message: 'Lead Ingestion & ICP Scoring endpoint is live',
    usage: 'POST { processProfile: "kyle"|"hudson", batchSize: 125 }'
  });
}

// ─── Claude API call ───

function _scoreLead(apiKey, lead) {
  var prompt = ICP_PROMPT_TEMPLATE
    .replace('{{fullName}}', lead.fullName || 'Unknown')
    .replace('{{title}}', lead.title || 'Unknown')
    .replace('{{titleDescription}}', lead.titleDescription || 'N/A')
    .replace('{{companyName}}', lead.companyName || 'Unknown')
    .replace('{{industry}}', lead.industry || 'Unknown')
    .replace('{{companyLocation}}', lead.companyLocation || 'N/A')
    .replace('{{location}}', lead.location || 'N/A')
    .replace('{{summary}}', lead.summary || 'N/A')
    .replace('{{durationInRole}}', lead.durationInRole || 'N/A')
    .replace('{{durationInCompany}}', lead.durationInCompany || 'N/A')
    .replace('{{pastExperienceCompanyTitle}}', lead.pastExperienceCompanyTitle || 'N/A')
    .replace('{{pastExperienceCompanyName}}', lead.pastExperienceCompanyName || 'N/A')
    .replace('{{pastExperienceDuration}}', lead.pastExperienceDuration || 'N/A');

  var requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  var code = response.getResponseCode();

  if (code === 429) {
    Utilities.sleep(5000);
    response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    code = response.getResponseCode();
  }

  if (code !== 200) {
    throw new Error('Claude API returned ' + code + ': ' + response.getContentText().substring(0, 300));
  }

  var body = JSON.parse(response.getContentText());
  var text = (body.content && body.content[0] && body.content[0].text) || '{}';

  // Strip markdown fences if present
  text = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();

  var parsed = JSON.parse(text);
  return {
    score: parsed.score !== undefined ? parsed.score : 5,
    segment: parsed.segment || 'Unknown',
    reason: parsed.reason || 'No reason provided',
    hubspotIndustry: parsed.hubspotIndustry || ''
  };
}

// ─── Format a lead + AI result into a Master List row object ───

function _formatRow(lead, aiResult, today) {
  return {
    defaultProfileUrl: lead.defaultProfileUrl || lead.linkedInProfileUrl || '',
    profileUrl: lead.defaultProfileUrl || lead.linkedInProfileUrl || '',
    fullName: lead.fullName || ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim(),
    firstName: lead.firstName || '',
    lastName: lead.lastName || '',
    school: '',
    schoolDegree: '',
    company: lead.companyName || '',
    companyUrl: lead.companyUrl || lead.regularCompanyUrl || '',
    companyId: lead.companyId || '',
    jobTitle: lead.title || '',
    jobDateRange: lead.durationInRole || '',
    'adj industry': aiResult.hubspotIndustry || '',
    headline: lead.titleDescription || lead.title || '',
    location: lead.location || '',
    company2: lead.pastExperienceCompanyName || '',
    companyUrl2: lead.pastExperienceCompanyUrl || lead.companyUrl2 || '',
    companyId2: '',
    jobTitle2: lead.pastExperienceCompanyTitle || '',
    jobDateRange2: lead.pastExperienceDate || '',
    score: aiResult.score,
    segment: aiResult.segment,
    reason: aiResult.reason,
    status: aiResult.score >= 6 ? 'Ready' : 'Low Priority',
    added: today,
    kyleSentDate: '',
    kyleConnectDate: '',
    hudsonSentDate: '',
    hudsonConnectDate: '',
    hubspotSync: '',
    hudsonNotes: '',
    inviteResults: '',
    conferenceTags: lead.conferenceTags || '',
    connectionFrom: lead.connectionFrom || '',
    connectionDegree: lead.connectionDegree || '',
    previousRole: lead.pastExperienceCompanyTitle
      ? (lead.pastExperienceCompanyTitle + ' @ ' + (lead.pastExperienceCompanyName || ''))
      : '',
    industry: lead.industry || '',
    summary: lead.summary || '',
    companyLocation: lead.companyLocation || '',
    durationInCompany: lead.durationInCompany || '',
    pastExperienceDuration: lead.pastExperienceDuration || '',
    sharedConnectionsCount: lead.sharedConnectionsCount || '',
    isPremium: lead.isPremium || false,
    isOpenLink: lead.isOpenLink || false
  };
}

// ─── Batch delete processed leads from New Leads ───

function _batchDeleteFromNewLeads(sheet, scoredRows) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var urlColIdx = headers.indexOf('defaultProfileUrl');
  if (urlColIdx === -1) return 0;

  var urlData = sheet.getRange(2, urlColIdx + 1, lastRow - 1, 1).getValues();

  var processedUrls = {};
  for (var i = 0; i < scoredRows.length; i++) {
    var url = _normalizeUrl(scoredRows[i].defaultProfileUrl || scoredRows[i].profileUrl || '');
    if (url) processedUrls[url] = true;
  }

  var rowsToDelete = [];
  for (var j = 0; j < urlData.length; j++) {
    var sheetUrl = _normalizeUrl(urlData[j][0]);
    if (sheetUrl && processedUrls[sheetUrl]) {
      rowsToDelete.push(j + 2);
    }
  }

  // Delete from bottom to top
  rowsToDelete.sort(function(a, b) { return b - a; });
  for (var k = 0; k < rowsToDelete.length; k++) {
    sheet.deleteRow(rowsToDelete[k]);
  }

  return rowsToDelete.length;
}

// ─── Conference Management ───

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
    console.warn('Conferences tab missing required columns (tag, status). Headers: ' + JSON.stringify(headers));
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
    result.active.push(conf);
    console.log('Active conference: "' + conf.name + '" tag=' + conf.tag);
  }

  return result;
}

// ─── Helpers ───

function _normalizeUrl(url) {
  if (!url) return '';
  return String(url).replace(/^https?:\/\/www\./i, 'https://')
            .replace(/\/+$/, '')
            .toLowerCase();
}

// ─── Doppler: fetch ANTHROPIC_API_KEY at runtime ───

function _getAnthropicKey() {
  var token = PropertiesService.getScriptProperties().getProperty('DOPPLER_SERVICE_KEY');
  if (!token) {
    throw new Error('DOPPLER_SERVICE_KEY not set in Script Properties');
  }

  var resp = UrlFetchApp.fetch(
    'https://api.doppler.com/v3/configs/config/secret?name=ANTHROPIC_API_KEY',
    {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    }
  );

  if (resp.getResponseCode() !== 200) {
    throw new Error('Doppler fetch failed (' + resp.getResponseCode() + '): ' + resp.getContentText().substring(0, 200));
  }

  var body = JSON.parse(resp.getContentText());
  return body.value.computed;
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
