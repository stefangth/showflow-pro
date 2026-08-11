import { Card, CardContent } from "@/components/ui/card";
import { RETENTION } from "@/lib/trust/facts";

/** How long each category is kept. Mirrors section 7 of the privacy policy;
 *  facts.privacy.test.ts fails if the two drift apart. */
export function RetentionCard() {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="text-base font-semibold tracking-tight">Retention</h3>
        <p className="text-sm text-muted-foreground">Nothing is kept "just in case".</p>
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
