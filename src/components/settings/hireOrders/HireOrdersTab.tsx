import { useAuth } from "@/features/auth/AuthContext";
import { useFeature } from "@/hooks/useEntitlements";
import { useSettingsAudit } from "@/hooks/useSettingsAudit";
import { formatDateDMY } from "@/lib/dates";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LetterheadCard } from "./LetterheadCard";
import { OrderDefaultsCard, OrderNumberingCard } from "./OrderDefaultsCard";
import { TermsVariantsCard } from "./TermsVariantsCard";
import { CountersignCard } from "./CountersignCard";

/**
 * Every app_settings key this tab owns, exactly as spec §2.6. Consumed by the rail's
 * useSettingsAudit for the change-history panel. Mirrors BOOKING_AUDIT_KEYS in shape
 * and purpose (BookingFlowTab.tsx:29-36). Unlike that tab, each card here saves
 * itself independently (the PlatformDefaultsTab idiom), so this list has no
 * page-level dirty-tracking counterpart to feed.
 */
export const HIRE_ORDER_AUDIT_KEYS = [
  "hire_order_letterhead",
  "hire_order_terms",
  "hire_order_numbering",
  "hire_order_defaults",
  "hire_order_countersign",
];

const KEY_LABELS: Record<string, string> = {
  hire_order_letterhead: "Letterhead",
  hire_order_terms: "Terms",
  hire_order_numbering: "Numbering",
  hire_order_defaults: "Order defaults",
  hire_order_countersign: "Countersign mode",
};

function describeEntry(entry: { key: string }): string {
  return `${KEY_LABELS[entry.key] ?? entry.key} updated`;
}

/** Thin local rail (change history only): the cards on this tab save independently,
 *  so there is no shared dirty/save state for a rail to drive, unlike FlowRail which
 *  is deeply coupled to BookingFlow-specific preview rendering and not reusable here. */
function HireOrdersRail() {
  const audit = useSettingsAudit(HIRE_ORDER_AUDIT_KEYS);
  return (
    <div className="flex flex-col gap-3 lg:sticky lg:top-4">
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">About this tab</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Each card saves independently. Changes apply to the next hire order generated for this organization,
            not to documents already issued.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Change history</p>
          <div className="mt-1">
            {audit.isLoading ? (
              <div className="mt-1.5 space-y-1.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            ) : audit.isError ? (
              <Alert variant="destructive" className="mt-1.5 p-2.5">
                <AlertDescription className="text-xs">Could not load change history.</AlertDescription>
              </Alert>
            ) : (
              <>
                {(audit.data ?? []).length === 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">No changes recorded yet.</p>
                )}
                {(audit.data ?? []).map((e) => (
                  <div key={e.id} className="border-t border-border pt-2 mt-2 first:border-t-0 first:mt-1.5">
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {formatDateDMY(e.created_at.slice(0, 10))} · {e.actorName ?? "System"}
                    </p>
                    <p className="mt-0.5 text-xs">{describeEntry(e)}</p>
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

/** Settings → Hire orders tab: letterhead, defaults, numbering, terms, countersign
 *  mode. Admin-gated by the caller (SettingsPage); self-gated here on the
 *  hire_orders entitlement so the tab renders nothing at all when the org isn't
 *  entitled, even if reached directly (the module ships default-off). */
export function HireOrdersTab() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const entitled = useFeature("hire_orders");

  if (!entitled) return null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <LetterheadCard orgId={orgId} />
        <OrderDefaultsCard orgId={orgId} />
        <OrderNumberingCard orgId={orgId} />
        <TermsVariantsCard orgId={orgId} />
        <CountersignCard orgId={orgId} />
      </div>
      <HireOrdersRail />
    </div>
  );
}
