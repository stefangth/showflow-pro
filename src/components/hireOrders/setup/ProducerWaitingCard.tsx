import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { SetupStep } from "@/lib/hireOrders/setupStatus";

const LABELS: Record<string, string> = {
  letterhead: "Letterhead",
  terms: "Terms template",
  countersign: "Countersigning",
};

/** Shown instead of the rail when the viewer lacks `edit_hire_order_settings`.
 *
 *  Deliberately does not name the admin who could fix it: list_org_members is
 *  admin-guarded and raises 42501 for producers, so naming them needs a new RPC, and a
 *  nudge button needs a new notification type plus rate limiting. Both are a separate
 *  follow-up (spec §5.4). Drafting is unaffected, which is the point of the copy. */
export function ProducerWaitingCard({ steps }: { steps: SetupStep[] }) {
  const outstanding = steps.filter((s) => !s.done && s.blocksIssue);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          {/* text-amber-600 would be Tailwind's built-in #d97706 (no dark-mode
              override); the --amber-600 var lifts to #F2B23C on a dark card. */}
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--amber-600)]">
            Waiting on your admin
          </p>
          <p className="mt-1.5 font-display text-base font-semibold">Draft now, issue later</p>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground">
            Nothing stops you building orders. An admin needs to finish setup before anything can be sent.
          </p>
        </div>
        <div className="space-y-2">
          {outstanding.map((s) => (
            <div key={s.key} className="flex items-center gap-2 rounded-md border border-border p-2.5">
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{LABELS[s.key] ?? s.key}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
