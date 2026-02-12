# Chrt n8n Workflows

Version-controlled n8n workflow backups and automation system for Chrt.

## Quick Start (New Machine)

1. **Clone the repo**
   ```bash
   git clone git@github.com:hudsonlorfing/chrt-n8n-workflows.git
   cd chrt-n8n-workflows
   ```

2. **Install Doppler CLI**
   ```bash
   brew install dopplerhq/cli/doppler
   ```

3. **Login and setup**
   ```bash
   doppler login
   doppler setup  # Select "developers" project, "hudson" config
   ```

4. **Sync with n8n**
   ```bash
   ./scripts/n8n-ops/sync.sh sync
   ```

All secrets are loaded from Doppler automatically.

---

## Sales Context Bot (Meeting Intelligence)

The **Sales Context Bot** is a Slack-based AI agent that provides real-time access to meeting intelligence, cross-meeting synthesis, and CRM context. Mention it in any Slack channel, then continue the conversation in the thread without needing to mention it again.

### What It Does

| Capability | Trigger Example | Tool Used |
|---|---|---|
| Find meetings with someone | `@MeetingBot meetings with trent last week` | `search_meetings` |
| Get meeting details | Reply: `the second one` | `get_meeting_analysis` |
| Cross-meeting summary | `@MeetingBot what's been happening with trent?` | `get_person_summary` |
| CRM activity (emails/calls) | Reply: `what emails have we sent?` | `get_crm_activity` |
| Meeting prep brief | `@MeetingBot prep me for my call with trent` | `get_meeting_prep` |

### How to Use

**Step 1: Start a conversation** — Mention the bot in any channel where it's installed:

```
@MeetingBot meetings with sarah last 2 weeks
```

The bot responds with a numbered list of matching meetings, each with a one-line summary.

**Step 2: Select and explore** — Reply in the thread (no need to @mention again):

```
the first one
```

The bot loads the full structured analysis: summary, action items, decisions, key quotes, follow-ups, and scores.

**Step 3: Ask follow-ups** — Continue in the same thread:

```
what were the action items?
what about emails we've exchanged?
prep me for our next call
```

The bot maintains context throughout the thread, choosing the right tool automatically.

### Disambiguation

When multiple people share a name, the bot presents a numbered list:

```
Multiple people found matching "trent":

1. Trent Doe (Labcorp), VP Operations — 5 meeting(s), last: Feb 8
2. Trent Smith (MassFlux), CEO — 2 meeting(s), last: Jan 15

Which person do you mean?
```

Pick one, and the bot uses that person's identity for the rest of the thread.

### The 5 Tools

#### 1. `search_meetings`
Searches Supabase for meetings by person name. Supports `days_back`, `date_from`, `date_to`. Returns titles with one-line summaries from `structured_data`.

#### 2. `get_meeting_analysis`
Fetches the full analysis for a specific meeting UUID. Returns structured sections:
- **Summary** — one-paragraph overview
- **Action Items** — with owner and due date
- **Key Decisions** — what was decided
- **Key Quotes** — notable statements with speaker attribution
- **Follow-ups** — next steps
- **Scores** — SPICED or custom scoring
- **Full Analysis** — the complete markdown analysis

#### 3. `get_person_summary`
Calls the Apps Script `get-person-summary` endpoint. Aggregates across all meetings with a person:
- Chronological meeting timeline with summaries
- All action items (with source meeting)
- All decisions
- Score trend over time
- Agent memory facts (person + company)
- Handles disambiguation when multiple people match

#### 4. `get_crm_activity`
Calls the Apps Script `get-crm-activity` endpoint. Fetches from HubSpot in parallel:
- Recent emails (subject, direction, snippet)
- Recent calls (title, duration, disposition, notes)
- Recent notes (body snippet)
- Summary line: "15 emails (8 sent, 7 received), 3 calls, 4 notes in last 30 days"

