import { useMemo, useState } from "react";
import { usePlatformUsers } from "@/hooks/usePlatformUsers";
import { UserDetailSheet } from "./UserDetailSheet";
import { formatLastActivity } from "./platformFormat";
import { ROLES, type AppRole } from "@/config/app.config";
import type { PlatformUser } from "@/data/platformUsers";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const MAX_ORG_CHIPS = 2;

const ROLE_OPTIONS = Object.values(ROLES) as AppRole[];

function matchesSearch(user: PlatformUser, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    (user.display_name ?? "").toLowerCase().includes(needle) ||
    (user.email ?? "").toLowerCase().includes(needle)
  );
}

export function UsersTab() {
  const { data, isLoading, isError, error } = usePlatformUsers();
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState(ALL);
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [selected, setSelected] = useState<PlatformUser | null>(null);

  const users = useMemo(() => data?.users ?? [], [data]);
  const truncated = data?.truncated ?? false;

  const orgOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      for (const m of u.memberships) map.set(m.org_id, m.org_name);
    }
    return Array.from(map.entries())
      .map(([org_id, org_name]) => ({ org_id, org_name }))
      .sort((a, b) => a.org_name.localeCompare(b.org_name));
  }, [users]);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (!matchesSearch(u, search)) return false;
      if (orgFilter !== ALL && !u.memberships.some((m) => m.org_id === orgFilter)) return false;
      if (roleFilter !== ALL && !u.memberships.some((m) => m.roles.includes(roleFilter as AppRole))) return false;
      if (statusFilter === "active" && u.suspended) return false;
      if (statusFilter === "suspended" && !u.suspended) return false;
      return true;
    });
  }, [users, search, orgFilter, roleFilter, statusFilter]);

  if (isLoading) {
    return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[var(--row-h)] w-full" />)}</div>;
  }
  if (isError) {
    return <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-4">
      {truncated && (
        <Alert variant="destructive">
          <AlertDescription>
            Showing the first 1000 users. Refine your search to find users outside this range.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search by name or email"
          aria-label="Search users"
          className="w-[240px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={orgFilter} onValueChange={setOrgFilter}>
          <SelectTrigger className="w-[160px]" aria-label="Org filter">
            <SelectValue placeholder="Org" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All orgs</SelectItem>
            {orgOptions.map((o) => <SelectItem key={o.org_id} value={o.org_id}>{o.org_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[140px]" aria-label="Role filter">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All roles</SelectItem>
            {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" aria-label="Status filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Orgs</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Artist</TableHead>
            <TableHead>Last sign-in</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((u) => {
            const roles = Array.from(new Set(u.memberships.flatMap((m) => m.roles)));
            const isLinked = u.memberships.some((m) => m.artist !== null);
            const visibleOrgs = u.memberships.slice(0, MAX_ORG_CHIPS);
            const overflowCount = u.memberships.length - visibleOrgs.length;
            return (
              <TableRow
                key={u.id}
                onClick={() => setSelected(u)}
                className={cn("cursor-pointer", u.suspended && "opacity-60 text-muted-foreground")}
              >
                <TableCell className="font-medium">{u.display_name || u.email || u.id}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {visibleOrgs.map((m) => <Badge key={m.org_id} variant="outline">{m.org_name}</Badge>)}
                    {overflowCount > 0 && <Badge variant="outline">+{overflowCount}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{roles.join(", ")}</TableCell>
                <TableCell>{isLinked && <Badge variant="outline">Linked</Badge>}</TableCell>
                <TableCell className="text-muted-foreground">{formatLastActivity(u.last_sign_in_at)}</TableCell>
                <TableCell>
                  <Badge variant={u.suspended ? "destructive" : "secondary"}>
                    {u.suspended ? "Suspended" : "Active"}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
          {filtered.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No users match these filters</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <UserDetailSheet user={selected} open={selected !== null} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}
