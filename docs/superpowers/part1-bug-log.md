# Part 1 — Bug Log

Findings surfaced by deep edge-function tests. Severity: CRITICAL (data loss / security / silent failure) · HIGH (wrong result for users) · MED · LOW.

| Function | Severity | Contract violated (app-logic.md ref) | Resolution | Test |
|---|---|---|---|---|
| `send-offer-digest` | MED | at-least-once email on stamp failure — if `sendEmail` succeeds but the subsequent `bookings.update` (stamp) returns an error, the handler logs and continues without incrementing `digests_sent`. The booking retains `digest_sent_at = null` and will be re-queried on the next run, sending a duplicate offer email. The idempotency key `offer-digest-<artistId>-YYYY-MM-DDTHH` mitigates duplicates within the same UTC hour only; a stamp failure at 19:01 and a retry at the next day's 19:00 run will produce an unavoidable duplicate (different key). Doc ref: _The Offer → Booking Flow_ — "Stamps `digest_sent_at = now()` … offers will re-send next run". | design-limitation (acceptable at current scale; at-least-once delivery is the stated behavior); no code change. The harness cannot selectively fail the UPDATE without also failing the SELECT on the same table — a `// NOTE:` comment in the test documents this limitation and the verdict. | `send-offer-digest: atomicity characterization — harness limitation for stamp-failure path` |