#### 5. `get_meeting_prep`
Calls the Apps Script `get-meeting-prep` endpoint. Generates a comprehensive prep brief:
- **CRM Context** — contact title, company, lifecycle stage, deals (stage, amount, close date)
- **Relationship Arc** — chronological meeting timeline with summaries
- **Open Items** — aggregated action items and follow-ups, flagged if overdue
- **Key Positions** — notable quotes from recent meetings
- **Score Trend** — scoring over time
- **Recent CRM Activity** — email/call summary
- **Known Facts** — from agent memory

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Slack (app_mention + thread replies)                   │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│  WF8: Slack Meeting Bot (n8n)                           │
│  ID: 9t7EPqjlUUirs2fw                                  │
│                                                         │
│  Parse Event → Doppler → Supabase Check → Build Context │
│  → AI Agent (Claude Sonnet 4) → Save Exchange → Reply   │
│                                                         │
│  Tools:                                                 │
│  ├── search_meetings      → Supabase direct             │
│  ├── get_meeting_analysis → Supabase direct             │
│  ├── get_person_summary   → Apps Script                 │
│  ├── get_crm_activity     → Apps Script                 │
│  └── get_meeting_prep     → Apps Script                 │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│  Apps Script: meeting-context.js                        │
│  (Stable URL, handles complex data queries)             │
│                                                         │
│  Actions: resolve-context, extract-memory,              │
│  get-person-summary, get-crm-activity, get-meeting-prep │
└───────┬──────────────────────────────────┬──────────────┘
        │                                  │
┌───────▼────────┐                ┌────────▼───────┐
│  Supabase      │                │  HubSpot API   │
│  meetings      │                │  Contacts       │
│  analyses      │                │  Emails/Calls   │
│  participants  │                │  Deals          │
│  agent_memory  │                │  Notes          │
│  conversations │                │                 │
└────────────────┘                └────────────────┘
```

### Key Files

| File | Purpose |
|---|---|
| `workflows/meetings/8.-slack-follow-up-agent.json` | WF8 — the main Slack bot workflow |
| `workflows/meetings/7.-slack-interaction-handler.json` | WF7 — meeting analysis handler |
| `scripts/apps-script/meeting-context.js` | Apps Script data layer (all complex queries) |
| `scripts/apps-script/clasp.sh` | Apps Script deploy tool |
| `scripts/n8n-ops/debug.sh` | n8n workflow push/activate/execution tool |
| `supabase/migrations/001_meeting_intel_schema.sql` | Database schema |

### Data Flow

1. **Slack** sends `app_mention` or `message` events to the WF8 webhook
2. **Parse Event** accepts mentions + thread replies, filters bot echoes
3. **Doppler** provides the Supabase service role key at runtime
4. **Supabase** checks if the thread is linked to an existing meeting and loads conversation history
5. **Build Agent Context** constructs the system prompt with tool descriptions and any linked meeting context
6. **AI Agent** (Claude Sonnet 4) routes to the appropriate tool based on user intent
7. **Tools 1-2** query Supabase directly; **Tools 3-5** call Apps Script which queries both Supabase and HubSpot
8. **Agent response** is saved to `agent_conversations` and posted to the Slack thread

---

## Repository Structure

```
workflows/
├── meetings/
│   ├── 6.-fireflies-meeting-processor.json   # Fireflies → Supabase ingestion
│   ├── 7.-slack-interaction-handler.json     # Meeting analysis (button-triggered)
│   └── 8.-slack-follow-up-agent.json         # Sales Context Bot (main bot)
├── linkedin/                                  # LinkedIn lead gen workflows
│   ├── 1.0-lead-ingestion-icp-scoring.json
│   ├── 2.1-linkedin-outreach-send.json
│   ├── 2.2-linkedin-outreach-results.json
│   ├── 3.3-connection-sync-hubspot.json
│   └── 4.1-pipeline-monitor-launch.json
├── waitlist/                                  # Waitlist signup workflows
└── maintenance/                               # Error monitoring

