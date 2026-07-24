# System Health Observability Design

## Goal

Make Platform → System Health explain why a service is Degraded, Down, or Stale, and expose the failure history already returned for scheduled jobs.

## Scope

This change covers the Platform console only. It does not modify cron scheduling, health thresholds, database schema, or the production Analytics log query.

## Design

### Health-status explanations

The existing pure health derivation stays the source of truth for status. A companion pure helper will return a concise, deterministic explanation for every non-operational state:

- `stale`: no recent dispatch or response;
- `down`: all calls failed/rejected, or the cron watcher reported a failing status;
- `degraded`: p95 latency over 12 seconds, 5xx rate over 5%, or 4xx rate over 20%;
- `pending`: no assessment has been recorded yet.

The helper will use the same precedence as the status derivation. The scheduled and on-demand panels will render that explanation next to the status, so a latency or rate degradation is not presented as a missing error message.

### Scheduled-job history

`get_cron_health` already returns up to ten incident records in `recent_failures`. The client type will map that data explicitly and the Scheduled jobs panel will offer an expandable "Failure history" region whenever records exist. Each entry will show its local timestamp, HTTP status when available, and stored error text.

The current `last_error` remains a compact summary on the row. No response body will be fabricated: cron monitoring currently records a transport error or HTTP status, not an Edge Function response payload.

### On-demand-function log drill-down

The existing lazy log drill-down stays optional and is not treated as the source of the status reason. Its UI will expose a useful Analytics fetch failure message rather than a generic unavailable label. The Analytics query itself will not be changed until its live schema is verified with production credentials.

## Data flow

```text
Analytics metric / cron-health RPC
            |
            v
pure status + explanation helper
            |
            +--> status badge + exact degradation reason
            |
            +--> scheduled-job failure-history expansion
```

## Testing

- Add pure unit cases for each explanation and precedence rule.
- Add Scheduled jobs component cases for a latency degradation and rendered failure-history detail.
- Add Edge Functions component interaction coverage for expanding the drill-down and its unavailable-error state.
- Run targeted tests, the full Vitest suite, lint, and a production build before publishing.

## Constraints

- Follow `CLAUDE.md`: use the existing data-access/hook layer, do not hand-edit Supabase migrations or generated types, and write regression tests before production code.
- Keep identifiers and messages free of tenant-specific data.
- Do not claim error-body diagnostics where the current backend only provides a status or transport error.
