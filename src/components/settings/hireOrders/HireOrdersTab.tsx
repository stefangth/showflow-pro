import { useTranslation } from "react-i18next";
import { useAuth } from "@/features/auth/AuthContext";
import { useFeature } from "@/hooks/useEntitlements";
import { useSettingsAudit } from "@/hooks/useSettingsAudit";
import { formatDateDMY } from "@/lib/dates";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LetterheadCard } from "./LetterheadCard";
import { OrderDefaultsCard } from "./OrderDefaultsCard";
import { NumberingCard } from "./NumberingCard";
import { TermsVariantsCard } from "./TermsVariantsCard";
import { CountersignCard } from "./CountersignCard";
import { PdfTemplateCard } from "./PdfTemplateCard";
import { HIRE_ORDER_AUDIT_KEYS } from "./auditKeys";

const KEY_LABEL_KEYS: Record<string, string> = {
  hire_order_letterhead: "hireOrdersTab.keyLabels.letterhead",
  hire_order_terms: "hireOrdersTab.keyLabels.terms",
  hire_order_numbering: "hireOrdersTab.keyLabels.numbering",
  hire_order_defaults: "hireOrdersTab.keyLabels.orderDefaults",
  hire_order_countersign: "hireOrdersTab.keyLabels.countersign",
  hire_order_copy: "hireOrdersTab.keyLabels.copy",
  hire_order_theme: "hireOrdersTab.keyLabels.theme",
};

function describeEntry(entry: { key: string }, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const labelKey = KEY_LABEL_KEYS[entry.key];
  const label = labelKey ? t(labelKey) : entry.key;
  return t("hireOrdersTab.entryUpdated", { label });
}

/** Thin local rail (change history only): the cards on this tab save independently,
 *  so there is no shared dirty/save state for a rail to drive, unlike FlowRail which
 *  is deeply coupled to BookingFlow-specific preview rendering and not reusable here. */
function HireOrdersRail() {
  const { t } = useTranslation("settingsHireOrders");
  const audit = useSettingsAudit(HIRE_ORDER_AUDIT_KEYS);
  return (
    <div className="flex flex-col gap-3 lg:sticky lg:top-4">
      <Card>
        <CardContent className="p-4">
          {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking */}
          <p className="text-eyebrow font-semibold uppercase tracking-wider text-muted-foreground">{t("hireOrdersTab.rail.aboutTitle")}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("hireOrdersTab.rail.aboutBody")}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking */}
          <p className="text-eyebrow font-semibold uppercase tracking-wider text-muted-foreground">{t("hireOrdersTab.rail.historyTitle")}</p>
          <div className="mt-1">
            {audit.isLoading ? (
              <div className="mt-1.5 space-y-1.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            ) : audit.isError ? (
              <Alert variant="destructive" className="mt-1.5 p-2.5">
                <AlertDescription className="text-xs">{t("hireOrdersTab.rail.historyError")}</AlertDescription>
              </Alert>
            ) : (
              <>
                {(audit.data ?? []).length === 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">{t("hireOrdersTab.rail.historyEmpty")}</p>
                )}
                {(audit.data ?? []).map((e) => (
                  <div key={e.id} className="border-t border-border pt-2 mt-2 first:border-t-0 first:mt-1.5">
                    <p className="font-mono text-eyebrow text-muted-foreground">
                      {formatDateDMY(e.created_at.slice(0, 10))} · {e.actorName ?? t("hireOrdersTab.rail.systemActor")}
                    </p>
                    <p className="mt-0.5 text-xs">{describeEntry(e, t)}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface Props {
  /** Capability floor: cards still render the org's saved values, but a producer
   *  without `edit_hire_order_settings` can't change or save them. Admins always
   *  pass `false` here. */
  readOnly?: boolean;
}

/** Settings → Hire orders tab: letterhead, defaults, numbering, terms, countersign
 *  mode. Admin/producer-gated by the caller (SettingsPage); self-gated here on the
 *  hire_orders entitlement. The off state remains visible so the Modules navigation
 *  never opens an empty panel. */
export function HireOrdersTab({ readOnly = false }: Props) {
  const { t } = useTranslation("settingsHireOrders");
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const entitled = useFeature("hire_orders");

  if (!entitled) {
    return (
      <Alert>
        <AlertDescription>
          {t("hireOrdersTab.disabled")}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      {/* Keyed by org. Each card derives its draft from its own query, so an
          UNTOUCHED card already follows an org switch; an EDITED one cannot,
          because pinning edits is what stops an unrelated refetch wiping work in
          progress. That edit belongs to the org it was made in, so it has to be
          dropped here or Save would write it into the new org. Today the
          entitlement gate above happens to unmount this subtree while the new
          org's entitlements load (hire_orders ships default-off, and useFeature
          reports the registry default while loading) - this key is what makes the
          behavior deliberate rather than a side effect of that flicker.
          SettingsPage keys BookingFlowTab the same way. */}
      <div key={orgId ?? "no-org"} className="space-y-4">
        <LetterheadCard orgId={orgId} readOnly={readOnly} />
        <OrderDefaultsCard orgId={orgId} readOnly={readOnly} />
        <NumberingCard orgId={orgId} readOnly={readOnly} />
        <TermsVariantsCard orgId={orgId} readOnly={readOnly} />
        <PdfTemplateCard orgId={orgId} readOnly={readOnly} />
        <CountersignCard orgId={orgId} readOnly={readOnly} />
      </div>
      <HireOrdersRail />
    </div>
  );
}
