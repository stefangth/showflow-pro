import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { ROUTES } from "@/config/app.config";
import { cancelAutopilotAskedIds, cancelAutopilotBookedIds, notifyCast, openOfferTier } from "@/data/bookings";
import { canUndoFeedRow, type AtRiskDate, type CancelledUntoldDate, type FeedRow, type TodayModel } from "@/lib/autopilot/today";
import { useAutopilotToday } from "@/hooks/useAutopilotToday";
import { useModuleGate } from "@/hooks/useEntitlements";
import { useCan } from "@/hooks/useCapabilities";
import { ModuleGate } from "@/components/layout/ModuleGate";
import { TodayHeader } from "./TodayHeader";
import { BouncedAsksBanner } from "./BouncedAsksBanner";
import { AtRiskDateCard } from "./AtRiskDateCard";
import { CancelledUntoldCard } from "./CancelledUntoldCard";
import { TodayEmpty } from "./TodayEmpty";
import { DoneForYouFeed } from "./DoneForYouFeed";
import { feedRowText } from "./feedRowText";

export interface TodayPageProps {
  model: TodayModel;
  /** "19:00" — the org's offer digest hour, formatted. */
  askTimeLabel: string;
  /** Weekday the feed's lookback window starts, e.g. "Friday". */
  feedSinceLabel: string;
  /** The viewer's own booking rights (`confirm_bookings` / `run_offer_engine`).
   *  Admins always hold both; an org admin can revoke either from producers, and
   *  the board's copy and actions have to follow — otherwise it tells a producer a
   *  date is "waiting on you to book them" and hands them buttons that 403. */
  canBook: boolean;
  canAsk: boolean;
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
  canBook,
  canAsk,
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
        producerConfirmation={model.producerConfirmation}
        canBook={canBook}
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
            canAsk={canAsk}
            canBook={canBook}
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

      <DoneForYouFeed
        feed={model.feed}
        producerConfirmation={model.producerConfirmation}
        canBook={canBook}
        canAsk={canAsk}
        sinceLabel={feedSinceLabel}
        onAction={onFeedAction}
      />
    </div>
  );
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
 * Action handlers here perform the real reversal mutations:
 * `cancelAutopilotAskedIds` to withdraw exactly the still-suggested offers an
 * "ask" feed row described, `cancelAutopilotBookedIds` to unbook exactly the
 * bookings a "book" feed row described (neither is a whole-date/whole-tier
 * sweep — see each function's own doc comment in `src/data/bookings.ts` for
 * why they, and not `closeOfferTier`/`bulkDeclineSoftBooked`, are the right
 * mutations here), and `openOfferTier` to actually open the next cast tier
 * from the at-risk card's primary button. Anything needing a piece of data
 * the model still doesn't carry falls back to navigating to the Dates board
 * rather than guessing.
 */
export default function TodayContainer() {
  const navigate = useNavigate();
  const { t } = useTranslation("today");
  const { allow: bookingFlowAllowed } = useModuleGate("booking_flow");
  // The same two rights every other booking surface gates on. Admins always hold
  // both (useCan short-circuits); a producer holds them only while the org's
  // capability policy grants them.
  const canBook = useCan("confirm_bookings");
  const canAsk = useCan("run_offer_engine");
  const { model, isLoading, isError, askTimeLabel, feedSinceLabel, refetch } = useAutopilotToday({
    enabled: bookingFlowAllowed,
  });

  function goToBookings(reason?: string) {
    if (reason) toast.info(reason);
    navigate(ROUTES.BOOKINGS);
  }

  /** Deep-link straight into a date's detail sheet on the Bookings page
   *  (`?date=<id>`), optionally landing on the Offers tab. Used by the card
   *  CTAs that carry a concrete `showDateId`, so "Open the date" opens the
   *  sheet instead of dropping the user on the unfiltered board. */
  function openDateSheet(showDateId: string, tab?: "offers") {
    const params = new URLSearchParams({ date: showDateId });
    if (tab) params.set("tab", tab);
    navigate(`${ROUTES.BOOKINGS}?${params.toString()}`);
  }

  function handleOpenNextCast(item: AtRiskDate) {
    if (item.nextTierNumber === null) {
      // Nothing left the facts layer knows how to open — open the date's sheet
      // so the producer can act on it directly, rather than guessing a tier.
      openDateSheet(item.showDateId);
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
    openDateSheet(item.showDateId);
  }

  function handleReadFirst(item: CancelledUntoldDate) {
    openDateSheet(item.showDateId);
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
    const context = feedRowText(t, row, {
      producerConfirmation: model?.producerConfirmation,
      canBook,
    });
    // Same rule the button's label reads (`canUndoFeedRow`), so a row shown as
    // Review can never run an undo mutation the viewer is not allowed to make.
    // This is also where "draft"/"notify" rows land: neither has a backing
    // reversal mutation, so `canUndoFeedRow` is false for both and they go to
    // the Dates board rather than doing nothing. Every kind that gets past this
    // guard returns from its own branch below, so there is no fallback after
    // them — a new FeedKind must either be handled here or add its own branch.
    if (row.affordance === "review" || !canUndoFeedRow(row.kind, { canBook, canAsk })) {
      goToBookings(context);
      return;
    }
    if (row.kind === "ask") {
      // Undo acts on exactly the still-suggested offers this row described
      // (finding 1) — never a whole-tier withdraw, since `open-offer-tier`
      // is idempotent and can have offered other artists outside this row's
      // window on a re-open.
      if (row.bookingIds.length === 0) {
        goToBookings(context);
        return;
      }
      cancelAutopilotAskedIds(supabase, { ids: row.bookingIds, now: new Date() })
        .then(({ affected }) => {
          if (affected === 0) {
            // The offers already moved on under us (e.g. answered or expired
            // some other way) — never claim success for a mutation that
            // changed nothing.
            toast.error(t("toast.bookingUndoneNothingChanged"));
            refetch();
            return;
          }
          toast.success(t("toast.askWithdrawnSuccess", { context }));
          refetch();
        })
        .catch(() => toast.error(t("toast.askWithdrawnError", { context })));
      return;
    }
    if (row.kind === "book") {
      // Undo acts on exactly the bookings this row described (findings 2/3)
      // — never a fresh date-wide fetch, and never soft_booked-only, since
      // Autopilot writes an accepted ask straight to confirmed.
      if (row.bookingIds.length === 0) {
        goToBookings(context);
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
          toast.success(t("toast.bookingUndoneSuccess", { count: affected, context }));
          refetch();
        })
        .catch(() => toast.error(t("toast.bookingUndoneError", { context })));
      return;
    }
  }

  return (
    <ModuleGate feature="booking_flow">
      {isLoading ? (
        <div className="flex max-w-[920px] flex-col gap-5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-32 w-full rounded-card" />
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
          canBook={canBook}
          canAsk={canAsk}
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
