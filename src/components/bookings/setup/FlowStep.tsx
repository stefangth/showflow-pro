import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { upsertOrgSettings, DEFAULT_FLOW_TIMES } from "@/data/settings";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import {
  applyPreset, matchPreset, normalizeBookingFlow, lifecycleChips, inPracticeRows,
  BOOKING_FLOW_DEFAULTS, type PresetName, type LifecycleChip,
} from "@/lib/bookingFlow";
import { FlowPresets } from "@/components/settings/bookingFlow/FlowPresets";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { Json } from "@/integrations/supabase/types";

// Onboarding hides the "Off" tile (FlowPresets showOff={false}): pausing the flow is a
// deliberate Settings action, and choosing Off here would leave the setup step outstanding
// (flowChosen requires an active flow). The map still needs the key for the PresetName type.
const PRESET_NAMES: Record<PresetName, string> = { classic: "Classic", fasttrack: "Fast-track", direct: "Direct book", off: "Off" };
const CHIP_TONE: Record<LifecycleChip["tone"], string> = {
  violet: "bg-[var(--accent-500)]", amber: "bg-[var(--amber-500)]",
  green: "bg-[var(--green-500)]", neutral: "bg-muted-foreground",
};

/** The rail's flow panel: pick a preset, see the live lifecycle and per-audience
 *  consequences (the real policy, not static prose), save through the settings path. */
export function FlowStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  // The org this panel was HANDED, not whichever org the shell happens to be on. The Save
  // below writes to `orgId`, and the suggested preset is a view of the flow read here: with
  // `useBookingFlow()` resolving its own org out of AuthContext, a switch in the app shell
  // (which does not unmount this panel) could open the panel on one org's preset and write
  // it to another. The "in practice" hours already keyed on the prop.
  //
  // `orgId ? ... : null` as defense in depth: `useBookingFlow` now disables its own query
  // for a null org (nothing is fetched), but the narrowing also documents the intent here:
  // with no org there is nothing to suggest and nothing to save to (the button below is
  // disabled for the same reason).
  const flowQ = useBookingFlow(orgId);
  const { isError, error } = flowQ;
  const flow = orgId ? flowQ.data : null;
  const { data: times } = useFlowTimes(orgId);
  const base = flow ?? BOOKING_FLOW_DEFAULTS;
  const t = times ?? DEFAULT_FLOW_TIMES;

  // The suggestion is a VIEW of the org's current flow until the producer picks
  // something else. Seeding it into state through an effect meant `selected` was
  // "classic" and `base` was BOOKING_FLOW_DEFAULTS while the read was in flight, so a
  // Save there wrote the classic preset over the org's real flow and dropped any
  // non-preset customization with it (applyPreset layered onto the defaults rather
  // than onto the org's own flow). "off" is not offered in onboarding, so an org
  // sitting in that state gets a real preset suggested rather than an unselectable Off.
  const suggested = flow ? matchPreset(flow) : undefined;
  const [selected, setSelected] = useState<PresetName | null>(null);
  const active: PresetName = selected ?? (suggested && suggested !== "custom" && suggested !== "off" ? suggested : "classic");

  const preview = normalizeBookingFlow(applyPreset(base, active));
  const chips = lifecycleChips(preview);
  const rows = inPracticeRows(preview, t);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      return upsertOrgSettings(supabase, orgId, [
        { key: "booking_flow", value: preview as unknown as Json },
        { key: "booking_flow_template", value: active as unknown as Json },
      ]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(`Booking flow set to ${PRESET_NAMES[active]}`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // A failed read must say so rather than fall through to the presets scored against
  // BOOKING_FLOW_DEFAULTS, and must not fall through to the skeleton below either --
  // `data` stays undefined once React Query has exhausted its retries, so that would
  // be a permanent dead end in the rail. Same guard as LetterheadStep/CountersignStep.
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the booking flow. {(error as Error)?.message}
        </AlertDescription>
      </Alert>
    );
  }
  // Nothing to derive from while the read is in flight: the presets would be scored
  // against BOOKING_FLOW_DEFAULTS rather than the org's own flow, and Save would
  // persist that. Withhold until the flow exists. Skipped without an active org (a
  // super-admin bypasses the org gate), where Save is already disabled.
  if (orgId && !flow) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        This decides what artists see and what the app calls things. Pick one, read what it does, change it any time in Settings.
      </p>
      <FlowPresets active={active} onSelect={(p) => setSelected(p)} showOff={false} />
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
      {/* Enabled only once this panel has READ the flow it is about to overwrite. `preview`
          layers the preset onto `base`, so the org's non-preset fields (reference_field and
          friends) survive a save only if `base` is that org's real flow; with the read still
          in flight `base` is BOOKING_FLOW_DEFAULTS and saving would quietly discard them.
          The window is reachable because the org switcher lives in the app shell and does
          not unmount this panel: a switch can leave `selected` on the previous org's pick
          while the new org's flow is still loading. The view above fixes what is DISPLAYED;
          this closes the write in the meantime. */}
      <Button size="sm" disabled={save.isPending || !orgId || !flow} onClick={() => save.mutate()}>
        Use {PRESET_NAMES[active]}
      </Button>
    </div>
  );
}
