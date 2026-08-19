import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { ROUTES } from "@/config/app.config";
import { closeOfferTier, cancelAutopilotBookedIds, notifyCast, openOfferTier } from "@/data/bookings";
import type { AtRiskDate, CancelledUntoldDate, FeedRow, TodayModel } from "@/lib/autopilot/today";
import { useAutopilotToday } from "@/hooks/useAutopilotToday";
import { useModuleGate } from "@/hooks/useEntitlements";
import { ModuleGate } from "@/components/layout/ModuleGate";
import { TodayHeader } from "./TodayHeader";
import { BouncedAsksBanner } from "./BouncedAsksBanner";
import { AtRiskDateCard } from "./AtRiskDateCard";
import { CancelledUntoldCard } from "./CancelledUntoldCard";
import { TodayEmpty } from "./TodayEmpty";
import { DoneForYouFeed } from "./DoneForYouFeed";

export interface TodayPageProps {
  model: TodayModel;
  /** "19:00" — the org's offer digest hour, formatted. */
  askTimeLabel: string;
  /** Weekday the feed's lookback window starts, e.g. "Friday". */
  feedSinceLabel: string;
  /** Today's date, for the page eyebrow. */
  today: Date;
  onOpenNextCast: (item: AtRiskDate) => void;
  onOpenDate: (item: AtRiskDate) => void;
  onTellCast: (item: CancelledUntoldDate) => void;
  onReadFirst: (item: CancelledUntoldDate) => void;
  onFixBounced: () => void;
  onFeedAction: (row: FeedRow) => void;
  onLookAtSeason: () => void;
}

/**
 * The Autopilot Today board — presentational, per the controller ruling:
 * takes a fixture-friendly `model: TodayModel` plus action callbacks, no data
 * fetching of its own. `TodayContainer` below is the thin data-fetching
 * wrapper (`useAutopilotToday`) that a route mounts.
 */
export function TodayPage({
  model,
  askTimeLabel,
  feedSinceLabel,
  today,
  onOpenNextCast,
  onOpenDate,
  onTellCast,
  onReadFirst,
  onFixBounced,
  onFeedAction,
  onLookAtSeason,
}: TodayPageProps) {
  const [bouncedDismissed, setBouncedDismissed] = useState(false);
  const showBounced = model.bounced.length > 0 && !bouncedDismissed;

  return (
    <div className="flex max-w-[920px] flex-col gap-5">
      <TodayHeader
        openCount={model.openCount}
        fillingOnTheirOwn={model.fillingOnTheirOwn}
        bookedOvernight={model.bookedOvernight}
        today={today}
      />

      {showBounced && (
        <BouncedAsksBanner
          bounced={model.bounced}
          onFix={onFixBounced}
          onDismiss={() => setBouncedDismissed(true)}
        />
      )}

      {model.items.map((item) =>
        item.kind === "at_risk" ? (
          <AtRiskDateCard
            key={item.showDateId}
            item={item}
            askTimeLabel={askTimeLabel}
            onOpenNextCast={onOpenNextCast}
            onOpenDate={onOpenDate}
          />
        ) : (
          <CancelledUntoldCard
            key={item.showDateId}
            item={item}
            onTellCast={onTellCast}
            onReadFirst={onReadFirst}
          />
        ),
      )}

      {model.items.length === 0 && (
        <TodayEmpty fillingOnTheirOwn={model.fillingOnTheirOwn} onLookAtSeason={onLookAtSeason} />
      )}

      <DoneForYouFeed feed={model.feed} sinceLabel={feedSinceLabel} onAction={onFeedAction} />
    </div>
  );
}

/** `id: "ask:<showDateId>:<tier>"` — the exact contract documented on
 *  `fetchAutopilotFeed` in src/data/autopilot.ts. Returns null on any
 *  shape mismatch rather than throwing, so a future format change degrades
 *  to a no-op instead of a crash. */
function parseAskFeedId(id: string): { showDateId: string; tier: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== "ask") return null;
  const tier = Number(parts[2]);
  if (!Number.isFinite(tier) || tier < 1) return null;
  return { showDateId: parts[1], tier };
}

/**
 * Thin data-fetching wrapper: composes `useAutopilotToday` and renders
 * `TodayPage`. This is what `/dashboard` mounts (`DashboardPage`) for any
 * non-artist-only viewer. Every card on the board is booking-engine content
 * (open tiers, at-risk dates, offer digests), so the whole thing is wrapped
 * in `ModuleGate feature="booking_flow"` — mirrors the gate the old
 * `ProducerBookingSection` used to apply on the dashboard it replaced. The
 * `booking_flow` allow state is also threaded into `useAutopilotToday` as
 * `enabled` so an unentitled org never fires the underlying queries, not just
 * hides their output.
 *
 * Action handlers here perform the real reversal mutations: `closeOfferTier`
 * to un-ask, `cancelAutopilotBookedIds` to unbook exactly the bookings a
 * "book" feed row described (never a whole-date sweep — see
 * `cancelAutopilotBookedIds`'s own doc comment for why it, and not
 * `bulkDeclineSoftBooked`, is the right mutation here), and `openOfferTier`
 * to actually open the next cast tier from the at-risk card's primary
 * button. Anything needing a piece of data the model still doesn't carry
 * falls back to navigating to the Dates board rather than guessing.
 */
