import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { CAPABILITY_DEFS, CAPABILITY_GROUPS } from "@/lib/capabilities";
import { presetOnKeys, matchesPreset, type Preset } from "@/lib/capabilities/presets";
import {
  desiredFor,
  changedKeys,
  diffSentence,
  deltaSentence,
  type StagedMap,
} from "@/lib/capabilities/stagedDiff";
import { matchesFilter, filterCounts, type RightsFilter } from "@/lib/capabilities/rightsFilter";
import { useCapabilityMatrix } from "@/hooks/useCapabilities";
import { useFeature } from "@/hooks/useEntitlements";
import { useOrgMembers } from "@/hooks/useOrgMembers";
import { setOrgCapability } from "@/data/platform";
import { clearOrgCapability } from "@/data/capabilities";
import { RightRow, type RightRowData } from "./RightRow";
import { RightGroupCard } from "./RightGroupCard";
import { EditingPickerCard } from "./EditingPickerCard";
import { StagedChangesCard, type StagedChange } from "./StagedChangesCard";
import { ChangeLogDialog } from "./ChangeLogDialog";

const PRESET_OPTIONS: SegmentedControlOption<Preset>[] = [
  { value: "Restricted", label: "Restricted" },
  { value: "Standard", label: "Standard" },
  { value: "Full", label: "Full" },
  { value: "Custom", label: "Custom" },
];

const REAL_PRESETS: Preset[] = ["Restricted", "Standard", "Full"];

interface RolesRightsTabProps {
  orgId: string;
}

/** Org-admin "Roles & rights" surface: a staged-changes editor over the capabilities
 *  registry. Toggles (single row, group bulk, or a whole preset) only stage a pending
 *  desired state; nothing writes until Apply, which batches every changed key and asks
 *  for one confirmation up front when any changed key is sensitive. */
