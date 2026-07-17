import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useHireOrders } from "@/hooks/useHireOrders";
import { OrdersKpis, computeOrderKpis } from "@/components/hireOrders/OrdersKpis";
import { OrdersTable } from "@/components/hireOrders/OrdersTable";
import { OrderSlideOver } from "@/components/hireOrders/OrderSlideOver";
import { NewOrderWizard } from "@/components/hireOrders/NewOrderWizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { HireOrderStatus } from "@/data/hireOrders";

/** Flipped in Task 5 once the spreadsheet-import wizard lands. */
const IMPORT_READY = false;

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

  const [statusChip, setStatusChip] = useState<StatusChip>("all");
  const [search, setSearch] = useState("");
  const [slideOverId, setSlideOverId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: allOrders = [] } = useHireOrders(orgId, {});

  const filters = useMemo(
    () => ({ status: chipToStatusFilter(statusChip), search: search.trim() || undefined }),
    [statusChip, search],
  );
  const { data: filteredOrders = [], isLoading } = useHireOrders(orgId, filters);

  const stats = computeOrderKpis(allOrders);
  const selectedOrder =
    filteredOrders.find((o) => o.id === slideOverId) ?? allOrders.find((o) => o.id === slideOverId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspace</p>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Hire orders</h1>
          <p className="mt-1 text-muted-foreground">
            {stats.totalCount} order{stats.totalCount === 1 ? "" : "s"} · {stats.valueCommitted} committed
          </p>
        </div>
        <div className="flex items-center gap-2">
          {IMPORT_READY && <Button variant="outline">Import from spreadsheet</Button>}
          <Button onClick={() => setWizardOpen(true)}>
            New order
          </Button>
        </div>
      </div>

      <OrdersKpis orders={allOrders} />

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

      <OrderSlideOver
        order={selectedOrder}
        open={!!slideOverId}
        onOpenChange={(open) => { if (!open) setSlideOverId(null); }}
        orgId={orgId ?? ""}
      />

      <NewOrderWizard open={wizardOpen} onOpenChange={setWizardOpen} orgId={orgId} />
    </div>
  );
}
