# PhantomBuster agent IDs (LinkedIn)

**Rule: one item per launch.** Any node that feeds a PhantomBuster (or phantom) launch must output a **single item**. n8n runs the launch node once per input item, so N items cause N launches (first often succeeds, second often errors). Use a Limit (1) or a Code node that returns `[$input.first()]` before the launch node. See also `.cursor/rules/n8n.mdc` (PhantomBuster / phantom launch nodes).

| Phantom | Agent ID | Purpose |
|---------|----------|---------|
| Kyle Connections Export | `959265651312489` | Connection Sync → HubSpot (kyleConnectionExport2) |
| hudsonConnectExport | *(set after Phase 2)* | Connections Export for Hudson; can override with bonusArgument for Kyle |
| Profile Scraper (email) | `3627182471241497` | Connection Sync → HubSpot (Launch Profile Scraper with Email) |
| Search Export (Kyle) | `4606663815675720` | Lead Pipeline Monitor |
| Search Export (Hudson) | `2368687890019633` | Lead Pipeline Monitor (profile sets `exportPhantom` in Take one profile) |
| Send connection (Autoconnect) | `3044757503240384` | LinkedIn Outreach (2) — reads from **holding sheet** |

### Holding sheet (LinkedIn Outreach workflow 2)

The Send connection phantom uses **spreadsheet input** so dynamics are clearly separated: one Google Sheet is the single source of leads to connect.

- **Holding sheet** — HoldingSheet doc `1xPgob7BwDoDGAOtDPBTvKzhQHl2FUZkJhJG0gEHWdgo`, **Sheet2** (gid=2051829261). Workflow appends `defaultProfileUrl` values to Sheet2 before launching PB, then clears Sheet2 after the run completes.
- **Launch payload** (one launch per run): `inputType: "spreadsheetUrl"`, `spreadsheetUrl` pointing at Sheet2, `numberOfAddsPerLaunch` set dynamically by Prepare limit, `onlySecondCircle: false`, `dwellTime: true`, plus `sessionCookie` and `userAgent` from Doppler.
- **Flow (batch, no loop):**  
  Schedule (Kyle or Hudson) → Fetch Doppler cookies → Take one profile → Get Ready Leads → Filter/Sort/Limit → **Append row in sheet** (Sheet2) → **Pass One** (single item to PB) → PhantomBuster: SendConnectionList (single launch, reads from Sheet2 URL) → Wait 15 min → Fetch Result1 → If (still running?) → **Parse Result1** (extract JSON URL + detect critical errors) → Critical Error?1 → **Fetch PB Results JSON** (GET the S3 results JSON) → **Prepare Updates** (map per-profile results into payload) → **Batch Update Master List** (POST to Apps Script) → **Clear sheet1** (clear Sheet2) → Done.
- **Master List update**: Uses a **Google Apps Script** web app (see `scripts/apps-script/batch-update.js`) that accepts a POST with `{ profile, updates: [{ defaultProfileUrl, status, sentDate }] }`. The script finds rows by `defaultProfileUrl` and writes `kyleSentDate`/`hudsonSentDate` + `inviteResults`. No loop in n8n — one HTTP call for all updates.

**Profile IDs (for phantoms that use `identities`):**  
Kyle: `873166477112851`, Hudson: `4408890722660549`.

After Phase 2 validation, add hudsonConnectExport agent ID above.
