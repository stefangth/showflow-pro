import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { ROUTES } from "@/config/app.config";
import { fetchPlatformOrgStats, setOrgStatus, type OrgStat } from "@/data/platform";
import { formatLastActivity } from "./platformFormat";
import { NewOrgDialog } from "./NewOrgDialog";
import { EditOrgDialog } from "./EditOrgDialog";
import { OrgInvitePopover } from "./OrgInvitePopover";
import { OrgMembersPopover } from "./OrgMembersPopover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogIn, Pause, Play, Pencil } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function OrganizationsTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { switchOrg } = useAuth();
  const [editing, setEditing] = useState<OrgStat | null>(null);
  const [toSuspend, setToSuspend] = useState<OrgStat | null>(null);

  const { data: orgs, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "org-stats"],
    queryFn: () => fetchPlatformOrgStats(supabase),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "suspended" }) => setOrgStatus(supabase, id, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform"] }); toast.success("Org updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const enter = (orgId: string) => { switchOrg(orgId); navigate(ROUTES.DASHBOARD); };

  if (isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[var(--row-h)] w-full" />)}</div>;
  if (isError) return <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><NewOrgDialog /></div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead><TableHead>Slug</TableHead><TableHead>Status</TableHead>
            <TableHead className="text-right">Members</TableHead><TableHead className="text-right">Active artists</TableHead><TableHead className="text-right">Bookings 30d</TableHead>
            <TableHead>Last activity</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(orgs ?? []).map((o) => (
            <TableRow key={o.org_id}>
              <TableCell className="font-medium">{o.name}</TableCell>
              <TableCell className="text-muted-foreground">{o.slug}</TableCell>
              <TableCell><Badge variant={o.status === "suspended" ? "destructive" : "secondary"}>{o.status}</Badge></TableCell>
              <TableCell className="text-right tabular-nums">{o.member_count}</TableCell>
              <TableCell className="text-right tabular-nums">{o.active_artist_count}</TableCell>
              <TableCell className="text-right tabular-nums">{o.bookings_30d}</TableCell>
              <TableCell className="text-muted-foreground">{formatLastActivity(o.last_activity_at)}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <OrgInvitePopover orgId={o.org_id} />
                  <OrgMembersPopover orgId={o.org_id} />
                  <Button size="sm" variant="ghost" onClick={() => setEditing(o)} aria-label="Edit org"><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label={o.status === "suspended" ? "Reactivate" : "Suspend"}
                    onClick={() => o.status === "suspended"
                      ? statusMutation.mutate({ id: o.org_id, status: "active" })
                      : setToSuspend(o)}>
                    {o.status === "suspended" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => enter(o.org_id)}><LogIn className="h-3.5 w-3.5 mr-1" />Enter</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {orgs?.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No organizations yet</TableCell></TableRow>}
        </TableBody>
      </Table>
      <EditOrgDialog org={editing} onClose={() => setEditing(null)} />
      <AlertDialog open={toSuspend !== null} onOpenChange={(o) => !o && setToSuspend(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend organization?</AlertDialogTitle>
            <AlertDialogDescription>Members of {toSuspend?.name} will be blocked from acting until you reactivate it. Data is preserved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (toSuspend) statusMutation.mutate({ id: toSuspend.org_id, status: "suspended" }); setToSuspend(null); }}>Suspend</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
