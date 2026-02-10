# LinkedIn Profile Switching — Validation (Phase 1 & Phase 2)

Run these validations **before** changing any workflow JSON. Use manual API calls, a temporary n8n workflow, or the script below.

## Phase 1: Payload override for Connections Export

**Goal:** Confirm that the existing Connections Export phantom (agent `959265651312489`) can run as Hudson by passing Hudson's `sessionCookie` and `userAgent` in `bonusArgument`.

### Steps

1. Get Hudson's session cookie and user agent (see [linkedin-session-cookie.md](linkedin-session-cookie.md)).
2. Call PhantomBuster launch API:

   ```bash
   # Use scripts/test-connection-export-launch.sh with your Phantom API key and Hudson cookie
   ./scripts/tests/test-connection-export-launch.sh
   ```

   Or manually:

   - **POST** `https://api.phantombuster.com/api/v2/agents/launch`
   - **Header:** `X-Phantombuster-Key-1: <your PhantomBuster API key>` (from n8n "Phantom Header Auth" credential).
   - **Body (JSON):**
     ```json
     {
       "id": "959265651312489",
       "manualLaunch": true,
       "bonusArgument": {
         "sessionCookie": "<Hudson's cookie>",
         "userAgent": "<Hudson's user agent>",
         "sortBy": "Recently added",
         "numberOfProfiles": 2000
       }
     }
     ```

3. Check the run in PhantomBuster; confirm output is **Hudson's** connections, not Kyle's.

**If it works:** No new phantom needed for Hudson — same agent can serve both profiles via `bonusArgument`.  
**If it fails:** Proceed to Phase 2 and use a dedicated hudsonConnectExport phantom.

---

## Phase 2: hudsonConnectExport phantom and switch test

**Goal:** Create a PhantomBuster phantom named **hudsonConnectExport**, then verify you can switch profile by overriding with Kyle's data.

### 2.1 Create hudsonConnectExport in PhantomBuster

1. In PhantomBuster: duplicate or create a new agent from the **LinkedIn Connections Export** template.
2. Name it `hudsonConnectExport`.
3. Set default input to Hudson's values:
   - `numberOfProfiles`: 2000  
   - `sortBy`: "Recently added"  
   - `sessionCookie`: Hudson's session cookie  
   - `userAgent`: Hudson's user agent (e.g. Chrome on macOS)
4. Note the new **agent ID** (e.g. `464879223460809`).

### 2.2 Test 1 — Run as Hudson (default)

- Launch `hudsonConnectExport` with no `bonusArgument` (or empty).
- Confirm output is Hudson's connections.

### 2.3 Test 2 — Run as Kyle (override)

- Launch the **same** phantom with:
  - `bonusArgument`: `{ "sessionCookie": "<Kyle's cookie>", "userAgent": "<Kyle's user agent>", "sortBy": "Recently added", "numberOfProfiles": 2000 }`
- Confirm output is Kyle's connections.

### 2.4 Test 3 — Switch back to Hudson

- Launch again with Hudson's `sessionCookie` and `userAgent` in `bonusArgument`.
- Confirm output is Hudson's again.

### 2.5 Document

- Record the hudsonConnectExport **agent ID** in [CLAUDE.md](../CLAUDE.md) or [linkedin-phantoms.md](linkedin-phantoms.md) (if you create it).

**Conclusion:** If Tests 2 and 3 succeed, the same phantom can serve both profiles by toggling `bonusArgument`; n8n workflows can then inject profile-specific payloads.
