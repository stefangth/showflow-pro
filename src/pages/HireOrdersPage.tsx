import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { useEntitlements, useModuleGate } from "@/hooks/useEntitlements";
import { useHireOrders, useDatesReadyForHireOrder } from "@/hooks/useHireOrders";
import { OrdersKpis } from "@/components/hireOrders/OrdersKpis";
import { computeOrderKpis } from "@/lib/hireOrders/kpis";
import { OrdersTable } from "@/components/hireOrders/OrdersTable";
import { OrderSlideOver } from "@/components/hireOrders/OrderSlideOver";
import { NewOrderWizard } from "@/components/hireOrders/NewOrderWizard";
import { HireOrderImportDialog } from "@/components/hireOrders/import/HireOrderImportDialog";
import { SetupRail } from "@/components/hireOrders/setup/SetupRail";
import { useSetupRailVisible } from "@/components/hireOrders/setup/useSetupRailVisible";
import { FeatureOffBanner } from "@/components/layout/FeatureOffBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { HireOrderStatus } from "@/data/hireOrders";
import { ROUTES } from "@/config/app.config";
import { cn } from "@/lib/utils";

/** The spreadsheet-import wizard shipped in Task 5. */
const IMPORT_READY = true;

type StatusChip = "all" | "draft" | "ready" | "issued" | "countersigned";

/** "Awaiting" reads as the issued status per the V4 design (matches
 *  HireOrderStatusBadge's "Awaiting countersign" label for status "issued"). */
const STATUS_CHIPS: { value: StatusChip; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "issued", label: "Awaiting" },
  { value: "countersigned", label: "Countersigned" },
];

function chipToStatusFilter(chip: StatusChip): HireOrderStatus[] | undefined {
  return chip === "all" ? undefined : [chip];
}

/**
 * V4 tracking dashboard at `/hire-orders`: KPI tiles, a filterable/searchable
 * all-orders table with bulk select -> batch issue, and a row slide-over.
 * Admin/producer only (route-gated), feature-gated on `hire_orders`.
 *
 * Two queries are made deliberately: `allOrders` (no filters) feeds the KPI
 * tiles and the meta line so they always read as a stable org-wide overview,
 * while `filteredOrders` (the active status chip + search) drives the table.
 * Sharing one query would make the KPI tiles collapse to zero whenever a
 * status chip narrows the table, which defeats their purpose.
 */
