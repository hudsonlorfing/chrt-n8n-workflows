# Bug Report: Wait Node webhook-waiting returns SQLITE_ERROR on n8n Cloud

## Description

When using the Wait node with `resume: "webhook"` on n8n Cloud, calling the `webhook-waiting` endpoint to resume an execution returns:

```json
{"code":0,"message":"SQLITE_ERROR: no such column: NaN"}
```

The execution shows as "waiting" in the n8n UI (e.g., at `/workflow/{id}/executions/{executionId}`), but:
1. The execution doesn't appear in API queries for waiting executions
2. Calling the webhook-waiting URL to resume it fails with the SQLITE error

## Steps to Reproduce

1. Create a simple workflow on n8n Cloud:
   - **Webhook Trigger** (POST, path: "wait-test", responseMode: "responseNode")
   - **Respond to Webhook** (returns the resume URL)
   - **Wait Node** (resume: "webhook", webhookId: "resume-test", webhookSuffix: `={{ $json.body.id }}`)
   - **Any action node** (e.g., HTTP Request to Slack webhook)

2. Activate the workflow

3. Trigger the webhook:
   ```bash
   curl -X POST "https://YOUR-INSTANCE.app.n8n.cloud/webhook/wait-test" \
     -H "Content-Type: application/json" \
     -d '{"id": "abc123"}'
   ```
   
   Response: `{"status":"waiting","resumeUrl":"https://YOUR-INSTANCE.app.n8n.cloud/webhook-waiting/resume-test/abc123"}`

4. Verify execution is waiting in UI (shows "waiting" status)

5. Try to resume:
   ```bash
   curl -X POST "https://YOUR-INSTANCE.app.n8n.cloud/webhook-waiting/resume-test/abc123" \
     -H "Content-Type: application/json" \
     -d '{"resumed": true}'
   ```
   
   Response: `{"code":0,"message":"SQLITE_ERROR: no such column: NaN"}`

## Expected Behavior

The webhook-waiting call should resume the waiting execution and the workflow should continue to the next node.

## Actual Behavior

- The resume webhook returns `SQLITE_ERROR: no such column: NaN`
- The execution remains in "waiting" state indefinitely
- The workflow never completes

## Environment

- **n8n Version**: n8n Cloud (latest as of January 2026)
- **Instance URL**: chrt.app.n8n.cloud
- **Browser**: N/A (API calls)

## Additional Context

- This affects any workflow using Wait node with webhook resume
- The issue occurs consistently across multiple workflow configurations
- Verified with both complex workflows (Slack interactive forms) and minimal test workflows
- The waiting executions DO appear in the UI but NOT in API queries (`/api/v1/executions?status=waiting`)

## Workaround

Using n8n Form Trigger as an alternative to Wait node + Slack interactive buttons.

