import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCapabilities";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import type { SetupStepKey } from "@/lib/hireOrders/setupStatus";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SetupStepRow } from "@/components/setup/SetupStepRow";
import { LetterheadStep } from "./LetterheadStep";
import { TermsStep } from "./TermsStep";
import { CountersignStep } from "./CountersignStep";
import { ProducerWaitingCard } from "./ProducerWaitingCard";
import { useRailDismissed } from "@/components/setup/useRailDismissed";

const TITLE_KEYS: Record<SetupStepKey, string> = {
  letterhead: "setupRail.titleLetterhead",
  terms: "setupRail.titleTerms",
  countersign: "setupRail.titleCountersign",
};

const HINT_KEYS: Record<SetupStepKey, { todo: string; done: string }> = {
  letterhead: {
    todo: "setupRail.letterheadTodo",
    done: "setupRail.letterheadDone",
  },
  terms: {
    todo: "setupRail.termsTodo",
    done: "setupRail.termsDone",
  },
  countersign: {
    todo: "setupRail.countersignTodo",
    done: "setupRail.countersignDone",
  },
};

/**
 * The hire-order setup rail: a persistent checklist beside the working orders page.
 *
 * Renders nothing at all once the org is set up or the viewer has hidden it, so it is a
 * genuinely temporary surface. Setup happens here, not in Settings, but every panel
 * writes through the same data path as the Settings cards.
 */
export function SetupRail({ orgId, initialStep }: { orgId: string | null; initialStep?: SetupStepKey }) {
  const { t } = useTranslation("hireOrdersPages");
  const canEditSettings = useCan("edit_hire_order_settings");
  const { status } = useHireOrderSetupStatus(orgId);
  const [, dismiss] = useRailDismissed("hireOrderSetup", orgId);
  const [open, setOpen] = useState<SetupStepKey | null>(initialStep ?? null);

  // No self-hide on dismissed/complete: this rail is mounted only inside SetupChecklistSheet
  // (gated by its `open` prop), and whether to SHOW the entry to it is the caller's job via
  // useSetupRailVisible. Gating here too meant a step opened from the dashboard (which uses a
  // different dismiss key) mounted a blank Sheet once hireOrderSetup was dismissed. Mirrors
  // BookingSetupRail, which has never self-hidden.
  if (!canEditSettings) return <ProducerWaitingCard steps={status.steps} />;

  const toggle = (key: SetupStepKey) => setOpen((cur) => (cur === key ? null : key));

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between">
            {/* Semantic token, not a numbered accent stop: accent-600 is the same dark
                violet in both modes (the scale is immutable by design), which is ~2.3:1
                on the dark card. Every other eyebrow in the app reads muted. */}
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("setupRail.progress", { done: status.doneCount, total: status.totalCount })}
            </p>
            <Button variant="ghost" size="sm" className="h-auto p-1 text-xs" onClick={dismiss}>
              {t("setupRail.hide")}
            </Button>
          </div>
          <p className="mt-1.5 font-display text-base font-semibold">{t("setupRail.heading")}</p>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground">
            {t("setupRail.body")}
          </p>
          <div className="mt-3 flex gap-1">
            {status.steps.map((s) => (
              <span
                key={s.key}
                className={`h-[3px] w-full rounded-full ${s.done ? "bg-accent-500" : "bg-muted"}`}
              />
            ))}
          </div>
        </div>
        <div>
          {status.steps.map((s, i) => (
            <SetupStepRow
              key={s.key}
              index={i + 1}
              title={t(TITLE_KEYS[s.key])}
              hint={s.done ? t(HINT_KEYS[s.key].done) : t(HINT_KEYS[s.key].todo)}
              done={s.done}
              block={s.blocksIssue ? { label: t("setupRail.blocksIssue"), tone: "risk" } : null}
              expanded={open === s.key}
              onToggle={() => toggle(s.key)}
            >
              {s.key === "letterhead" && <LetterheadStep orgId={orgId} onDone={() => setOpen(null)} />}
              {s.key === "terms" && <TermsStep orgId={orgId} onDone={() => setOpen(null)} />}
              {s.key === "countersign" && <CountersignStep orgId={orgId} onDone={() => setOpen(null)} />}
            </SetupStepRow>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