export default function HireOrdersPage() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  // TWO gates, deliberately, because they answer different questions.
  //
  // `allow` / `pending` (useModuleGate) governs what this page OFFERS. It neither
  // fails open while entitlements load -- which would mount live controls for an org
  // that may turn out unentitled -- nor flashes the off-state banner at an entitled
  // org, because `pending` lets both the banner and the controls stay quiet until the
  // answer is known. That replaces the old `entitlementsLoading || ...` fail-open,
  // which existed only to suppress that flash and had no better tool at the time.
  const { allow: featureOn, pending: featurePending } = useModuleGate("hire_orders");
  // `entitledForWrites` governs what this page lets anyone CHANGE, and is the raw
  // entitlement: no fail-open, and no super-admin exemption. useModuleGate exempts
  // super-admins so god-mode can read any org's surfaces, which is right for viewing
  // and wrong here -- app_settings RLS checks role, not entitlement, so a super-admin
  // confirming the setup rail on an unentitled org would really write those settings
  // and configure a module the org does not have, next to a banner saying changes
  // cannot be saved.
  const { features } = useEntitlements();
  const entitledForWrites = features.has("hire_orders");

  const [statusChip, setStatusChip] = useState<StatusChip>("all");
  const [search, setSearch] = useState("");
  // The input itself stays controlled by `search` on every keystroke so
  // typing feels instant; only the value that drives the query is debounced,
  // so a short search term collapses a burst of keystrokes into a single
  // pair of Supabase round trips instead of firing one per key.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [slideOverId, setSlideOverId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 275);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: allOrders = [], isLoading: allOrdersLoading } = useHireOrders(orgId, {});

  const filters = useMemo(
    () => ({ status: chipToStatusFilter(statusChip), search: debouncedSearch.trim() || undefined }),
    [statusChip, debouncedSearch],
  );
  const { data: filteredOrders = [], isLoading } = useHireOrders(orgId, filters);

  // Nothing here can be actioned while the module is off, so don't read for it.
  const { data: ready } = useDatesReadyForHireOrder(featureOn ? orgId : null);
  const readyCount = ready?.readyIds.length ?? 0;
  // Settled-and-empty, not just empty: an org that does have orders would otherwise
  // flash "N dates are ready" on every mount, before the first page arrived.
  const noOrdersYet = !allOrdersLoading && allOrders.length === 0;

  // A null child does not collapse a grid track, so the page has to know whether the
  // rail will render before it picks its column template. Gated on the entitlement
  // too: app_settings RLS checks role, not entitlement, so an unentitled org's setup
  // writes would land, directly contradicting the FeatureOffBanner above.
  // Gated on the raw entitlement so the three app_settings reads never fire for an
  // org that cannot use them. The `&&` stays as well as the null argument: this is
  // the gate that keeps an interactive setup checklist off a page already showing
  // "changes cannot be saved", and it should not depend on another module's
  // null-handling to hold.
  const setupRailVisible = useSetupRailVisible(entitledForWrites ? orgId : null);
  const showSetupRail = entitledForWrites && setupRailVisible;

  const stats = computeOrderKpis(allOrders);
  const selectedOrder =
    filteredOrders.find((o) => o.id === slideOverId) ?? allOrders.find((o) => o.id === slideOverId) ?? null;

  return (
    <div className="space-y-6">
      {/* `!featurePending` is what stops the old flash: while entitlements resolve,
          featureOn is false but the answer is not known yet, so say nothing rather
          than telling an entitled org its module is off. */}
      {!featureOn && !featurePending && <FeatureOffBanner feature="hire_orders" />}

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspace</p>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Hire orders</h1>
          <p className="mt-1 text-muted-foreground">
            {stats.totalCount} order{stats.totalCount === 1 ? "" : "s"} · {stats.valueCommitted} committed
          </p>
        </div>
        <div className="flex items-center gap-2">
          {IMPORT_READY && (
            <Button variant="outline" disabled={!featureOn} onClick={() => setImportOpen(true)}>
              Import from spreadsheet
            </Button>
          )}
          <Button disabled={!featureOn} onClick={() => setWizardOpen(true)}>
            New order
          </Button>
        </div>
      </div>

      <OrdersKpis orders={allOrders} />

      <div
        data-testid="orders-layout"
        className={cn("grid gap-5", showSetupRail && "lg:grid-cols-[1fr_340px] lg:items-start")}
      >
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              {STATUS_CHIPS.map((chip) => (
                <Button
                  key={chip.value}
                  size="sm"
                  variant={statusChip === chip.value ? "default" : "outline"}
                  onClick={() => setStatusChip(chip.value)}
                >
                  {chip.label}
                </Button>
              ))}
            </div>
            <div className="relative min-w-[200px] max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search order number or artist"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {!orgId ? (
            <p className="py-12 text-center text-muted-foreground">Select an organization to view hire orders.</p>
          ) : isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : (
            <OrdersTable orders={filteredOrders} orgId={orgId} onRowClick={setSlideOverId} />
          )}

          {noOrdersYet && readyCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {readyCount} {readyCount === 1 ? "date is" : "dates are"} fully cast and ready for an order.{" "}
              {/* text-primary, not the accent-600 stop: the numbered accent stops are
                  immutable across modes and pair with an accent background, so bare on
                  a card this link sat near 2.3:1 in dark. */}
              <Link to={ROUTES.BOOKINGS} className="text-primary underline-offset-2 hover:underline">
                Generate from Shows and bookings
              </Link>
              , or use New order above.
            </p>
          )}
        </div>
        {showSetupRail && <SetupRail orgId={orgId} />}
      </div>

      <OrderSlideOver
        order={selectedOrder}
        open={!!slideOverId}
        onOpenChange={(open) => { if (!open) setSlideOverId(null); }}
        orgId={orgId ?? ""}
      />

      <NewOrderWizard open={wizardOpen} onOpenChange={setWizardOpen} orgId={orgId} />
      <HireOrderImportDialog open={importOpen} onOpenChange={setImportOpen} orgId={orgId} />
    </div>
  );
}
