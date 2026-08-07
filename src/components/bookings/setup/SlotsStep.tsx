import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchShowsWithSlots } from "@/data/settings";
import { updateShow } from "@/data/shows";
import { showSlots, activeShows } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Draft = Record<string, { main: string; us: string }>;

/** The rail's slots panel: number inputs for each show still missing a slot count.
 *  Saves through `updateShow`, the same path the Productions page uses. */
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
      const edits = unset
        .map((s) => ({ id: s.id, main: draft[s.id]?.main, us: draft[s.id]?.us }))
        .filter((e) => e.main !== undefined && e.main !== "" && e.us !== undefined && e.us !== "");
      if (edits.length === 0) throw new Error("Enter a main and understudy count");
      await Promise.all(
        edits.map((e) =>
          updateShow(supabase, e.id, { main_cast_slots: Number(e.main), understudy_slots: Number(e.us) }),
        ),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shows"] });
      toast.success("Slot counts saved");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (shows.isLoading) return <Skeleton className="h-24 w-full" />;

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