scripts/
├── apps-script/
│   ├── meeting-context.js                    # Apps Script data layer
│   ├── lead-ingestion.js                     # ICP scoring Apps Script
│   ├── clasp.sh                              # Deploy tool for Apps Script
│   ├── appsscript.json                       # Apps Script manifest
│   └── .gitignore                            # Excludes clasp temp files
├── n8n-ops/
│   ├── debug.sh                              # Workflow update/activate/execution
│   └── sync.sh                               # Bidirectional n8n sync
├── tests/
│   ├── test-phase1.sh                        # Tests 1-3: thread replies, search
│   ├── test-phase2.sh                        # Tests 1-6: + person summary
│   ├── test-phase3.sh                        # Tests 1-9: + CRM activity
│   └── test-phase4.sh                        # Tests 1-12: + meeting prep, full flow
└── hubspot/                                   # HubSpot enrichment scripts

supabase/
├── migrations/001_meeting_intel_schema.sql    # Database schema
└── seed/                                      # Seed data
```

---

## Development Guide

### Pushing Workflow Changes to n8n

```bash
# Edit the workflow JSON locally, then:
./scripts/n8n-ops/debug.sh update workflows/meetings/8.-slack-follow-up-agent.json 9t7EPqjlUUirs2fw

# Activate (if needed):
./scripts/n8n-ops/debug.sh activate 9t7EPqjlUUirs2fw

# Check recent executions:
./scripts/n8n-ops/debug.sh list 9t7EPqjlUUirs2fw

# Inspect a specific execution:
./scripts/n8n-ops/debug.sh execution <EXEC_ID>
```

### Deploying Apps Script Changes

```bash
cd scripts/apps-script

# Push and redeploy (URL stays the same):
./clasp.sh redeploy meeting-context

# Push without redeploying:
./clasp.sh push meeting-context

# Pull remote changes:
./clasp.sh pull meeting-context
```

### Running Tests

Each phase test includes all previous phases as regression tests:

```bash
# Run the full test suite (all 12 tests):
./scripts/tests/test-phase4.sh

# Or run individual phase tests:
./scripts/tests/test-phase1.sh   # 3 tests: thread replies, search, AI agent
./scripts/tests/test-phase2.sh   # 6 tests: + person summary, disambiguation
./scripts/tests/test-phase3.sh   # 9 tests: + CRM activity, unknown contact
./scripts/tests/test-phase4.sh   # 12 tests: + meeting prep, 5-step flow
```

Tests require `N8N_API_KEY` (auto-loaded from Doppler) and send simulated Slack events to the live webhook. They wait for execution completion and verify node outputs.

### Secrets (Doppler)

All secrets are managed in Doppler (`developers` project, `hudson` config):

| Secret | Used By |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | WF8 (fetched at runtime via Doppler node) |
| `HUBSPOT_ACCESS_TOKEN` | Apps Script (fetched from Doppler inside Apps Script) |
| `N8N_API_KEY` | `debug.sh`, test scripts |
| `DOPPLER_TOKEN` | Apps Script (for self-service secret fetching) |
| Slack webhook URLs | Various workflows |

### Slack App Configuration

The bot requires these event subscriptions in the Slack App settings:
- `app_mention` — triggers on @mention
- `message.channels` — triggers on channel messages (for thread replies)
- `message.groups` — triggers on private channel messages (for thread replies)

Bot messages are automatically filtered by the Parse Event node (checks `bot_id` and `bot_profile`).

---

## Workflow IDs

| Workflow | n8n ID | Purpose |
|---|---|---|
| 6. Fireflies Meeting Processor | — | Ingests meetings from Fireflies |
| 7. Slack Interaction Handler | — | Button-triggered meeting analysis |
| **8. Slack Meeting Bot** | `9t7EPqjlUUirs2fw` | **Sales Context Bot** |

---

## Related

- [n8n Documentation](https://docs.n8n.io)
- [Supabase](https://utvoxshpxzsgsliworwh.supabase.co)
- [HubSpot API](https://developers.hubspot.com/docs/api/overview)
- [Google Apps Script](https://script.google.com)
- [STATUS.md](STATUS.md) - Current issues and next steps