export default function TodayContainer() {
  const navigate = useNavigate();
  const { t } = useTranslation("today");
  const { allow: bookingFlowAllowed } = useModuleGate("booking_flow");
  const { model, isLoading, isError, askTimeLabel, feedSinceLabel, refetch } = useAutopilotToday({
    enabled: bookingFlowAllowed,
  });

  function goToBookings(reason?: string) {
    if (reason) toast.info(reason);
    navigate(ROUTES.BOOKINGS);
  }

  function handleOpenNextCast(item: AtRiskDate) {
    if (item.nextTierNumber === null) {
      // Nothing left the facts layer knows how to open — fall back to the
      // Dates board rather than guessing a tier.
      goToBookings(`${item.title} · ${item.where}`);
      return;
    }
    const cast = item.nextCastName ?? "";
    openOfferTier(supabase, { showDateId: item.showDateId, tier: item.nextTierNumber })
      .then(({ offersCreated }) => {
        if (offersCreated === 0) {
          // Nobody was actually asked (e.g. the whole cast turned out
          // ineligible/blocked by the time this ran) — never claim success
          // for an action that changed nothing.
          toast.error(t("toast.castAskedError", { cast, title: item.title }));
          refetch();
          return;
        }
        toast.success(t("toast.castAskedSuccess", { cast, title: item.title }));
        refetch();
      })
      .catch(() => toast.error(t("toast.castAskedError", { cast, title: item.title })));
  }

  function handleOpenDate(item: AtRiskDate) {
    goToBookings(`${item.title} · ${item.where}`);
  }

  function handleReadFirst(item: CancelledUntoldDate) {
    goToBookings(`${item.title} · ${item.where}`);
  }

  function handleTellCast(item: CancelledUntoldDate) {
    notifyCast(supabase, { showDateId: item.showDateId })
      .then(() => {
        toast.success(t("toast.castToldSuccess", { title: item.title }));
        refetch();
      })
      .catch(() => {
        toast.error(t("toast.castToldError", { title: item.title }));
      });
  }

  function handleFixBounced() {
    navigate(ROUTES.ARTISTS);
  }

  function handleLookAtSeason() {
    navigate(ROUTES.BOOKINGS);
  }

  function handleFeedAction(row: FeedRow) {
    if (row.affordance === "review") {
      goToBookings(row.text);
      return;
    }
    if (row.kind === "ask") {
      const parsed = parseAskFeedId(row.id);
      if (!parsed) {
        goToBookings(row.text);
        return;
      }
      closeOfferTier(supabase, { showDateId: parsed.showDateId, tier: parsed.tier, withdraw: true })
        .then(() => {
          toast.success(t("toast.askWithdrawnSuccess", { context: row.text }));
          refetch();
        })
        .catch(() => toast.error(t("toast.askWithdrawnError", { context: row.text })));
      return;
    }
    if (row.kind === "book") {
      // Undo acts on exactly the bookings this row described (findings 2/3)
      // — never a fresh date-wide fetch, and never soft_booked-only, since
      // Autopilot writes an accepted ask straight to confirmed.
      if (row.bookingIds.length === 0) {
        goToBookings(row.text);
        return;
      }
      cancelAutopilotBookedIds(supabase, { ids: row.bookingIds, now: new Date() })
        .then(({ affected }) => {
          if (affected === 0) {
            // The bookings already moved on under us (e.g. cancelled some
            // other way) — never claim success for a mutation that changed
            // nothing.
            toast.error(t("toast.bookingUndoneNothingChanged"));
            refetch();
            return;
          }
          toast.success(t("toast.bookingUndoneSuccess", { count: affected, context: row.text }));
          refetch();
        })
        .catch(() => toast.error(t("toast.bookingUndoneError", { context: row.text })));
      return;
    }
    // "draft" / "notify" undo has no backing reversal mutation (see the task
    // report) — fall back to the Dates board rather than doing nothing.
    goToBookings(row.text);
  }

  return (
    <ModuleGate feature="booking_flow">
      {isLoading ? (
        <div className="flex max-w-[920px] flex-col gap-5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full rounded-[14px]" />
          <Skeleton className="h-32 w-full rounded-[14px]" />
        </div>
      ) : isError || !model ? (
        <Alert variant="destructive" className="max-w-[920px]">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>{t("error")}</AlertDescription>
        </Alert>
      ) : (
        <TodayPage
          model={model}
          askTimeLabel={askTimeLabel}
          feedSinceLabel={feedSinceLabel}
          today={new Date()}
          onOpenNextCast={handleOpenNextCast}
          onOpenDate={handleOpenDate}
          onTellCast={handleTellCast}
          onReadFirst={handleReadFirst}
          onFixBounced={handleFixBounced}
          onFeedAction={handleFeedAction}
          onLookAtSeason={handleLookAtSeason}
        />
      )}
    </ModuleGate>
  );
}
