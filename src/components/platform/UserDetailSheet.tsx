import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import {
  usePlatformUsers, useSetMembership, useRemoveMembership, useLinkArtist, useManageUser,
} from "@/hooks/usePlatformUsers";
import { fetchAllOrgs } from "@/data/platform";
import { fetchArtistsLite } from "@/data/hireOrders";
import { ROLES, type AppRole, roleLabel } from "@/config/app.config";
import type { PlatformUser, PlatformUserMembership } from "@/data/platformUsers";
import { formatLastActivity } from "./platformFormat";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/common/IconTooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  user: PlatformUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROLE_OPTIONS = Object.values(ROLES) as AppRole[];

/** The role shown in a membership's Select. A user can hold more than one role
 *  in the same org (e.g. producer + artist); v1 surfaces only the first as the
 *  "primary" role for the swap control. See task-10-report.md for the note. */
function primaryRole(m: PlatformUserMembership): AppRole {
  return m.roles[0] ?? ROLES.ARTIST;
}

export function UserDetailSheet({ user: propUser, open, onOpenChange }: Props) {
  const setMembership = useSetMembership();
  const removeMembership = useRemoveMembership();
  const linkArtist = useLinkArtist();
  const manageUser = useManageUser();

  // Every mutation below invalidates ['platform','users'], so reading the same
  // query here (already fetched/cached by UsersTab) and looking the user up by
  // id keeps this drawer showing fresh membership/role/artist-link data after a
  // mutation refetches, instead of the pre-mutation `propUser` snapshot the
  // caller passed in when the row was clicked. Falls back to the prop when the
  // query has no data yet (or is otherwise empty).
  const { data: platformUsersData } = usePlatformUsers();

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [artistPickerOrgId, setArtistPickerOrgId] = useState<string | null>(null);
  const [orgToRemove, setOrgToRemove] = useState<PlatformUserMembership | null>(null);
  const [suspendConfirmOpen, setSuspendConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [addOrgId, setAddOrgId] = useState("");
  const [addRole, setAddRole] = useState<AppRole>(ROLES.ARTIST);

  const { data: allOrgs } = useQuery({
    queryKey: ["platform", "orgs"],
    queryFn: () => fetchAllOrgs(supabase),
    enabled: open,
  });

  const { data: orgArtists } = useQuery({
    queryKey: ["platform", "org-artists", artistPickerOrgId],
    queryFn: () => fetchArtistsLite(supabase, artistPickerOrgId),
    enabled: open && !!artistPickerOrgId,
  });

  const user = useMemo(
    () => (propUser ? platformUsersData?.users.find((u) => u.id === propUser.id) ?? propUser : null),
    [platformUsersData, propUser],
  );

  const joinedOrgIds = useMemo(
    () => new Set((user?.memberships ?? []).map((m) => m.org_id)),
    [user],
  );
  const availableOrgs = useMemo(
    () => (allOrgs ?? []).filter((o) => !joinedOrgIds.has(o.id)),
    [allOrgs, joinedOrgIds],
  );

  if (!user) return null;

  const deleteConfirmTarget = user.email ?? user.id;

  // The remove and add calls are two separate RPC invocations against
  // platform_set_membership, which rejects removing an org's last admin. If
  // they fired in parallel, that rejection would only stop the remove: the add
  // would still land, leaving the user holding both the old and new role next
  // to a success toast beside the error. Sequencing via mutateAsync means the
  // add never happens unless the remove actually succeeded.
  async function handleRoleChange(membership: PlatformUserMembership, nextRole: AppRole) {
    const currentRole = primaryRole(membership);
    if (nextRole === currentRole) return;
    try {
      await setMembership.mutateAsync(
        { orgId: membership.org_id, userId: user!.id, role: currentRole, action: "remove" },
      );
    } catch (e) {
      toast.error(friendlyError(e));
      return;
    }
    try {
      await setMembership.mutateAsync(
        { orgId: membership.org_id, userId: user!.id, role: nextRole, action: "add" },
      );
      toast.success("Role updated");
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  function handleAddToOrg() {
    if (!addOrgId) return;
    setMembership.mutate(
      { orgId: addOrgId, userId: user!.id, role: addRole, action: "add" },
      {
        onSuccess: () => { toast.success("Added to organization"); setAddOrgId(""); },
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
  }

  function handleRemoveFromOrg() {
    if (!orgToRemove) return;
    removeMembership.mutate(
      { orgId: orgToRemove.org_id, userId: user!.id },
      {
        onSuccess: () => toast.success("Removed from organization"),
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
    setOrgToRemove(null);
  }

  function handleLinkArtist(orgId: string, artistId: string | null) {
    linkArtist.mutate(
      { orgId, userId: user!.id, artistId },
      {
        onSuccess: () => {
          toast.success(artistId ? "Artist linked" : "Artist unlinked");
          setArtistPickerOrgId(null);
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
  }

  function handleChangeEmail() {
    if (!newEmail || newEmail === user!.email) return;
    manageUser.mutate(
      { action: "change_email", target_user_id: user!.id, new_email: newEmail },
      {
        onSuccess: () => {
          toast.success("Login email updated");
          setEmailDialogOpen(false);
          setNewEmail("");
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
  }

  function handleSendReset() {
    manageUser.mutate(
      { action: "send_password_reset", target_user_id: user!.id },
      {
        onSuccess: () => toast.success("Reset link sent"),
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
  }

  function handleSuspendToggle() {
    const action = user!.suspended ? "unsuspend" : "suspend";
    manageUser.mutate(
      { action, target_user_id: user!.id },
      {
        onSuccess: () => toast.success(user!.suspended ? "User reactivated" : "User suspended"),
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
    setSuspendConfirmOpen(false);
  }

  function handleDelete() {
    if (deleteConfirmText !== deleteConfirmTarget) return;
    manageUser.mutate(
      { action: "delete", target_user_id: user!.id },
      {
        onSuccess: () => {
          toast.success("User deleted");
          setDeleteConfirmOpen(false);
          setDeleteConfirmText("");
          onOpenChange(false);
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
  }

  async function handleCopyId() {
    try {
      await navigator.clipboard.writeText(user!.id);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <SheetTitle className="font-display">{user.display_name || user.email || user.id}</SheetTitle>
            <Badge variant={user.suspended ? "destructive" : "secondary"}>
              {user.suspended ? "Suspended" : "Active"}
            </Badge>
          </div>
          <SheetDescription>{user.email}</SheetDescription>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="font-mono truncate">{user.id}</span>
            <IconTooltip label="Copy user id">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-5 w-5 shrink-0"
                aria-label="Copy user id"
                onClick={handleCopyId}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </IconTooltip>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Created {formatLastActivity(user.created_at)}</span>
            <span>Last sign-in {formatLastActivity(user.last_sign_in_at)}</span>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Login email</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => { setNewEmail(user.email ?? ""); setEmailDialogOpen(true); }}
                >
                  Change email
                </Button>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSendReset}
                disabled={manageUser.isPending}
              >
                Send reset link
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Organizations &amp; roles</h3>
            {user.memberships.length === 0 && (
              <p className="text-sm text-muted-foreground">Not a member of any organization.</p>
            )}
            {user.memberships.map((m) => (
              <Card key={m.org_id}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium">{m.org_name}</CardTitle>
                  <IconTooltip
                    label={m.roles.includes("admin")
                      ? "If this is the org's only admin, make someone else an admin first — removal will be blocked otherwise."
                      : "Remove from organization"}
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setOrgToRemove(m)}
                    >
                      Remove from org
                    </Button>
                  </IconTooltip>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label>Role</Label>
                    <Select
                      value={primaryRole(m)}
                      onValueChange={(v) => handleRoleChange(m, v as AppRole)}
                    >
                      <SelectTrigger aria-label={`Role for ${m.org_name}`} className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-md border border-border p-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Artist link: </span>
                        <span className="font-medium">{m.artist ? m.artist.name : "None"}</span>
                      </div>
                      <div className="flex gap-2">
                        {m.artist && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleLinkArtist(m.org_id, null)}
                            disabled={linkArtist.isPending}
                          >
                            Unlink
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setArtistPickerOrgId(artistPickerOrgId === m.org_id ? null : m.org_id)}
                        >
                          {m.artist ? "Change" : "Link artist"}
                        </Button>
                      </div>
                    </div>
                    {artistPickerOrgId === m.org_id && (
                      (orgArtists ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">No artists in this organization.</p>
                      ) : (
                        <Select onValueChange={(v) => handleLinkArtist(m.org_id, v)}>
                          <SelectTrigger aria-label={`Artist for ${m.org_name}`}>
                            <SelectValue placeholder="Choose an artist" />
                          </SelectTrigger>
                          <SelectContent>
                            {(orgArtists ?? []).map((a) => (
                              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Add to an organization</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label>Organization</Label>
                <Select value={addOrgId} onValueChange={setAddOrgId}>
                  <SelectTrigger aria-label="Organization to add" className="w-[180px]">
                    <SelectValue placeholder="Choose org" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableOrgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <Select value={addRole} onValueChange={(v) => setAddRole(v as AppRole)}>
                  <SelectTrigger aria-label="Role to add" className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleAddToOrg}
                disabled={!addOrgId || setMembership.isPending}
              >
                Add
              </Button>
            </CardContent>
          </Card>

          <div className="border-t border-destructive/30 pt-4 space-y-3">
            <p className="text-sm font-medium text-destructive">Danger zone</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setSuspendConfirmOpen(true)}>
                {user.suspended ? "Unsuspend user" : "Suspend user"}
              </Button>
              <Button type="button" variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
                Delete user
              </Button>
            </div>
          </div>
        </div>

        <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change login email</DialogTitle>
              <DialogDescription>
                Updates the email this user signs in with. They will need to use the new address next time.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="new-login-email">New email</Label>
              <Input
                id="new-login-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEmailDialogOpen(false)}>Cancel</Button>
              <Button
                type="button"
                onClick={handleChangeEmail}
                disabled={!newEmail || newEmail === user.email || manageUser.isPending}
              >
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={orgToRemove !== null} onOpenChange={(o) => { if (!o) setOrgToRemove(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove from {orgToRemove?.org_name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {user.display_name || user.email} will lose all roles and access in this organization.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRemoveFromOrg}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={suspendConfirmOpen} onOpenChange={setSuspendConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{user.suspended ? "Reactivate this user?" : "Suspend this user?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {user.suspended
                  ? "They will be able to sign in again immediately."
                  : "They will be blocked from signing in until you reactivate them."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSuspendToggle}>
                {user.suspended ? "Unsuspend" : "Suspend"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={deleteConfirmOpen}
          onOpenChange={(o) => { setDeleteConfirmOpen(o); if (!o) setDeleteConfirmText(""); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this user?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the account and anonymizes their data. Type
                {" "}<span className="font-medium">{deleteConfirmTarget}</span>{" "}
                to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              placeholder={deleteConfirmTarget}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
            />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteConfirmText !== deleteConfirmTarget}
                onClick={(e) => { e.preventDefault(); handleDelete(); }}
              >
                Permanently delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
