
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { upsertOrgSetting } from "@/data/settings";
import { useFlowTimes } from "@/hooks/useBookingFlow";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useDerivedDraft } from "@/hooks/useDerivedDraft";

/** The rail's timing panel: offer window and the two Berlin digest hours, shown as the
 *  org's live values and written as the three settings keys. The code defaults
 *  (48h / 19:00 / 20:00) are never displayed as if they were the org's own -- the
 *  panel waits for the read, see the gate below. */
export function TimingStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: times } = useFlowTimes(orgId);
  // Views of the org's stored timing, not copies seeded into state by an effect.
  // Save persists these three verbatim, so a copy that still held the code defaults
  // wrote 48/19/20 over the org's real timing -- and with no gate below, that was
  // true for the whole fetch, not one commit.
  const [win, setWin] = useDerivedDraft(
    times && String(times.windowHours),
    String(BOOKING_ENGINE_DEFAULTS.offer_response_window_hours),
  );
  const [offer, setOffer] = useDerivedDraft(
    times && String(times.offerDigestHour),
    String(BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin),
  );
  const [conf, setConf] = useDerivedDraft(
    times && String(times.confirmationDigestHour),
    String(BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin),
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      const windowHours = Number(win);
      const offerHour = Number(offer);
      const confirmationHour = Number(conf);
      // A cleared field reads as Number("") === 0, and a 0-hour offer window is acted on
      // by the engine (offers would expire the instant they open). Guard before writing.
      const validWindow = Number.isInteger(windowHours) && windowHours >= 1;
      const validDigestHour = (h: number) => Number.isInteger(h) && h >= 0 && h <= 23;
      if (!validWindow || !validDigestHour(offerHour) || !validDigestHour(confirmationHour)) {
        throw new Error("Enter a window of at least 1 hour and digest hours between 0 and 23.");
      }
      await Promise.all([
        upsertOrgSetting(supabase, orgId, "offer_response_window_hours", windowHours),
        upsertOrgSetting(supabase, orgId, "offer_digest_hour_berlin", offerHour),
        upsertOrgSetting(supabase, orgId, "confirmation_digest_hour_berlin", confirmationHour),
      ]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Timing saved");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Deriving alone is not enough here: while the read is in flight there is nothing
  // to derive FROM, so the inputs would show the code defaults as if they were the
  // org's own and Save would persist them. Withhold the whole panel until the values
  // exist. Skipped when there is no active org (a super-admin bypasses the org gate),
  // where the query never runs and Save is already disabled.
  if (orgId && !times) return <Skeleton className="h-28 w-full" />;

  return (
    <div className="space-y-3">
      <div className="flex gap-2.5">
        <div className="flex-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Window (h)</Label>
          <Input type="number" min={1} className="mt-1 h-8" value={win} onChange={(e) => setWin(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Offer digest</Label>
          <Input type="number" min={0} max={23} className="mt-1 h-8" value={offer} onChange={(e) => setOffer(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Confirmations</Label>
          <Input type="number" min={0} max={23} className="mt-1 h-8" value={conf} onChange={(e) => setConf(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Berlin time. An artist offered at the digest hour has until that hour, window later.</p>
      <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>Save timing</Button>
    </div>
  );
}
