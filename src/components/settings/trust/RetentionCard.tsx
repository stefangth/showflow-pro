import { Card, CardContent } from "@/components/ui/card";
import { RETENTION } from "@/lib/trust/facts";

/** How long each category is kept. Mirrors section 7 of the privacy policy;
 *  facts.privacy.test.ts fails if the two drift apart. */
export function RetentionCard() {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="text-base font-semibold tracking-tight">Retention</h3>
        {/* This used to read: Nothing is kept "just in case". That is a claim
         *  about behaviour, and it does not hold for the two categories the
         *  table leads with. Nothing in the repo deletes bookings, the audit
         *  log or chat on a timer: the only retention cron is email-log-prune
         *  (public.prune_email_log, daily 03:30), and the sole time-independent
         *  deletes are the per-user anonymize_user and the per-org delete_org.
         *  Chat archiving at 30 days is an interface rule (CHAT_ARCHIVE_DAYS),
         *  not a delete. What is true of the table is what it is: the periods
         *  section 7 of the privacy policy commits to, which is the same
         *  demotion the Backups row already made from "rolling 30 days" to a
         *  ceiling. facts.privacy.test.ts parses section 7 and fails if the
         *  rows below stop matching it. */}
        <p className="text-sm text-muted-foreground">
          Each category below has a stated period, taken from section 7 of the privacy policy.
        </p>
        <dl className="text-sm">
          {RETENTION.map((row) => (
            <div
              key={row.item}
              className="flex items-baseline justify-between gap-3 border-t border-border py-2"
            >
              <dt className="font-medium">{row.item}</dt>
              <dd className="text-right font-mono text-xs text-muted-foreground">{row.period}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs leading-4 text-muted-foreground">
          Deleted data leaves the backups within 30 days, the longest any backup is kept.
        </p>
      </CardContent>
    </Card>
  );
}
