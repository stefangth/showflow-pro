import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useHireOrdersList, useHireOrderAction } from "@/hooks/useHireOrders";
import { OrdersKpis, committedValue } from "@/components/hireOrders/OrdersKpis";
import { OrdersTable } from "@/components/hireOrders/OrdersTable";
import { OrderSlideOver } from "@/components/hireOrders/OrderSlideOver";
import { SECTION_LABELS } from "@/components/layout/navItems";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatMoney } from "@/lib/hireOrders/money";
import { cn } from "@/lib/utils";
import type { HireOrderStatus } from "@/data/hireOrders";

/** Import from spreadsheet is built in Task 5 — the dialog doesn't exist yet,
 *  so the button stays disabled behind this flag until that task flips it. */
const IMPORT_READY = false;
/** The guided "New order" wizard is built in Task 2 — same forward-reference
 *  gate as IMPORT_READY, kept local to this page for the same reason. */
const NEW_ORDER_READY = false;

type StatusFilter = "all" | HireOrderStatus;

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "issued", label: "Awaiting" },
  { value: "countersigned", label: "Countersigned" },
];

function StatusChips({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-md border border-input bg-background p-0.5">
      {STATUS_CHIPS.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          className={cn(
            "rounded-sm px-3 py-1.5 text-sm transition-colors",
            value === c.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/**
 * V4 tracking dashboard: KPI tiles, a filterable/searchable all-orders table,
 * a row slide-over, and a bulk-select bar for batch issuing. `/hire-orders`,
 * admin/producer, feature-gated on `hire_orders` (ProtectedRoute + the nav
 * item both consult ROUTE_FEATURES / NavItem.feature).
 */
export default function HireOrdersPage() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? "";

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [slideOverId, setSlideOverId] = useState<string | null>(null);

  // Keep the input responsive but only re-query once typing pauses — otherwise
  // every keystroke changes the query key and fires a fresh DB round-trip.
  const debouncedSearch = useDebouncedValue(search.trim(), 250);

  const filters = useMemo(
    () => ({
      status: statusFilter === "all" ? undefined : [statusFilter],
      search: debouncedSearch || undefined,
    }),
    [statusFilter, debouncedSearch],
  );

  const { data: orders, isLoading, isError } = useHireOrdersList(filters);
  // The KPI tiles and header meta line are an always-on org-wide overview,
  // independent of the table's status/search filter (a status chip must not
  // collapse "Issued"/"Value committed" to that subset). Fetch the unfiltered
  // list separately for them; when no filter is active this shares a query key
  // with the list above and dedupes, so it costs nothing in the common case.
  const overview = useHireOrdersList({}).data ?? [];
  const action = useHireOrderAction();
  const rows = orders ?? [];

  const allSelected = rows.length > 0 && rows.every((o) => selected.has(o.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((o) => o.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedRows = rows.filter((o) => selected.has(o.id));
  const canIssueSelected =
    selectedRows.length > 0 && selectedRows.every((o) => o.status === "draft" || o.status === "ready");

  function handleBulkIssue() {
    action.mutate(
      { action: "issue", org_id: orgId, order_ids: Array.from(selected) },
      { onSuccess: () => setSelected(new Set()) },
    );
  }

  const { total, currency } = committedValue(overview);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {SECTION_LABELS.workspace}
          </p>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Hire orders</h1>
          <p className="mt-1 text-muted-foreground">
            {overview.length} order{overview.length === 1 ? "" : "s"} · {formatMoney(total, currency)} committed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!IMPORT_READY}
            title={IMPORT_READY ? undefined : "Coming soon"}
          >
            Import from spreadsheet
          </Button>
          <Button disabled={!NEW_ORDER_READY} title={NEW_ORDER_READY ? undefined : "Coming soon"}>
            New order
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <StatusChips value={statusFilter} onChange={setStatusFilter} />
        <div className="relative min-w-[200px] max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search order number or artist…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2">
          <span className="text-sm text-muted-foreground">{selected.size} selected</span>
          <Button size="sm" onClick={handleBulkIssue} disabled={!canIssueSelected || action.isPending}>
            Issue selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {isError ? (
        <Alert variant="destructive">
          <AlertDescription>Failed to load hire orders.</AlertDescription>
        </Alert>
      ) : (
        <>
          <OrdersKpis orders={overview} />

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <OrdersTable
                  orders={rows}
                  selected={selected}
                  onToggleOne={toggleOne}
                  onToggleAll={toggleAll}
                  onOpen={setSlideOverId}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      <OrderSlideOver
        orderId={slideOverId}
        open={!!slideOverId}
        onOpenChange={(o) => {
          if (!o) setSlideOverId(null);
        }}
      />
    </div>
  );
}
