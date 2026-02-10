# LinkedIn Session Cookie — Re-issue and Doppler

Connection Sync and Lead Pipeline Monitor use LinkedIn session cookies per profile (Kyle, Hudson). **Store them in Doppler**; the workflow pulls them **directly from Doppler** (no `$env` or n8n Variables — works on all n8n plans).

## Where cookies are used

- **Connection Sync → HubSpot (3):** Fetches secrets from Doppler API, then runs two profiles (kyle, hudson); each PhantomBuster launch uses `sessionCookie` and `userAgent` from that fetch.
- **LinkedIn Outreach (2):** Same Doppler fetch; one profile per run (Kyle or Hudson). Send connection phantom reads from the **holding sheet** (spreadsheet URL); launch payload includes `sessionCookie` and `userAgent` from Doppler.
- **Lead Pipeline Monitor (4):** Inline Slack alerts when PhantomBuster returns invalid/session errors; you then update the cookie in Doppler. No sync step — next Connection Sync run will pull the new value from Doppler.

**Doppler keys** (in project **chrt**, config **prd**):

- `LINKEDIN_KYLE_SESSION_COOKIE` — Kyle’s PhantomBuster/LinkedIn session cookie string.
- `LINKEDIN_HUDSON_SESSION_COOKIE` — Hudson’s session cookie string.

## How n8n gets the cookies (no $env)

The workflow calls **Doppler’s API** at run time:

1. **Fetch Doppler cookies** (HTTP Request) — `GET https://api.doppler.com/v3/configs/config/secrets?project=chrt&config=prd` with Header Auth.
2. **Build profile items with cookies** (Code) — Parses the response and outputs two items (kyle, hudson) with `sessionCookie` and `userAgent`.

You need one n8n credential: **HTTP Header Auth** named **Doppler API**.

### Create the “Doppler API” credential in n8n

1. In n8n: **Credentials** → **Add credential** → **Header Auth**.
2. Name: **Doppler API**.
3. **Header Name:** `Authorization`.
4. **Header Value:** `Bearer <your_doppler_service_token>`  
   Create a **read-only** Doppler service token for project **chrt**, config **prd** (Doppler dashboard → Project → Service Tokens).
5. Save.

No need to sync Doppler to n8n Variables or use `$env`; the workflow pulls from Doppler on each run.

### Optional: VPS proxy service (instead of putting the token in n8n)

If you prefer not to store the Doppler token in n8n, you can run a small proxy on your VPS that:

1. Holds the Doppler service token (e.g. in env or a secret file).
2. Exposes an HTTP endpoint (e.g. `GET /linkedin-cookies`) that calls Doppler’s API and returns the same shape (`secrets` with `LINKEDIN_KYLE_SESSION_COOKIE`, `LINKEDIN_HUDSON_SESSION_COOKIE`).
3. Is called by the **Fetch Doppler cookies** node instead of `api.doppler.com` (same response shape, so **Build profile items with cookies** stays unchanged).

Then the n8n credential would authenticate to your VPS endpoint (e.g. API key header) instead of to Doppler. See [Doppler API](https://docs.doppler.com/reference/config-secrets-download) for the exact request/response if you build this proxy.

## Manual re-issue (when Slack alerts or runs fail)

1. **Pick the profile**  
   - Kyle: Chrt Gmail → LinkedIn (Kyle’s account).  
   - Hudson: Personal Gmail → LinkedIn (Hudson’s account).

2. **Open the right browser**  
   Use the browser where that LinkedIn account is logged in.

3. **Get the cookie**  
   - Go to [linkedin.com](https://www.linkedin.com) and sign in if needed.  
   - Open DevTools: right‑click → **Inspect** (or `Cmd+Option+I` / `Ctrl+Shift+I`).  
   - **Application** tab → **Storage** → **Cookies** → `https://www.linkedin.com`.  
   - Find **`li_at`** → double‑click the **Value** cell and copy the full string.

4. **PhantomBuster format**  
   PhantomBuster may use the raw `li_at` value, or a longer “session cookie” string from their UI. If a workflow or PhantomBuster shows “invalid cookie,” try:  
   - Pasting the `li_at` value into Doppler as-is, or  
   - In PhantomBuster: **Reconnect** / **Update cookie** for that agent, then copy the session string they show and paste that into Doppler.

5. **Update Doppler**  
   - Open Doppler (dashboard or CLI): **chrt** project → **prd** config.  
   - Set `LINKEDIN_KYLE_SESSION_COOKIE` or `LINKEDIN_HUDSON_SESSION_COOKIE` to the new value.  
   - Save.

6. **No sync step**  
   The next run of Connection Sync will fetch the new value from Doppler automatically. No n8n Variables, no env, no restart.

7. **Re-run**  
   Trigger the workflow again (schedule or manual). No code or repo change needed.

## When to re-issue

- Slack shows: **“LinkedIn Cookie/Session Error - Update in Doppler”** (from Connection Sync or Lead Pipeline Monitor).
- PhantomBuster or workflows fail with “invalid cookie,” “session expired,” “disconnected,” or “invalid credentials.”
- You’ve logged out of LinkedIn or changed password in that browser.

Re-issue in **Doppler**; the workflow will use the new value on the next run.

## Related

- [linkedin-validation.md](linkedin-validation.md) — Phase 1 & 2 validation (payload override, hudsonConnectExport).
- [linkedin-phantoms.md](linkedin-phantoms.md) — PhantomBuster agent IDs.
- [WORKFLOW-PROCESS.md](../WORKFLOW-PROCESS.md) — Cookie refresh checklist.
