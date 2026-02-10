# Waitlist Pipeline — Testing & Setup Guide

## Overview

Two n8n workflows for the Clerk waitlist-to-qualified-lead pipeline:

| Workflow | File | Webhook Path | Purpose |
|----------|------|-------------|---------|
| **Waitlist Signup Intake** | `waitlist-signup-intake.json` | `waitlist-signup` | Clerk webhook → Svix verify → PostHog → HubSpot contact |
| **Waitlist Qualified Booked** | `waitlist-qualified-booked.json` | `waitlist-calendly-booked` | Calendly webhook → HubSpot update → Task → Linq/Slack |

---

## Pre-Requisites (Manual Steps)

### 1. HubSpot Custom Properties

Create these **Contact properties** in HubSpot (Settings > Properties > Contact properties). Group: "Waitlist".

| Property Name | Internal Name | Type | Options |
|---------------|---------------|------|---------|
| Clerk Waitlist ID | `clerk_waitlist_id` | Single-line text | — |
| Waitlist Status | `waitlist_status` | Dropdown | `pending`, `form_sent`, `qualified`, `booked`, `converted` |
| Waitlist Signup Date | `waitlist_signup_date` | Date picker | — |
| Reason for Interest | `reason_for_interest` | Multi-line text | — |
| Qualification Form Completed | `qualification_form_completed` | Single checkbox | — |
| Qualification Form Date | `qualification_form_date` | Date picker | — |
| Calendly Event URL | `calendly_event_url` | Single-line text | — |

### 2. Doppler Secrets

Add to Doppler project **chrt**, config **prd**:

| Secret Name | Value | Source |
|-------------|-------|--------|
| `CLERK_WEBHOOK_SECRET` | `whsec_...` | Clerk Dashboard > Webhooks > Signing Secret |
| `POSTHOG_PROJECT_API_KEY` | `phc_...` | PostHog > Settings > Project API Key |
| `POSTHOG_HOST` | `https://us.i.posthog.com` or `https://eu.i.posthog.com` | PostHog instance region |
| `LINQ_INTEGRATION_TOKEN` | *(deferred)* | Linq Blue dashboard (when account is set up) |

**Note:** The Doppler API credential in n8n (ID `dz2vX61Mpayywfq1`, name "Doppler API") must have access to the `chrt/prd` config. If the current service token only accesses `developers/hudson`, create a new service token in Doppler with access to both projects, or create a second Header Auth credential in n8n.

### 3. Calendly Routing Form

Create a **Routing Form** in Calendly (requires Teams plan or higher):

1. Go to Calendly > Routing Forms > Create Routing Form
2. Add these questions (all required):
   - "Full Name" (Short text)
   - "Phone Number" (Short text)
   - "Company" (Short text)
   - "City, State" (Short text)
   - "What brings you to Chrt?" (Long text)
3. Route all responses to a single event type (e.g., "Chrt Waitlist Demo — 30 min")
4. Note the routing form URL: `https://calendly.com/d/XXXX-XXXX-XXXX`

### 4. HubSpot Workflows (in HubSpot UI)

**Workflow: "Waitlist Qualification Email"**
- Trigger: Contact property `waitlist_status` is equal to `pending`
- Action 1: Delay 1 minute
- Action 2: Send email with personalized Calendly routing form link:
  `https://calendly.com/d/YOUR_ROUTING_FORM?email={{contact.email}}&utm_source=waitlist`
- Action 3: Set contact property `waitlist_status` to `form_sent`

**Workflow: "Waitlist Abandonment Nudge"** (optional, Phase 2)
- Trigger: `waitlist_status` is `form_sent` for 48+ hours AND `qualification_form_completed` is not true
- Action: Send nudge email with the same Calendly link

### 5. Clerk Webhook Configuration

After deploying Workflow A to n8n:

1. Go to Clerk Dashboard > Webhooks > Add Endpoint
2. URL: `https://chrt.app.n8n.cloud/webhook/waitlist-signup` (or test URL)
3. Events: Select `waitlistEntry.created`
4. Copy the **Signing Secret** (`whsec_...`) to Doppler as `CLERK_WEBHOOK_SECRET`

### 6. Calendly Webhook Configuration

After deploying Workflow B to n8n:

1. Create webhook subscription via Calendly API or dashboard
2. URL: `https://chrt.app.n8n.cloud/webhook/waitlist-calendly-booked`
3. Events: `invitee.created`
4. Scope: `organization`

---

## Testing Workflow A (Waitlist Signup Intake)

### Import to n8n test folder

