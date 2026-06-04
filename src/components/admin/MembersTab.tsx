import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrgMembers, useRemoveOrgMember } from "@/hooks/useOrgMembers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Org-admin member management: list members and remove them (guarded by remove_org_member). */
export function MembersTab() {
  const { currentOrg, user } = useAuth();
  const { data: members, isLoading, isError, error } = useOrgMembers(currentOrg?.id);
  const remove = useRemoveOrgMember(currentOrg?.id ?? "");
  const [target, setTarget] = useState<{ user_id: string; email: string | null } | null>(null);

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Members</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-10 w-full" />}
        {isError && <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}
        {(members ?? []).map((m) => (
          <div key={m.user_id} className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border">
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{m.display_name || m.email}</p>
              <p className="text-xs text-muted-foreground truncate">{m.email}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {m.roles.map((r) => <Badge key={r} variant="secondary" className="text-xs capitalize">{r}</Badge>)}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={m.user_id === user?.id}
                onClick={() => setTarget({ user_id: m.user_id, email: m.email })}
              >
                {m.user_id === user?.id ? "You" : "Remove"}
              </Button>
            </div>
          </div>
        ))}
        {members?.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No members yet.</p>}
      </CardContent>

      <AlertDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {target?.email} will lose access to this organization. Their bookings and artist profile are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!target) return;
                remove.mutate(target.user_id, {
                  onSuccess: () => toast.success("Member removed"),
                  onError: (e) => toast.error((e as Error).message),
                });
                setTarget(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
