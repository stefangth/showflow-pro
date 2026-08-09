import { useEffect, useMemo, useState } from "react";
import { ListChecks, Search } from "lucide-react";
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
import { DashboardSetupRail } from "@/components/dashboard/firstRun/DashboardSetupRail";
import { DashboardWelcomeCollapsed } from "@/components/dashboard/firstRun/DashboardWelcomeCollapsed";
import { useModuleOnboardingRail } from "@/components/setup/useModuleOnboardingRail";
import { SetupChecklistSheet } from "@/components/setup/SetupChecklistSheet";
import type { ComposedStep } from "@/lib/dashboard/types";
import { FeatureOffBanner } from "@/components/layout/FeatureOffBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeframeFilter, type TimeframeValue } from "@/components/filters/TimeframeFilter";
import { inTimeframe } from "@/components/filters/filterUtils";
import { orderDate } from "@/lib/hireOrders/orderDate";
import type { HireOrderStatus } from "@/data/hireOrders";
import { ROUTES } from "@/config/app.config";

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
  // `entitledForWrites` governs what this page lets anyone CHANGE. It must NOT fail open
  // while entitlements load: useEntitlements().features falls back to each feature's
  // registry default during that window (hire_orders defaults off, but do not rely on
  // that), so a default-on module would briefly read as entitled and mount a live
  // settings-write surface. Gate on !loading AND the resolved entitlement -- the same
  // "treat loading as not-entitled" stance useModuleGate takes with its `pending` flag.
  // No super-admin exemption (useModuleGate has one, right for viewing, wrong here):
  // app_settings RLS checks role, not entitlement, so a super-admin confirming the setup
  // rail on an unentitled org would really write those settings.
  const { features, isLoading: entitlementsLoading } = useEntitlements();
  const entitledForWrites = !entitlementsLoading && features.has("hire_orders");

  const [statusChip, setStatusChip] = useState<StatusChip>("all");
  // Defaults to All time (not the Upcoming preset the sibling booking surfaces
  // use): unlike a show date, a hire order stays actionable after its
  // engagement date passes (issue, countersign, chase an Overdue one), so
  // hiding past orders by default would hide exactly the ones most likely to
  // need attention.
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
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
  const { data: statusSearchFilteredOrders = [], isLoading } = useHireOrders(orgId, filters);
  // Timeframe is a client-side pass over the status/search-filtered set, by
  // the order's date -- the linked show_date's date, or (for a manual order
  // with no linked show_date) its own snapshot `data.date` via orderDate().
  // An order with neither (shouldn't normally happen -- every order
  // snapshots a date one way or the other) is never hidden by this filter
  // rather than silently dropped.
  const filteredOrders = useMemo(
    () =>
      statusSearchFilteredOrders.filter((o) => {
        const d = orderDate(o);
        return d ? inTimeframe(d, timeframe) : true;
      }),
    [statusSearchFilteredOrders, timeframe],
  );

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
  //
  // `rail.mode` is one of "banner" (full wizard), "collapsed" (compact bar,
  // re-expandable), "button" (setup complete, permanent header re-entry), or
  // "hidden" (nothing actionable). All four render states below key off this
  // single value, behind the same write-gate as the rail itself.
  const rail = useModuleOnboardingRail("hire_orders", entitledForWrites ? orgId : null);
  const setupMode = entitledForWrites ? rail.mode : "hidden";
  const [setupSheetOpen, setSetupSheetOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<string | undefined>(undefined);
  const openSetupAt = (step: ComposedStep) => { setSetupStep(step.key); setSetupSheetOpen(true); };

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
          {setupMode === "button" && (
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => { setSetupStep(undefined); setSetupSheetOpen(true); }}
            >
              <ListChecks className="h-4 w-4" />
              Setup checklist
            </Button>
          )}
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

      {/* The dashboard-style setup rail, module-scoped, above the KPIs. Its step
          buttons open the inline checklist Sheet at that step (the "do it here"
          surface); Hide dismisses it on this surface only. */}
      {setupMode === "banner" && (
        <DashboardSetupRail
          layout="banner"
          eyebrow={rail.eyebrow}
          title={rail.title}
          body={rail.body}
          complete={false}
          steps={rail.steps}
          rules={rail.rules}
          offFooters={rail.offFooters}
          progressLabel={rail.progressLabel}
          progressFilled={rail.progressFilled}
          progressTotal={rail.progressTotal}
          onStepAction={openSetupAt}
          onClose={rail.dismiss}
          onDismiss={rail.dismiss}
        />
      )}
      {setupMode === "collapsed" && (
        <DashboardWelcomeCollapsed
          label={rail.collapsedLabel}
          hint={rail.collapsedHint}
          ctaLabel={rail.collapsedCta}
          onOpen={rail.expand}
        />
      )}

      <OrdersKpis orders={allOrders} />

      <div data-testid="orders-layout" className="space-y-4">
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
          <TimeframeFilter value={timeframe} onChange={setTimeframe} />
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

      <SetupChecklistSheet
        feature="hire_orders"
        orgId={entitledForWrites ? orgId : null}
        open={setupSheetOpen}
        onOpenChange={setSetupSheetOpen}
        initialStep={setupStep}
      />

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
