import { useEffect, useMemo, useRef, useState } from "react";
import { Reorder } from "framer-motion";
import { useAuth } from "@/features/auth/AuthContext";
import { useShows, useArchiveShow, useDeleteShow, useReorderShows, type ShowWithStats } from "@/hooks/useShows";
import { isSyncedShow, canHardDeleteShow, reconcileDragOrder } from "@/lib/catalog";
import { showSlots } from "@/lib/settings";
import { formatDateDMY } from "@/lib/dates";
import { showLabel } from "@/types";
import { ShowFormDialog } from "@/components/catalog/ShowFormDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { GripVertical, Pencil, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useColumnTemplate } from "@/features/editor/EditorContext";
import { useColumnHeaders } from "@/features/editor/useColumnHeaders";
import { ColumnLayoutEditor } from "@/features/editor/ColumnLayoutEditor";

type StatusFilter = "active" | "archived" | "all";

const STATUS_LABEL: Record<string, string> = { active: "Active", archived: "Archived", draft: "Draft" };

/** Tailwind width for a productions column. The first visible column flexes (identity);
 *  all others get a fixed width. */
function colWidth(colId: string, isFirst: boolean): string {
  if (isFirst) return "flex-1 min-w-0";
  switch (colId) {
    case "shows.program":
    case "shows.sub_program": return "w-48 shrink-0";
    case "shows.category": return "w-40 shrink-0";
    case "_computed.slots":
    case "shows.main_cast_slots":
    case "shows.understudy_slots": return "w-28 shrink-0";
    case "_computed.date_count": return "w-20 shrink-0";
    case "shows.status": return "w-32 shrink-0";
    default: return "w-32 shrink-0";
  }
}

export default function ProductionsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { data: shows, isLoading, isError } = useShows();
  const archive = useArchiveShow();
  const del = useDeleteShow();
  const reorder = useReorderShows();

  const { orderedColumns } = useColumnTemplate("shows-productions");
  const columnHeaders = useColumnHeaders(orderedColumns);
  const visibleColumns = useMemo(() => orderedColumns.filter((c) => c.visible), [orderedColumns]);
  const firstColId = visibleColumns[0]?.columnId;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShowWithStats | null>(null);
  const [order, setOrder] = useState<ShowWithStats[]>([]);

  const filtered = useMemo(() => {
    const list = shows ?? [];
    if (statusFilter === "all") return list;
    return list.filter((s) => s.status === statusFilter);
  }, [shows, statusFilter]);

  // Reconcile the local drag order with server/filter data WITHOUT clobbering an
  // in-progress reorder: skip while a drag is active, and only re-seed when the set
  // of ids actually changed (add/remove/filter switch), not on a refetch that
  // returns the same productions — which would otherwise snap the user's edits back.
  const draggingRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current) return;
    setOrder((prev) => reconcileDragOrder(prev, filtered));
  }, [filtered]);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (s: ShowWithStats) => { setEditing(s); setFormOpen(true); };
  const onDragStart = () => { draggingRef.current = true; };
  const persistOrder = () => {
    draggingRef.current = false;
    reorder.mutate(order.map((s) => s.id));
  };

  const onDelete = (s: ShowWithStats) =>
    del.mutate(s.id, { onSuccess: () => toast.success("Production deleted"), onError: (e) => toast.error((e as Error).message) });
  const onArchive = (s: ShowWithStats, archived: boolean) =>
    archive.mutate({ id: s.id, archived }, {
      onSuccess: () => toast.success(archived ? "Production archived" : "Production restored"),
      onError: (e) => toast.error((e as Error).message),
    });

  const reorderable = statusFilter === "active";

  if (isError) {
    return <Alert variant="destructive"><AlertDescription>Failed to load productions.</AlertDescription></Alert>;
  }

  const cellContent = (s: ShowWithStats, colId: string) => {
    const slots = showSlots(s);
    switch (colId) {
      case "shows.program": return s.program || <span className="text-muted-foreground">—</span>;
      case "shows.sub_program": return s.sub_program || <span className="text-muted-foreground">—</span>;
      case "shows.category": return s.category || <span className="text-muted-foreground">—</span>;
      case "shows.main_cast_slots": return s.main_cast_slots ?? <span className="text-muted-foreground">—</span>;
      case "shows.understudy_slots": return s.understudy_slots ?? <span className="text-muted-foreground">—</span>;
      case "shows.sort_order": return s.sort_order ?? <span className="text-muted-foreground">—</span>;
      case "shows.created_at":
        return s.created_at ? formatDateDMY(s.created_at.slice(0, 10)) : <span className="text-muted-foreground">—</span>;
      case "_computed.slots":
        return slots
          ? <span className="tabular-nums">{slots.main_cast} + {slots.understudies}</span>
          : <Badge variant="secondary" className="bg-destructive/10 text-destructive text-xs">Unconfigured</Badge>;
      case "_computed.date_count": return `${s.dateCount} date${s.dateCount === 1 ? "" : "s"}`;
      case "shows.status":
        return (
          <div className="flex items-center gap-1">
            {isSyncedShow(s) && <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs">Synced</Badge>}
            <Badge variant="secondary" className="text-xs">{STATUS_LABEL[s.status] ?? s.status}</Badge>
          </div>
        );
      default: return <span className="text-muted-foreground">—</span>;
    }
  };

  const renderRow = (s: ShowWithStats, draggable: boolean) => {
    const synced = isSyncedShow(s);
    const deletable = isAdmin && canHardDeleteShow({ synced, dateCount: s.dateCount });
    const label = showLabel(s);
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0">
        {draggable && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />}
        {visibleColumns.map((c) => (
          <div
            key={c.columnId}
            className={`${colWidth(c.columnId, c.columnId === firstColId)} text-sm ${c.columnId === firstColId ? "font-medium truncate" : "text-muted-foreground"}`}
          >
            {cellContent(s, c.columnId)}
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={() => openEdit(s)} aria-label={`Edit ${label}`}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => onArchive(s, s.status !== "archived")} aria-label="Toggle archive">
            {s.status === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" data-testid={`delete-${s.id}`} disabled={!deletable}
                  title={deletable ? "Delete production" : synced ? "Synced productions can't be deleted — archive instead" : "Has dates — archive instead"}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this production?</AlertDialogTitle>
                  <AlertDialogDescription>This permanently removes "{label}". This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(s)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Productions</h1>
          <p className="text-muted-foreground mt-1">Your show catalog — slots, status, and order.</p>
        </div>
        <Button onClick={openCreate}>New production</Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ColumnLayoutEditor pageKey="shows-productions" />

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (order.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No productions yet. Create your first one.</CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
            {reorderable && <span className="h-4 w-4 shrink-0" aria-hidden />}
            {columnHeaders.map(({ columnId, headerLabel }) => (
              <div key={columnId} className={colWidth(columnId, columnId === firstColId)}>{headerLabel}</div>
            ))}
            <span className="ml-auto w-[120px] shrink-0" aria-hidden />
          </div>
          {reorderable ? (
            <Reorder.Group axis="y" values={order} onReorder={setOrder}>
              {order.map((s) => (
                <Reorder.Item key={s.id} value={s} onDragStart={onDragStart} onDragEnd={persistOrder}>
                  {renderRow(s, true)}
                </Reorder.Item>
              ))}
            </Reorder.Group>
          ) : (
            order.map((s) => <div key={s.id}>{renderRow(s, false)}</div>)
          )}
        </CardContent></Card>
      ))}

      <ShowFormDialog open={formOpen} onOpenChange={setFormOpen} show={editing} allShows={shows ?? []} />
    </div>
  );
}
