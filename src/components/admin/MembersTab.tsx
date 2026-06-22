import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrgMembers, useRemoveOrgMember, useSetOrgMemberRole } from "@/hooks/useOrgMembers";
import type { AppRole } from "@/config/app.config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ALL_ROLES: AppRole[] = ["admin", "producer", "artist"];

/** Org-admin member management: list members, edit their roles, and remove them. */
export function MembersTab() {
  const { currentOrg, user } = useAuth();
  const { data: members, isLoading, isError, error } = useOrgMembers(currentOrg?.id);
  const remove = useRemoveOrgMember(currentOrg?.id ?? "");
  const setRole = useSetOrgMemberRole(currentOrg?.id ?? "");
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
              <p className="text-xs text-muted-foreground">
                {m.last_sign_in_at ? `Last seen ${format(new Date(m.last_sign_in_at), "dd/MM/yyyy HH:mm")}` : "Never signed in"}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {m.roles.map((r) => <Badge key={r} variant="secondary" className="text-xs capitalize">{r}</Badge>)}
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" aria-label={`Edit roles for ${m.email}`}>
                    <SettingsIcon className="h-3 w-3 mr-1" />Roles
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="end">
                  {ALL_ROLES.map((r) => {
                    const has = m.roles.includes(r);
                    return (
                      <button
                        key={r}
                        disabled={setRole.isPending}
                        onClick={() => setRole.mutate(
                          { userId: m.user_id, role: r, action: has ? "remove" : "add" },
                          { onSuccess: () => toast.success("Role updated"), onError: (e) => toast.error((e as Error).message) },
                        )}
                        className="flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-muted text-left capitalize disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check className={cn("h-4 w-4 mr-2", has ? "opacity-100" : "opacity-0")} />
                        {r}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
              <Button
                size="sm" variant="ghost" className="h-7 px-2 text-xs"
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
