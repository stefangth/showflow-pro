import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { upsertOrgSetting } from "@/data/settings";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import {
  describeTonight,
  timingScopeNote,
  isValidDigestHour,
  isValidWindowHours,
  timingBoundsError,
} from "@/lib/bookings/timingCopy";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useDerivedDraft } from "@/hooks/useDerivedDraft";

/** The rail's timing panel: offer window and the two Berlin digest hours, shown as the
 *  org's live values and written as the three settings keys. The code defaults
 *  (48h / 19:00 / 20:00) are never displayed as if they were the org's own -- the
 *  panel waits for the read, see the gate below. */
export function TimingStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const { t: tBooking } = useTranslation("bookingCopy");
  const qc = useQueryClient();
  const { data: times, isError, error } = useFlowTimes(orgId);
  // The org this panel was HANDED, not whichever org the shell happens to be on.
  // `useBookingFlow()` otherwise resolves its own org out of AuthContext while the hours
  // above key on the `orgId` prop. Every shipped host passes `currentOrg?.id`, so the two
  // agree today, but the flow is what decides whether the sentence under these fields is
  // about a digest, an instant send, or nothing at all. One org source, stated once.
  // The null-org narrowing stays as defense in depth: `useBookingFlow` now disables its
  // own query for a null org, but if that gate ever regressed, fetchBookingFlow(client,
  // null) returns a truthy, offers-shaped PLATFORM DEFAULT flow belonging to no org,
  // which would walk straight past the unknown-flow branches that timingCopy documents
  // at length. No org, no flow to narrate.
  const flowQ = useBookingFlow(orgId);
  const flow = orgId ? flowQ.data : null;
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
      // by the engine (offers would expire the instant they open). Guard before writing,
      // through the same predicates the narrative below refuses to describe, so the panel
      // cannot promise a schedule this save would reject.
      if (
        !isValidWindowHours(windowHours) ||
        !isValidDigestHour(offerHour) ||
        !isValidDigestHour(confirmationHour)
      ) {
        throw new Error(timingBoundsError(tBooking));
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

  // A failed read must say so rather than fall through, for the same reason the
  // panel waits below: the inputs would show the code defaults as if they were the
  // org's own. It must also not fall through to that skeleton, which `data` being
  // undefined forever (React Query keeps no data on error) would make permanent --
  // a silent dead end in the rail. Same guard as LetterheadStep/CountersignStep.
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the timing settings. {(error as Error)?.message}
        </AlertDescription>
      </Alert>
    );
  }
  // Deriving alone is not enough here: while the read is in flight there is nothing
  // to derive FROM, so the inputs would show the code defaults as if they were the
  // org's own and Save would persist them. Withhold the whole panel until the values
  // exist. Skipped when there is no active org (a super-admin bypasses the org gate),
  // where the query never runs and Save is already disabled.
  if (orgId && !times) return <Skeleton className="h-28 w-full" />;

  // An empty field must not read as hour 0 / a 0-hour window: Number("") is 0, which is a
  // perfectly valid hour, so the narrative would confidently announce a 00:00 digest the
  // moment someone selects the field to retype it. NaN makes describeTonight fall silent.
  // The skeleton gate above already guarantees the org's own hours are on screen before
  // this computes (the old `seeded` latch this replaces existed for exactly that), and
  // `describeTonight` itself refuses an unknown flow, so nothing here can narrate the
  // platform defaults, a paused org, or a pipeline this org does not run.
  const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
  const tonight = describeTonight(
    { windowHours: num(win), offerDigestHour: num(offer), confirmationDigestHour: num(conf) },
    flow,
    tBooking,
  );

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
      {/* Two lines, both flow-aware. The scope note is always true (it reads the flow
          only); the narrative adds the schedule once the reads land. The fixed line these
          replaced ("An artist offered at the digest hour has until that hour, window
          later") described the classic pipeline as universal: it contradicted the
          narrative under it at a fast-track org, and at a direct-book org it was the only
          sentence on the panel and it was wrong. */}
      <p className="text-xs text-muted-foreground">{timingScopeNote(flow, tBooking)}</p>
      {tonight && <p className="text-xs text-muted-foreground">{tonight}</p>}
      <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>Save timing</Button>
    </div>
  );
}