```bash
./scripts/n8n-ops/debug.sh import-to-test workflows/waitlist/testing/waitlist-signup-intake.json
```

Then move the imported workflow to the test folder in the n8n UI.

### Test with curl

Send a simulated Clerk webhook (without real Svix verification — will fail at signature check, but tests the flow):

```bash
curl -X POST https://chrt.app.n8n.cloud/webhook-test/waitlist-signup \
  -H "Content-Type: application/json" \
  -H "svix-id: msg_test123" \
  -H "svix-timestamp: $(date +%s)" \
  -H "svix-signature: v1,test" \
  -d '{
    "data": {
      "id": "waitlist_test_001",
      "email_address": "test.user@example.com",
      "status": "pending",
      "created_at": '$(date +%s000)'
    },
    "type": "waitlistEntry.created",
    "timestamp": '$(date +%s000)'
  }'
```

**Note:** This will fail Svix verification (expected). To test the full flow including signature verification, use Clerk's webhook testing tool or the Svix CLI.

### Test PostHog + HubSpot only (bypass Svix)

For testing downstream nodes, temporarily disconnect "Verify Svix Signature" → "Respond to Webhook" and connect "Fetch Doppler Secrets" directly to "Extract Waitlist Data" with test payload.

---

## Testing Workflow B (Waitlist Qualified Booked)

### Import to n8n test folder

```bash
./scripts/n8n-ops/debug.sh import-to-test workflows/waitlist/testing/waitlist-qualified-booked.json
```

### Test with curl

Send a simulated Calendly `invitee.created` webhook:

```bash
curl -X POST https://chrt.app.n8n.cloud/webhook-test/waitlist-calendly-booked \
  -H "Content-Type: application/json" \
  -d '{
    "event": "invitee.created",
    "payload": {
      "email": "test.user@example.com",
      "name": "Test User",
      "uri": "https://api.calendly.com/scheduled_events/EVT-TEST/invitees/INV-TEST",
      "tracking": {
        "utm_source": "waitlist"
      },
      "questions_and_answers": [
        { "question": "Company", "answer": "Test Corp" },
        { "question": "City, State", "answer": "Austin, TX" },
        { "question": "Phone Number", "answer": "5125551234" },
        { "question": "What brings you to Chrt?", "answer": "Need better courier visibility" }
      ],
      "scheduled_event": {
        "uri": "https://api.calendly.com/scheduled_events/EVT-TEST"
      },
      "cancel_url": "https://calendly.com/cancellations/INV-TEST",
      "reschedule_url": "https://calendly.com/reschedulings/INV-TEST"
    }
  }'
```

### Verify in HubSpot

1. Search for the test contact by email
2. Confirm properties were set: `waitlist_status: booked`, `company: Test Corp`, `city: Austin`, `state: TX`, `reason_for_interest`, `qualification_form_completed: true`
3. Confirm a Task was created: "Text Test User - Waitlist Qualified" with HIGH priority

---

## Promotion to Production

When tests pass:

```bash
# Copy testing files to main
cp workflows/waitlist/testing/waitlist-signup-intake.json workflows/waitlist/waitlist-signup-intake.json
cp workflows/waitlist/testing/waitlist-qualified-booked.json workflows/waitlist/waitlist-qualified-booked.json

# Push to n8n production (update with actual workflow IDs after import)
./scripts/n8n-ops/debug.sh update workflows/waitlist/waitlist-signup-intake.json <WORKFLOW_A_ID>
./scripts/n8n-ops/debug.sh update workflows/waitlist/waitlist-qualified-booked.json <WORKFLOW_B_ID>

# Activate
./scripts/n8n-ops/debug.sh activate <WORKFLOW_A_ID>
./scripts/n8n-ops/debug.sh activate <WORKFLOW_B_ID>
```

---

## Architecture

```
Clerk Waitlist → [Workflow A] → PostHog + HubSpot Contact
                                      ↓
                            HubSpot Workflow sends
                            qualification email with
                            Calendly Routing Form link
                                      ↓
                         User fills form + books meeting
                                      ↓
              Calendly webhook → [Workflow B] → HubSpot Update
                                              + HubSpot Task
                                              + Linq SMS / Slack
```

## Lifecycle Stage Progression

| Event | Lifecycle Stage | `waitlist_status` |
|-------|----------------|-------------------|
| Waitlist signup | Subscriber | `pending` |
| Email sent by HubSpot | Subscriber | `form_sent` |
| Form + Calendly booking | Marketing Qualified Lead | `booked` |
| After qualification call | Sales Qualified Lead | *(manual)* |
