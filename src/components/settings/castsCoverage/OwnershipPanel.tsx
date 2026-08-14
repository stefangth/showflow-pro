import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TriangleAlert, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCan } from "@/hooks/useCapabilities";
import { useAllCities } from "@/hooks/useAllCities";
import { fetchShowAssignments, fetchProgramSubProgramPairs, type ShowAssignmentRow } from "@/data/showAssignments";
import { fetchShowsWithStats } from "@/data/shows";
import { fetchOrgProducers } from "@/data/orgs";
import { cn } from "@/lib/utils";
import { resolveRouting, RANK_LABEL, type RoutingAssignment, type RoutingRank } from "@/lib/ownership/routing";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { IconTooltip } from "@/components/common/IconTooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Sentinel value used in Selects to represent "Any" / unscoped - Radix Select forbids
// empty-string SelectItem values. Mirrors ProductionOwnershipTab's ANY_SCOPE.
const ANY_SCOPE = "__any__";

/** Two-letter initials from a display name, mirroring the People pane's PersonRow. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Props {
  orgId: string;
}

/**
 * Settings -> Casts & coverage -> Production Ownership. Maps producer/admin users to
 * program/sub-program/city scopes for notification routing (`show_assignments`), plus a
 * client-side "routing check" tester driven entirely by `resolveRouting` (src/lib/ownership/routing.ts)
 * over the already-fetched assignments - no backend call. The write path (insert/delete on
 * `show_assignments`, org-scoped reads via fetchShowAssignments/fetchProgramSubProgramPairs,
 * `manage_ownership` capability gate) is reused verbatim from ProductionOwnershipTab.tsx.
 */