export function RolesRightsTab({ orgId }: RolesRightsTabProps) {
  const qc = useQueryClient();
  const { cells, isLoading } = useCapabilityMatrix(orgId);
  const hireOrdersEnabled = useFeature("hire_orders");
  const { data: members } = useOrgMembers(orgId);
  const memberCount = members?.length ?? 0;

  const [staged, setStaged] = useState<StagedMap>({});
  const [preset, setPreset] = useState<Preset>("Standard");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RightsFilter>("All");
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const cellByKey = useMemo(() => new Map(cells.map((c) => [c.def.key, c])), [cells]);

  const allRows: RightRowData[] = useMemo(
    () =>
      cells.map((c) => ({
        key: c.def.key,
        label: c.def.label,
        description: c.def.description,
        risk: c.def.risk,
        effective: c.effective,
        locked: c.locked,
      })),
    [cells],
  );
  const rowByKey = useMemo(() => new Map(allRows.map((r) => [r.key, r])), [allRows]);

  const visibleRows = useMemo(
    () =>
      allRows.filter((row) => {
        const def = cellByKey.get(row.key)?.def;
        if (def?.module === "hire_orders") return hireOrdersEnabled;
        return true;
      }),
    [allRows, cellByKey, hireOrdersEnabled],
  );

  const desiredMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const row of allRows) m[row.key] = desiredFor(row, staged);
    return m;
  }, [allRows, staged]);

  const activePreset: Preset = useMemo(
    () => REAL_PRESETS.find((p) => matchesPreset(desiredMap, p)) ?? "Custom",
    [desiredMap],
  );
  const presetLabel = activePreset !== "Custom" ? activePreset : preset;

  const changed = useMemo(() => changedKeys(allRows, staged), [allRows, staged]);
  const changedSet = useMemo(() => new Set(changed), [changed]);
  const sensitiveChanged = changed.filter((k) => rowByKey.get(k)?.risk === "sensitive");
  const sensitiveLabels = sensitiveChanged.map((k) => rowByKey.get(k)?.label ?? k);

  const diffText = diffSentence(allRows, staged, presetLabel);
  const delta = deltaSentence(allRows, staged, "the Production Team");
  const onCount = allRows.filter((r) => desiredMap[r.key]).length;

  function applyPreset(p: Preset) {
    if (p === "Custom") return;
    const onKeys = presetOnKeys(p);
    const next: StagedMap = {};
    for (const row of allRows) {
      if (row.locked) continue;
      const want = onKeys.has(row.key);
      if (want !== row.effective) next[row.key] = want;
    }
    setStaged(next);
    setPreset(p);
  }

  function toggleRow(row: RightRowData) {
    if (row.locked) return;
    setStaged((prev) => ({ ...prev, [row.key]: !desiredFor(row, prev) }));
  }

  function toggleGroup(groupRows: RightRowData[], allOn: boolean) {
    setStaged((prev) => {
      const next = { ...prev };
      for (const row of groupRows) {
        if (row.locked) continue;
        next[row.key] = !allOn;
      }
      return next;
    });
  }

  const applyMutation = useMutation({
    mutationFn: async (keys: string[]) => {
      await Promise.all(
        keys.map(async (key) => {
          const cell = cellByKey.get(key);
          const row = rowByKey.get(key);
          if (!cell || !row) return;
          const desired = desiredFor(row, staged);
          const baseline = cell.policyEnabled ?? cell.def.defaultEnabled;
          if (desired === baseline) {
            await clearOrgCapability(supabase, orgId, key);
          } else {
            await setOrgCapability(supabase, orgId, key, desired);
          }
        }),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["capabilities"] });
      toast.success("Rights updated.");
      setStaged({});
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleApply() {
    if (sensitiveChanged.length > 0) {
      setConfirmOpen(true);
      return;
    }
    applyMutation.mutate(changed);
  }

  function confirmApply() {
    setConfirmOpen(false);
    applyMutation.mutate(changed);
  }

  const filterCountsResult = filterCounts(
    visibleRows.map((r) => ({ ...r, changed: changedSet.has(r.key), desired: desiredMap[r.key] })),
  );
  const filterOptions: SegmentedControlOption<RightsFilter>[] = [
    { value: "All", label: "All", count: filterCountsResult.All },
    { value: "Sensitive", label: "Sensitive", count: filterCountsResult.Sensitive },
    { value: "Changed", label: "Changed", count: filterCountsResult.Changed },
    { value: "Off", label: "Off", count: filterCountsResult.Off },
  ];

  const filteredRows = visibleRows.filter((row) =>
    matchesFilter(row, { query, filter, changed: changedSet.has(row.key), desired: desiredMap[row.key] }),
  );
  const groups = CAPABILITY_GROUPS.map((group) => ({
    group,
    rows: filteredRows.filter((r) => cellByKey.get(r.key)?.def.group === group),
  })).filter((g) => g.rows.length > 0);

  const stagedChanges: StagedChange[] = changed.map((key) => {
    const row = rowByKey.get(key);
    const on = desiredMap[key];
    return {
      label: row?.label ?? key,
      transition: `${on ? "Off -> On" : "On -> Off"}${row?.risk === "sensitive" ? " · sensitive" : ""}`,
      on,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
            ORGANIZATION · ACCESS
          </p>
          <h1 className="mt-1 font-display text-xl font-semibold text-foreground">Roles &amp; rights</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Set rights for the whole Production Team, then grant exceptions to one person. Admins always have every
            right.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setChangeLogOpen(true)}>
          Change log
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="space-y-3 rounded-[var(--radius-l)] border border-border bg-card p-4 shadow-elev2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl value={activePreset} onChange={applyPreset} options={PRESET_OPTIONS} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={changed.length === 0}
                onClick={() => setStaged({})}
              >
                Reset to baseline
              </Button>
            </div>
            <p className="text-[12.5px] text-muted-foreground">{diffText}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search rights..."
              aria-label="Search rights"
              className="max-w-xs"
            />
            <SegmentedControl value={filter} onChange={(v) => setFilter(v)} options={filterOptions} />
          </div>

          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-4">
              {groups.map(({ group, rows }) => {
                const onInGroup = rows.filter((r) => desiredMap[r.key]).length;
                const allOn = rows.filter((r) => !r.locked).every((r) => desiredMap[r.key]);
                return (
                  <RightGroupCard
                    key={group}
                    group={group}
                    summary={`${onInGroup} of ${rows.length} on`}
                    allOn={allOn}
                    onToggleAll={() => toggleGroup(rows, allOn)}
                  >
                    {rows.map((row) => (
                      <RightRow
                        key={row.key}
                        row={row}
                        changed={changedSet.has(row.key)}
                        desired={desiredMap[row.key]}
                        onToggle={() => toggleRow(row)}
                      />
                    ))}
                  </RightGroupCard>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <EditingPickerCard roleOnCount={`${onCount}/${CAPABILITY_DEFS.length}`} memberCount={memberCount} />
          <StagedChangesCard
            count={changed.length}
            scopeLine="Applies to the Production Team default."
            changes={stagedChanges}
            deltaSentence={delta}
            canApply={changed.length > 0}
            onDiscard={() => setStaged({})}
            onApply={handleApply}
          />
        </div>
      </div>

      <ChangeLogDialog open={changeLogOpen} onOpenChange={setChangeLogOpen} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm sensitive changes</AlertDialogTitle>
            <AlertDialogDescription>
              {`This applies ${changed.length} change${changed.length === 1 ? "" : "s"}, including sensitive rights: ${sensitiveLabels.join(", ")}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmApply}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
