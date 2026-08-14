import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { BACKUP_CEILING_NOTE, RETENTION, RETENTION_BASIS_NOTE } from "@/lib/trust/facts";

/** How long each category is kept, and what applies each period. The periods
 *  mirror section 7 of the privacy policy (facts.privacy.test.ts fails if the
 *  two drift apart); the basis lines are re-derived from the migrations, the
 *  edge tree and the dependency manifest by
 *  src/lib/trust/retentionBasis.test.ts. Nothing on this card is typed here. */
export function RetentionCard() {
  const { t } = useTranslation('settingsTrust');
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="text-base font-semibold tracking-tight">{t('retentionCard.title')}</h3>
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
          {t('retentionCard.intro')}{" "}
          {RETENTION_BASIS_NOTE}
        </p>
        {/* A bare period reads as "a timer deletes this on that schedule", and
         *  for six of the nine rows nothing schedules anything — see the
         *  scheduled-retention-jobs assertion in this component's test and the
         *  per-row basis strings in facts.ts. The basis line is what stops the
         *  table implying enforcement it does not have. */}
        <dl className="text-sm">
          {RETENTION.map((row) => (
            <div key={row.item} className="border-t border-border py-2">
              {/* The key/value line wraps as a LINE, not as two shrinking
               *  columns. A flex row with no `flex-wrap` makes both children
               *  shrink to min-content before the line ever breaks, so at the
               *  widths this card actually gets — it sits in the two-column
               *  band, which leaves it ~350px at 1280 and ~300px at 375 — the
               *  period broke mid-value into two right-aligned mono lines and
               *  dragged its key onto two lines with it. Five of eight rows
               *  did that at 375. `flex-wrap` plus `whitespace-nowrap` on the
               *  value gives the value an unbreakable min-content, so the
               *  browser breaks the LINE instead: key on its own line, whole
               *  period beneath it, still right-aligned by `ml-auto`. */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <dt className="font-medium">{row.item}</dt>
                <dd className="ml-auto whitespace-nowrap text-right font-mono text-xs text-muted-foreground">
                  {row.period}
                </dd>
              </div>
              <dd className="mt-1 text-xs leading-4 text-muted-foreground">{row.basis}</dd>
            </div>
          ))}
        </dl>
        {/* The backup ceiling is owned by facts.ts, not retyped here: it is the
         *  same sentence the Backups control and the public page publish. */}
        <p className="text-xs leading-4 text-muted-foreground">{BACKUP_CEILING_NOTE}</p>
      </CardContent>
    </Card>
  );
}