export function OwnershipPanel({ orgId }: Props) {
  const qc = useQueryClient();
  const canManage = useCan("manage_ownership");

  const { data: cities } = useAllCities(true);

  const pairsQ = useQuery({
    queryKey: ["shows-program-sub-programs", orgId],
    enabled: !!orgId,
    queryFn: () => fetchProgramSubProgramPairs(supabase, orgId),
  });

  const assignmentsQ = useQuery({
    queryKey: ["show-assignments", orgId],
    enabled: !!orgId,
    queryFn: () => fetchShowAssignments(supabase, orgId),
  });

  const producersQ = useQuery({
    queryKey: ["producer-users", orgId],
    enabled: !!orgId,
    queryFn: () => fetchOrgProducers(supabase, orgId),
  });

  // Same key as useShows() (src/hooks/useShows.ts) so the two share a cache slot when
  // orgId === the caller's active org, which is always true for this Settings surface.
  // dateCount powers the no-owner banner's "N dates" figure; it also gives us the full
  // catalog of programs (including ones with no sub-programs, which
  // fetchProgramSubProgramPairs necessarily omits since it requires both columns set).
  const showsQ = useQuery({
    queryKey: ["shows", "list", orgId],
    enabled: !!orgId,
    queryFn: () => fetchShowsWithStats(supabase, orgId),
  });

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel("ownership_panel_show_assignments")
      .on("postgres_changes", { event: "*", schema: "public", table: "show_assignments" }, () => {
        qc.invalidateQueries({ queryKey: ["show-assignments"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [orgId, qc]);

  const producersById = useMemo(
    () => new Map((producersQ.data ?? []).map((p) => [p.user_id, p.display_name ?? p.user_id.slice(0, 8)])),
    [producersQ.data],
  );
  const citiesById = useMemo(() => new Map((cities ?? []).map((c) => [c.id, c.name])), [cities]);

  const assignments = useMemo(() => assignmentsQ.data ?? [], [assignmentsQ.data]);

  const ownerName = (a: ShowAssignmentRow) => producersById.get(a.producer_user_id) ?? a.producer_user_id.slice(0, 8);

  // The full program catalog (every show's program, whether or not it has a sub-program) -
  // this drives both the no-owner banner and the "Owners by program" grouping, so a program
  // with no sub-programs at all still gets a banner when it has no owner.
  const programDateCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of showsQ.data ?? []) {
      if (!s.program) continue;
      map.set(s.program, (map.get(s.program) ?? 0) + s.dateCount);
    }
    return map;
  }, [showsQ.data]);
  const programs = useMemo(() => Array.from(programDateCounts.keys()).sort(), [programDateCounts]);

  const programsWithOwner = useMemo(() => new Set(assignments.map((a) => a.program).filter((p): p is string => !!p)), [assignments]);
  const unownedPrograms = useMemo(() => programs.filter((p) => !programsWithOwner.has(p)), [programs, programsWithOwner]);

  const assignmentsByProgram = useMemo(() => {
    const map = new Map<string, ShowAssignmentRow[]>();
    for (const a of assignments) {
      if (!a.program) continue;
      const list = map.get(a.program) ?? [];
      list.push(a);
      map.set(a.program, list);
    }
    return map;
  }, [assignments]);

  // Routing resolver input: the raw assignment rows reshaped into RoutingAssignment,
  // scoped by city_id (matches the routing-check select's value domain below).
  const routingAssignments: RoutingAssignment[] = useMemo(
    () =>
      assignments
        .filter((a): a is ShowAssignmentRow & { program: string } => !!a.program)
        .map((a) => ({
          id: a.id,
          owner: producersById.get(a.producer_user_id) ?? a.producer_user_id.slice(0, 8),
          program: a.program,
          subProgram: a.sub_program,
          city: a.city_id,
        })),
    [assignments, producersById],
  );

  // ---- Assign-owner composer ----
  const [composerOpen, setComposerOpen] = useState(false);
  const [newProgram, setNewProgram] = useState("");
  const [newSubProgram, setNewSubProgram] = useState("");
  const [newCityId, setNewCityId] = useState("");
  const [newUserId, setNewUserId] = useState("");

  const openComposerFor = (program: string) => {
    setNewProgram(program);
    setNewSubProgram("");
    setNewCityId("");
    setComposerOpen(true);
  };

  const addAssignment = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("show_assignments").insert({
        producer_user_id: newUserId,
        program: newProgram,
        sub_program: newSubProgram || null,
        city_id: newCityId || null,
        org_id: orgId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["show-assignments"] });
      setNewProgram("");
      setNewSubProgram("");
      setNewCityId("");
      setNewUserId("");
      setComposerOpen(false);
      toast.success("Owner assigned");
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to assign owner"),
  });

  const deleteAssignment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("show_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["show-assignments"] });
      toast.success("Owner removed");
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to remove owner"),
  });

  // ---- Routing check ----
  const [rcProgram, setRcProgram] = useState("");
  const [rcSubProgram, setRcSubProgram] = useState("");
  const [rcCityId, setRcCityId] = useState("");

  const effectiveRcProgram = rcProgram || programs[0] || "";
  const routingResult = useMemo(
    () =>
      resolveRouting(routingAssignments, {
        program: effectiveRcProgram,
        subProgram: rcSubProgram || null,
        city: rcCityId || null,
      }),
    [routingAssignments, effectiveRcProgram, rcSubProgram, rcCityId],
  );

  const reasonFor = (rank: RoutingRank | null): string => {
    if (rank === null) return "No owner covers this show. Notifications fall back to the admins.";
    if (rank === 4) return "Exact match. This owner is assigned to this exact sub-program and city.";
    if (rank === 3) return "City match. This owner covers this city across every sub-program.";
    if (rank === 2) return "Sub match. This owner covers this sub-program across every city.";
    return "Program match. This owner covers the whole program with no city or sub-program restriction.";
  };

  const rcSubProgramOptions = useMemo(
    () => Array.from(new Set((pairsQ.data ?? []).filter((p) => p.program === effectiveRcProgram).map((p) => p.sub_program))).sort(),
    [pairsQ.data, effectiveRcProgram],
  );

  const newSubProgramOptions = useMemo(
    () => Array.from(new Set((pairsQ.data ?? []).filter((p) => p.program === newProgram).map((p) => p.sub_program))).sort(),
    [pairsQ.data, newProgram],
  );

  return (
    <div className="space-y-6">
      {unownedPrograms.length > 0 && (
        <div className="space-y-2">
          {unownedPrograms.map((program) => {
            const count = programDateCounts.get(program) ?? 0;
            return (
              <div
                key={program}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-l)] border border-[var(--amber-200)] bg-[var(--amber-100)] p-3"
              >
                <p className="flex items-center gap-2 text-sm text-[var(--amber-600)]">
                  <TriangleAlert className="h-4 w-4 shrink-0" />
                  <span>
                    <strong className="font-semibold">{program}</strong> has no owner. Every notification for its{" "}
                    {count} date{count === 1 ? "" : "s"} routes to admins only.
                  </span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canManage}
                  onClick={() => openComposerFor(program)}
                >
                  Assign owner
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="font-display">Owners by program</CardTitle>
              <CardDescription>Most specific scope wins. Rank is shown per row.</CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!canManage}
              onClick={() => (composerOpen ? setComposerOpen(false) : openComposerFor(programs[0] ?? ""))}
            >
              Assign owner
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {composerOpen && (
              <div className="space-y-2 rounded-[var(--radius-m)] border border-border bg-[var(--surface-2)] p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Member</Label>
                    <Select value={newUserId} onValueChange={setNewUserId}>
                      <SelectTrigger><SelectValue placeholder="Select a team member…" /></SelectTrigger>
                      <SelectContent>
                        {(producersQ.data ?? []).map((u) => (
                          <SelectItem key={u.user_id} value={u.user_id}>{u.display_name ?? u.user_id.slice(0, 8)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Program</Label>
                    <Select value={newProgram} onValueChange={(v) => { setNewProgram(v); setNewSubProgram(""); }}>
                      <SelectTrigger><SelectValue placeholder="Select program…" /></SelectTrigger>
                      <SelectContent>
                        {programs.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sub-program (optional)</Label>
                    <Select value={newSubProgram || ANY_SCOPE} onValueChange={(v) => setNewSubProgram(v === ANY_SCOPE ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Any sub-program" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY_SCOPE}>Any</SelectItem>
                        {newSubProgramOptions.map((sp) => <SelectItem key={sp} value={sp}>{sp}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">City (optional)</Label>
                    <Select value={newCityId || ANY_SCOPE} onValueChange={(v) => setNewCityId(v === ANY_SCOPE ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Any city" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY_SCOPE}>Any</SelectItem>
                        {(cities ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canManage || !newUserId || !newProgram || addAssignment.isPending}
                    onClick={() => addAssignment.mutate()}
                  >
                    Assign
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Ranks as Program, the broadest scope. Narrow it with a sub-program or city to outrank an existing owner.
                </p>
              </div>
            )}

            {programs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No programs in the catalog yet.</p>
            ) : (
              <div className="space-y-5">
                {programs.map((program) => {
                  const rows = assignmentsByProgram.get(program) ?? [];
                  const maxSpecificity = rows.reduce((max, a) => Math.max(max, specificityOf(a)), 0);
                  return (
                    <div key={program} className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{program}</p>
                      {rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No owner assigned.</p>
                      ) : (
                        rows.map((a) => {
                          const rank = specificityOf(a);
                          const wins = rank === maxSpecificity;
                          const name = ownerName(a);
                          const cityName = a.city_id ? citiesById.get(a.city_id) ?? a.city_id : null;
                          return (
                            <div key={a.id} className="flex items-center gap-3 rounded-[var(--radius-m)] border border-border p-2 text-sm">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback seed={a.producer_user_id}>{initials(name)}</AvatarFallback>
                              </Avatar>
                              <span className="w-32 shrink-0 truncate font-medium text-foreground">{name}</span>
                              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                                <Badge variant="accent">{program}</Badge>
                                {a.sub_program ? (
                                  <Badge variant="accent">{a.sub_program}</Badge>
                                ) : (
                                  <Badge variant="neutral">any sub-program</Badge>
                                )}
                                {cityName ? (
                                  <Badge variant="accent">{cityName}</Badge>
                                ) : (
                                  <Badge variant="neutral">any city</Badge>
                                )}
                              </div>
                              {wins ? (
                                <Badge variant="accent">Wins first</Badge>
                              ) : (
                                <Badge variant="neutral">{RANK_LABEL[rank]}</Badge>
                              )}
                              <IconTooltip label="Remove owner">
                                <button
                                  type="button"
                                  onClick={() => deleteAssignment.mutate(a.id)}
                                  disabled={!canManage}
                                  aria-label="Remove owner"
                                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50 disabled:pointer-events-none"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </IconTooltip>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Routing check
            </CardTitle>
            <CardDescription>See who gets notified for a given scope.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Program</Label>
                <Select value={effectiveRcProgram} onValueChange={(v) => { setRcProgram(v); setRcSubProgram(""); setRcCityId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Select program…" /></SelectTrigger>
                  <SelectContent>
                    {programs.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Sub-program</Label>
                <Select value={rcSubProgram || ANY_SCOPE} onValueChange={(v) => setRcSubProgram(v === ANY_SCOPE ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Any sub-program" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_SCOPE}>Any</SelectItem>
                    {rcSubProgramOptions.map((sp) => <SelectItem key={sp} value={sp}>{sp}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">City</Label>
                <Select value={rcCityId || ANY_SCOPE} onValueChange={(v) => setRcCityId(v === ANY_SCOPE ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Any city" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_SCOPE}>Any</SelectItem>
                    {(cities ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5 rounded-[var(--radius-m)] border border-accent-200 bg-accent-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-accent-700">Notified</p>
              <p className="text-sm font-semibold text-foreground">
                {routingResult.winner ? routingResult.winner.owner : "Admins only"}
              </p>
              <p className="text-xs text-muted-foreground">{reasonFor(routingResult.rankMatched)}</p>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-muted-foreground">Precedence</p>
              {[...routingResult.ladder].reverse().map((entry) => (
                <div key={entry.rank} className="flex items-center justify-between gap-2 text-sm">
                  <span className={cn("text-muted-foreground", entry.rank === routingResult.rankMatched && "font-medium text-foreground")}>
                    {entry.rank}. {entry.label}
                  </span>
                  <span className={cn("truncate text-right", entry.owner ? "text-foreground" : "text-muted-foreground")}>
                    {entry.owner ?? "no rule"}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">Admins are always fallback recipients.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Row-level specificity, matching resolveRouting's own rule (kept local so a plain
 *  ShowAssignmentRow - not yet reshaped into RoutingAssignment - can be ranked for display). */
function specificityOf(a: ShowAssignmentRow): RoutingRank {
  if (a.sub_program && a.city_id) return 4;
  if (a.city_id) return 3;
  if (a.sub_program) return 2;
  return 1;
}
