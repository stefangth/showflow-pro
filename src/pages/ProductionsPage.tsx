import { useEffect, useMemo, useState } from "react";
import { Reorder } from "framer-motion";
import { useAuth } from "@/features/auth/AuthContext";
import { useShows, useArchiveShow, useDeleteShow, useReorderShows, type ShowWithStats } from "@/hooks/useShows";
import { isSyncedShow, canHardDeleteShow } from "@/lib/catalog";
import { showSlots } from "@/lib/settings";
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

type StatusFilter = "active" | "archived" | "all";

export default function ProductionsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { data: shows, isLoading, isError } = useShows();
  const archive = useArchiveShow();
  const del = useDeleteShow();
  const reorder = useReorderShows();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShowWithStats | null>(null);
  const [order, setOrder] = useState<ShowWithStats[]>([]);

  const filtered = useMemo(() => {
    const list = shows ?? [];
    if (statusFilter === "all") return list;
    return list.filter((s) => s.status === statusFilter);
  }, [shows, statusFilter]);

  useEffect(() => { setOrder(filtered); }, [filtered]);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (s: ShowWithStats) => { setEditing(s); setFormOpen(true); };

  const persistOrder = () => reorder.mutate(order.map((s) => s.id));

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

  const renderRow = (s: ShowWithStats, draggable: boolean) => {
    const slots = showSlots(s);
    const synced = isSyncedShow(s);
    const deletable = isAdmin && canHardDeleteShow({ synced, dateCount: s.dateCount });
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0">
        {draggable && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{showLabel(s)}</p>
          <p className="text-xs text-muted-foreground truncate">{s.category || "—"}</p>
        </div>
        <div className="w-28 text-sm tabular-nums text-muted-foreground">
          {slots ? `${slots.main_cast} + ${slots.understudies}` : <Badge variant="secondary" className="bg-destructive/10 text-destructive text-xs">Unconfigured</Badge>}
        </div>
        <div className="w-20 text-sm text-muted-foreground">{s.dateCount} date{s.dateCount === 1 ? "" : "s"}</div>
        <div className="w-24">
          {synced && <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs">Synced</Badge>}
          {s.status === "archived" && <Badge variant="secondary" className="text-xs">Archived</Badge>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={() => openEdit(s)} aria-label={`Edit ${showLabel(s)}`}><Pencil className="h-4 w-4" /></Button>
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
                  <AlertDialogDescription>This permanently removes "{showLabel(s)}". This cannot be undone.</AlertDialogDescription>
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

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (order.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No productions yet. Create your first one.</CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          {reorderable ? (
            <Reorder.Group axis="y" values={order} onReorder={setOrder}>
              {order.map((s) => (
                <Reorder.Item key={s.id} value={s} onDragEnd={persistOrder}>
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
