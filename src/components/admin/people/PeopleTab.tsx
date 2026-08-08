// src/components/admin/people/PeopleTab.tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchOrgInvitations, acceptInviteUrl } from "@/data/invitations";
import { useOrgMembers, useRemoveOrgMember, useSetOrgMemberRole } from "@/hooks/useOrgMembers";
import { useInvitationMutations } from "@/hooks/useInvitationMutations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { filterPeople } from "./peopleMatch";
import { InviteBar } from "./InviteBar";
import { BulkInviteDialog } from "./BulkInviteDialog";
import { InviteRow } from "./InviteRow";
import { MemberRow } from "./MemberRow";

/** One searchable people directory: invite bar on top, pending + members below. */
export function PeopleTab() {
  const { currentOrg, user } = useAuth();
  const [search, setSearch] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [target, setTarget] = useState<{ user_id: string; email: string | null } | null>(null);

  const { data: invites, isError: invitesError } = useQuery({
    queryKey: ["org-invitations", currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchOrgInvitations(supabase, currentOrg!.id),
  });
  const { data: members, isLoading, isError, error } = useOrgMembers(currentOrg?.id);
  const remove = useRemoveOrgMember(currentOrg?.id ?? "");
  const setRole = useSetOrgMemberRole(currentOrg?.id ?? "");
  const { resend, revoke } = useInvitationMutations(currentOrg?.id);

  const allMembers = useMemo(() => members ?? [], [members]);
  const pendingInvites = useMemo(
    () => (invites ?? []).filter((i) => i.status === "pending"),
    [invites],
  );
  const filtered = useMemo(
    () => filterPeople(search, allMembers, pendingInvites),
    [search, allMembers, pendingInvites],
  );
  const hasSearch = search.trim().length > 0;

  const copyLink = async (token: string) => {
    try { await navigator.clipboard?.writeText(acceptInviteUrl(token)); toast.success("Invite link copied"); }
    catch { toast.error("Could not copy link"); }
  };

  const showPending = filtered.invites.length > 0;
  const showMembers = filtered.members.length > 0;
  const nothing = hasSearch && !showPending && !showMembers;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="font-display">Invite people</CardTitle></CardHeader>
        <CardContent>
          <InviteBar members={allMembers} invites={pendingInvites} onOpenBulk={() => setBulkOpen(true)} />
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search people" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading && <Skeleton className="h-10 w-full" />}
      {isError && <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}
      {invitesError && <Alert variant="destructive"><AlertDescription>Failed to load pending invitations.</AlertDescription></Alert>}

      {showPending && (
        <Card>
          <CardHeader><CardTitle className="font-display text-base">Pending invitations</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {filtered.invites.map((inv) => (
              <InviteRow key={inv.id} invite={inv} onCopyLink={copyLink} onResend={(id) => resend.mutate(id)} onRevoke={(id) => revoke.mutate(id)} />
            ))}
          </CardContent>
        </Card>
      )}

      {showMembers && (
        <Card>
          <CardHeader><CardTitle className="font-display text-base">Members</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {filtered.members.map((m) => (
              <MemberRow
                key={m.user_id}
                member={m}
                isSelf={m.user_id === user?.id}
                setRolePending={setRole.isPending}
                onSetRole={(vars) => setRole.mutate(vars, {
                  onSuccess: () => toast.success("Role updated"),
                  onError: (e) => toast.error((e as Error).message),
                })}
                onRequestRemove={setTarget}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {nothing && <p className="text-sm text-muted-foreground text-center py-6">No people match "{search.trim()}".</p>}
      {!hasSearch && allMembers.length === 0 && !isLoading && !isError && (
        <p className="text-sm text-muted-foreground text-center py-6">No members yet.</p>
      )}

      <BulkInviteDialog open={bulkOpen} onOpenChange={setBulkOpen} members={allMembers} invites={pendingInvites} />

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
            <AlertDialogAction onClick={() => {
              if (!target) return;
              remove.mutate(target.user_id, {
                onSuccess: () => toast.success("Member removed"),
                onError: (e) => toast.error((e as Error).message),
              });
              setTarget(null);
            }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
