# Admin audit logs

MockAuth emits per-tenant audit logs for OAuth flows and configuration changes. The admin console includes an **Audit logs** page for reviewing these events.

## Viewing audit logs

1. Sign in to the admin console.
2. Select a tenant.
3. Open **Audit logs** in the sidebar.

Use the filters to narrow down the results:

- **Client** — limit events to a specific OAuth client.
- **Event type** — e.g., authorize, token, proxy, or security events.
- **Severity** — info, warn, or error.
- **Trace ID** — filter related events with a shared trace.
- **Date range** — start/end dates for event timestamps.

Click a trace ID in the table to drill into the related events.

## Data retention

Audit logs are retained for 90 days by default. Configure retention with the following environment variable:

```
AUDIT_LOG_RETENTION_DAYS=90
```

## Pruning logs via cron

Use the cron endpoint to delete records older than the retention window:

```
POST /api/cron/audit-prune
Authorization: Bearer <CRON_SECRET>
```

Set the secret with:

```
CRON_SECRET=replace-with-cron-secret
```

## Redaction

Tokens, authorization codes, and secrets are not stored in audit logs by default. Only non-sensitive summaries are
retained.

To disable redaction for QA/debugging, set:

```
AUDIT_LOG_REDACTION=off
```

When disabled, sensitive request parameters and configuration snapshots are logged in full. The admin UI shows a
warning banner when redaction is turned off. Keep this disabled in production environments.
