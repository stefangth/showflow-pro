import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { upsertOrgSetting } from "@/data/settings";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import {
  applyPreset, matchPreset, normalizeBookingFlow, lifecycleChips, inPracticeRows,
  BOOKING_FLOW_DEFAULTS, type PresetName, type FlowTimes, type LifecycleChip,
} from "@/lib/bookingFlow";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { FlowPresets } from "@/components/settings/bookingFlow/FlowPresets";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Json } from "@/integrations/supabase/types";

const PRESET_NAMES: Record<PresetName, string> = { classic: "Classic", fasttrack: "Fast-track", direct: "Direct book" };
const CHIP_TONE: Record<LifecycleChip["tone"], string> = {
  violet: "bg-[var(--accent-500)]", amber: "bg-[var(--amber-500)]",
  green: "bg-[var(--green-500)]", neutral: "bg-muted-foreground",
};
const DEFAULT_TIMES: FlowTimes = {
  windowHours: BOOKING_ENGINE_DEFAULTS.offer_response_window_hours,
  offerDigestHour: BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin,
  confirmationDigestHour: BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin,
};

/** The rail's flow panel: pick a preset, see the live lifecycle and per-audience
 *  consequences (the real policy, not static prose), save through the settings path. */
export function FlowStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: flow } = useBookingFlow();
  const { data: times } = useFlowTimes(orgId);
  const base = flow ?? BOOKING_FLOW_DEFAULTS;
  const t = times ?? DEFAULT_TIMES;

  const [selected, setSelected] = useState<PresetName>("classic");
  const seeded = useRef(false);
  useEffect(() => {
    if (!flow || seeded.current) return;
    seeded.current = true;
    const m = matchPreset(flow);
    if (m !== "custom") setSelected(m);
  }, [flow]);

  const preview = normalizeBookingFlow(applyPreset(base, selected));
  const chips = lifecycleChips(preview);
  const rows = inPracticeRows(preview, t);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      return upsertOrgSetting(supabase, orgId, "booking_flow", preview as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(`Booking flow set to ${PRESET_NAMES[selected]}`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        This decides what artists see and what the app calls things. Pick one, read what it does, change it any time in Settings.
      </p>
      <FlowPresets active={selected} onSelect={(p) => setSelected(p)} />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">A booking then goes</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={c.label} className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2 py-0.5 text-xs font-medium">
              <span className={cn("h-1.5 w-1.5 rounded-sm", CHIP_TONE[c.tone])} />
              {c.label}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.who} className="grid grid-cols-[78px_1fr] gap-2.5">
            <span className="pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{r.who}</span>
            <span className="text-xs leading-[18px] text-muted-foreground">{r.text}</span>
          </div>
        ))}
      </div>
      <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>
        Use {PRESET_NAMES[selected]}
      </Button>
    </div>
  );
}
