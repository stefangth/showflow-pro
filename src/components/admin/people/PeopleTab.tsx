// src/components/admin/people/PeopleTab.tsx
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchOrgInvitations, acceptInviteUrl } from "@/data/invitations";
import {
  useOrgMembers, useRemoveOrgMember, useSetOrgMemberRole,
  useRemovedMembers, useRestoreOrgMember, useClearRemovedMember, usePurgeRemovedUser,
} from "@/hooks/useOrgMembers";
import { useInvitationMutations } from "@/hooks/useInvitationMutations";
import { toErrorMessage } from "@/lib/errors";
import type { RemovedMember } from "@/data/members";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buildPeople, filterPeopleList, filterInvitesByEmail } from "./peopleMatch";
import { InviteBar } from "./InviteBar";
import { BulkInviteDialog } from "./BulkInviteDialog";
import { InviteRow } from "./InviteRow"; // still used by the read-only history card
import { PersonRow } from "./PersonRow";
import { RemovedPersonRow } from "./RemovedPersonRow";

/** One searchable people directory: invite bar on top, pending + members below. */
export function PeopleTab() {
  const { currentOrg, user } = useAuth();
  const [search, setSearch] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [target, setTarget] = useState<{ user_id: string; email: string | null } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; email: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RemovedMember | null>(null);
  const [deleteText, setDeleteText] = useState("");

  const { data: invites, isError: invitesError, isLoading: invitesLoading } = useQuery({
    queryKey: ["org-invitations", currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchOrgInvitations(supabase, currentOrg!.id),
  });
  const { data: members, isLoading, isError, error } = useOrgMembers(currentOrg?.id);
  const { data: removed } = useRemovedMembers(currentOrg?.id);
  const remove = useRemoveOrgMember(currentOrg?.id ?? "");
  const setRole = useSetOrgMemberRole(currentOrg?.id ?? "");
  const restore = useRestoreOrgMember(currentOrg?.id ?? "");
  const clearRemoved = useClearRemovedMember(currentOrg?.id ?? "");
  const purge = usePurgeRemovedUser(currentOrg?.id ?? "");
  const { resend, revoke } = useInvitationMutations(currentOrg?.id);

  const allMembers = useMemo(() => members ?? [], [members]);
  const pendingInvites = useMemo(
    () => (invites ?? []).filter((i) => i.status === "pending"),
    [invites],
  );
  // Accepted/revoked invitations, newest-first (fetchOrgInvitations already orders desc),
  // shown as read-only history so the pane isn't only "pending".
  const historyInvites = useMemo(
    () => (invites ?? []).filter((i) => i.status === "accepted" || i.status === "revoked"),
    [invites],
  );
  const people = useMemo(() => buildPeople(allMembers, pendingInvites), [allMembers, pendingInvites]);
  const filteredPeople = useMemo(() => filterPeopleList(search, people), [search, people]);
  const invitedPeople = useMemo(() => filteredPeople.filter((p) => p.status === "invited"), [filteredPeople]);
  const activePeople = useMemo(() => filteredPeople.filter((p) => p.status === "active"), [filteredPeople]);
  // Search scopes the whole pane: history responds to the same query (empty query passes through).
  const filteredHistory = useMemo(() => filterInvitesByEmail(search, historyInvites), [search, historyInvites]);
  const removedMembers = useMemo(() => removed ?? [], [removed]);
  const filteredRemoved = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return removedMembers;
    return removedMembers.filter(
      (r) => (r.display_name ?? "").toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q),
    );
  }, [search, removedMembers]);
  const hasSearch = search.trim().length > 0;
  // Duplicate detection needs both lists; if either query is still loading or has
  // errored (a state that never self-resolves), hold invites so a real duplicate
  // can't slip through an empty members/invites list. The hint explains the disabled
  // Invite button; an error state persists, so say so rather than "still checking".
  const dedupeHint = (isLoading || invitesLoading)
    ? "Checking existing people…"
    : (isError || invitesError)
    ? "Can't verify duplicates right now, so new invites are paused."
    : null;

  const copyLink = async (token: string) => {
    try { await navigator.clipboard?.writeText(acceptInviteUrl(token)); toast.success("Invite link copied"); }
    catch { toast.error("Could not copy link"); }
  };

  const showHistory = filteredHistory.length > 0;

  const renderPerson = (p: (typeof filteredPeople)[number]) => (
    <PersonRow
      key={p.emailKey}
      person={p}
      isSelf={p.userId === user?.id}
      onCopyLink={copyLink}
      onResend={(id) => resend.mutate(id)}
      onRevoke={(id) => setRevokeTarget({ id, email: p.email })}
      onSetRole={(vars) => setRole.mutate(vars, {
        onSuccess: () => toast.success("Role updated"),
        onError: (e) => toast.error(toErrorMessage(e)),
      })}
      onRequestRemove={setTarget}
      resendPending={resend.isPending && resend.variables === p.invitation?.id}
      revokePending={revoke.isPending && revoke.variables === p.invitation?.id}
      setRolePending={setRole.isPending}
    />
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="font-display text-base">Invite people</CardTitle></CardHeader>
        <CardContent>
          <InviteBar
            members={allMembers}
            invites={pendingInvites}
            dedupeHint={dedupeHint}
            onOpenBulk={() => setBulkOpen(true)}
            onResend={(id) => resend.mutate(id)}
            resendPendingId={resend.isPending ? (resend.variables ?? null) : null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="font-display text-base">People</CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search people"
              aria-label="Search people"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Announce filter results to assistive tech without moving focus (WCAG 4.1.3). */}
          <p className="sr-only" role="status" aria-live="polite">
            {hasSearch
              ? `${filteredPeople.length} ${filteredPeople.length === 1 ? "person matches" : "people match"} your search${filteredHistory.length > 0 ? `, plus ${filteredHistory.length} in invitation history` : ""}.`
              : ""}
          </p>
          {invitesError && (
            <Alert variant="destructive"><AlertDescription>Failed to load pending invitations.</AlertDescription></Alert>
          )}
          {isLoading ? (
            <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
          ) : isError ? (
            <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>
          ) : filteredPeople.length === 0 && filteredRemoved.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {hasSearch
                ? (filteredHistory.length > 0
                    ? `No members or pending invites match "${search.trim()}". See invitation history below.`
                    : `No members or pending invites match "${search.trim()}".`)
                : "No people yet."}
            </p>
          ) : (
            <>
              {invitedPeople.length > 0 && (
                <PeopleGroup label="Pending invites" count={invitedPeople.length}>
                  {invitedPeople.map(renderPerson)}
                </PeopleGroup>
              )}
              {activePeople.length > 0 && (
                <PeopleGroup label="Members" count={activePeople.length}>
                  {activePeople.map(renderPerson)}
                </PeopleGroup>
              )}
              {filteredRemoved.length > 0 && (
                <PeopleGroup label="Recently removed" count={filteredRemoved.length}>
                  {filteredRemoved.map((m) => (
                    <RemovedPersonRow
                      key={m.user_id}
                      member={m}
                      undoPending={restore.isPending && restore.variables === m.user_id}
                      onUndo={(uid) => restore.mutate(uid, {
                        onSuccess: () => toast.success("Member restored"),
                        onError: (e) => toast.error(toErrorMessage(e)),
                      })}
                      onClear={(rm) => clearRemoved.mutate(rm.user_id, {
                        onSuccess: () => toast.success("Removed from list"),
                        onError: (e) => toast.error(toErrorMessage(e)),
                      })}
                      onDelete={(rm) => { setDeleteTarget(rm); setDeleteText(""); }}
                    />
                  ))}
                </PeopleGroup>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {showHistory && (
        <Card>
          <CardHeader><CardTitle className="font-display text-base">Invitation history</CardTitle></CardHeader>
          <CardContent>
            <div role="list" aria-label="Invitation history" className="divide-y divide-border">
              {filteredHistory.map((inv) => (
                <InviteRow key={inv.id} invite={inv} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <BulkInviteDialog open={bulkOpen} onOpenChange={setBulkOpen} members={allMembers} invites={pendingInvites} dedupeHint={dedupeHint} />

      <AlertDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {target?.email} loses access to this organization now. Their account, artist profile, and bookings are kept, and you can undo this from the list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (!target) return;
              const uid = target.user_id;
              remove.mutate(uid, {
                onSuccess: () => toast.success("Member removed", {
                  action: {
                    label: "Undo",
                    onClick: () => restore.mutate(uid, {
                      onSuccess: () => toast.success("Member restored"),
                      onError: (e) => toast.error(toErrorMessage(e)),
                    }),
                  },
                }),
                onError: (e) => toast.error(toErrorMessage(e)),
              });
              setTarget(null);
            }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={revokeTarget !== null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.email} will no longer be able to accept this invitation. You can invite them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (!revokeTarget) return;
              // useInvitationMutations.revoke already toasts + invalidates on success/error;
              // don't pass call-site callbacks or the toast fires twice.
              revoke.mutate(revokeTarget.id);
              setRevokeTarget(null);
            }}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteText(""); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this account?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.email} has no other organization, so this erases their account everywhere: login removed and personal data anonymized. This cannot be undone. Type{" "}
              <span className="font-medium">{deleteTarget?.email}</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder={deleteTarget?.email ?? ""}
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            aria-label="Type the email to confirm deletion"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!deleteTarget || deleteText !== deleteTarget.email || purge.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!deleteTarget) return;
                purge.mutate(deleteTarget.user_id, {
                  onSuccess: (res) => {
                    toast.success(res.retained ? "Removed from list (account kept)" : "Account deleted");
                    setDeleteTarget(null);
                    setDeleteText("");
                  },
                  onError: (err) => toast.error(toErrorMessage(err)),
                });
              }}
            >
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A labelled, counted subgroup ("Pending invites · 3" / "Members · 4") wrapping divided rows. */
function PeopleGroup({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const headingId = `people-group-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section>
      <h3 id={headingId} className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">· {count}</span>
      </h3>
      <div role="list" aria-labelledby={headingId} className="divide-y divide-border">{children}</div>
    </section>
  );
}
