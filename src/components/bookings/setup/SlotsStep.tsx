import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchShowsWithSlots } from "@/data/settings";
import { saveShowSlots, type SlotDraft } from "@/data/slots";
import { showSlots, activeShows } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/app.config";

type Draft = Record<string, { main: string; us: string }>;

/** The rail's slots panel: number inputs for each show still missing a main count.
 *  Saves through `saveShowSlots`, writing `show_slots` rows (the same authoring model
 *  ShowFormDialog uses); the recompute trigger derives the show's main/understudy caches.
 *  Understudy is optional here: a blank or zero u/s creates no understudy slot. */
export function SlotsStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const shows = useQuery({
    queryKey: ["shows", "with-slots", orgId],
    enabled: !!orgId,
    queryFn: () => fetchShowsWithSlots(supabase, orgId),
  });
  // Only active shows: an archived or draft show with no slot count never blocks the rail.
  const unset = (activeShows(shows.data) ?? []).filter((s) => showSlots(s) === null);
  const [draft, setDraft] = useState<Draft>({});
  const val = (id: string, k: "main" | "us") => draft[id]?.[k] ?? "";
  const setVal = (id: string, k: "main" | "us", v: string) =>
    setDraft((d) => ({ ...d, [id]: { main: d[id]?.main ?? "", us: d[id]?.us ?? "", [k]: v } }));

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      const edits = unset
        .map((s) => ({ id: s.id, main: draft[s.id]?.main, us: draft[s.id]?.us }))
        .filter((e) => e.main !== undefined && e.main !== "");
      if (edits.length === 0) throw new Error("Enter a main cast count");
      await Promise.all(
        edits.map((e) => {
          // A Main cast slot always; an Understudy slot only when a positive u/s count is
          // entered. Client-minted ids make a retry idempotent (saveShowSlots resolves an
          // already-landed row to a no-op update instead of a duplicate insert).
          const slots: SlotDraft[] = [
            { id: crypto.randomUUID(), name: "Main cast", count: Number(e.main), kind: "main", skillIds: [] },
          ];
          if (e.us !== undefined && e.us !== "" && Number(e.us) > 0) {
            slots.push({ id: crypto.randomUUID(), name: "Understudy", count: Number(e.us), kind: "understudy", skillIds: [] });
          }
          return saveShowSlots(supabase, { showId: e.id, orgId, slots });
        }),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shows"] });
      qc.invalidateQueries({ queryKey: ["show-dates"] });
      toast.success("Slot counts saved");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (shows.isLoading) return <Skeleton className="h-24 w-full" />;

  if (unset.length === 0) {
    const hasActiveShows = (activeShows(shows.data)?.length ?? 0) > 0;
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          A date with no slot count never reads as full, so it can't reach fully filled or auto-draft a hire order.
        </p>
        <div className="flex items-center gap-2.5 rounded-md border border-dashed border-border p-3">
          <span className="min-w-0 flex-1 text-sm text-muted-foreground">
            {hasActiveShows
              ? "Every active show already has its slot counts set."
              : "No shows yet. Add a show first, then set its slot counts here."}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to={ROUTES.PRODUCTIONS}>Add a show</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        A date with no slot count never reads as full, so it can't reach fully filled or auto-draft a hire order.
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        {unset.map((s) => (
          <div key={s.id} className="flex items-center gap-2.5 border-b border-border p-2 last:border-b-0">
            <span className="min-w-0 flex-1 truncate text-sm">
              {s.program}
              {s.sub_program ? <span className="text-muted-foreground"> · {s.sub_program}</span> : null}
            </span>
            <label className="text-[11px] text-muted-foreground">main</label>
            <Input type="number" min={0} className="h-7 w-14" value={val(s.id, "main")}
              onChange={(e) => setVal(s.id, "main", e.target.value)} />
            <label className="text-[11px] text-muted-foreground">u/s</label>
            <Input type="number" min={0} className="h-7 w-14" value={val(s.id, "us")}
              onChange={(e) => setVal(s.id, "us", e.target.value)} />
          </div>
        ))}
      </div>
      <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save slot counts</Button>
    </div>
  );
}
