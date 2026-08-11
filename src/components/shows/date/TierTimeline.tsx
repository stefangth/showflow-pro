import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { offerConfirmCopy, closeConfirmCopy, pendingOfferCount } from "@/lib/bookings";
import { TIER_CONCEPT_NOTE } from "@/lib/bookings/actionCopy";
import { ROUTES } from "@/config/app.config";
import type { OpenedTier, ExcludedDetailEntry } from "@/data/bookings";
import type { BookingFlow } from "@/lib/bookingFlow";
import type { SlotDraft } from "@/data/slots";
import type { TierLadderRow } from "@/data/tierLadder";
import type { OfferTarget } from "@/lib/offerTarget";
import { NextOfferHero } from "./NextOfferHero";
import { RequiredSkillsCard } from "./RequiredSkillsCard";
import { TierLadder, type TierLadderRowStatus } from "./TierLadder";

export interface TierTimelineProps {
  /** Identity of the date this timeline is scoped to — used only for the debug
   *  data-attribute; the caller owns the queries keyed on it. */
  showDateId: string;
  /** Human date label (e.g. "Mon 14 Jul 2026") for the open-tier confirm copy. */
  dateLabel: string;
  flow: Pick<BookingFlow, "artist_acceptance" | "offer_delivery">;
  /** Non-cancelled+cancelled booking rows for this date; feeds the close dialog's
   *  pending-offer count. */
  bookings: Array<{ status: string; offer_tier: number | null }>;
  /** Whether the viewer can run the offer engine (open/close). When false the
   *  hero and the ladder's Close controls are hidden; the cards stay read-only. */
  canManage: boolean;
  /** Whether the date has any session time configured — gates the confirm action. */
  hasSession: boolean;
  /** Whether the tier ladder comes from the show's own eligibility rows ("show")
   *  or the org-wide city priority fallback ("org"). */
  ladderSource: "show" | "org";
  /** Org skills — the pool the "Narrow this offer" chips draw from. */
  skills: { id: string; name: string }[];
  /** Tiers already opened for this date (fetchOpenedTiers' return shape). */
  openedTiers: OpenedTier[];
  openPending?: boolean;
  closePending?: boolean;
  onOpenTier: (tier: number, skillFilterIds: string[]) => void;
  onCloseTier: (tier: number, withdraw: boolean) => void;
  onPreviewTier: (tier: number, skillFilterIds: string[]) => void;

  // ── design 1e cards (hosted here so the sheet's Offers JSX stays one mount) ──
  /** Program name, for RequiredSkillsCard's subtitle. */
  show: string;
  /** Named production slots, for RequiredSkillsCard's provenance. */
  slots: SlotDraft[];
  showSkillIds: string[];
  dateSkillIds: string[];
  droppedSkillIds: string[];
  /** Removes all date-adds and drops (sheet-owned mutation). */
  onResetSkills: () => void;
  /** Routes to the Setup tab's date configuration. */
  onEditSkills: () => void;
  /** Per-tier headcounts for the tier ladder card. */
  ladderRows: TierLadderRow[];
  /** City name, for the tier ladder subtitle. */
  cityName: string;
  /** Per-opened-tier booking status counts (one entry per opened tier). */
  statusByTier: TierLadderRowStatus[];
  /** The next tier to offer to (accent ring + hero), or null when all are opened. */
  nextTier: number | null;
  /** The resolved next-offer target (single cast or the tier fallback). */
  nextTierTarget: OfferTarget | null;
  /** The next tier's ladder row (hero counts + cast-aware confirm copy). */
  nextTierCounts: TierLadderRow | null;
  /** Required-skill names for the hero body + cast-aware confirm copy. */
  requiredSkillNames: string[];
  /** Required-skill ids, so the narrow chips offer only the NON-required skills. */
  requiredSkillIds: string[];
  /** Dry-run candidates for the next tier's avatar row (or [] until previewed). */
  candidates: { id: string; name: string }[];
  /** Named per-artist exclusions for the cast-aware confirm copy's "Not offered" line. */
  excludedDetail?: ExcludedDetailEntry[];
}

/** The Offers-tab tiered cockpit (design 1e): the next-offer hero, the computed
 *  required-skills card, and the show-specific tier ladder, plus the open/close
 *  confirm dialogs. Presentational: all mutations arrive as callbacks; the caller
 *  (ShowDateDetailSheet) owns the underlying queries and mutations. */
export function TierTimeline({
  showDateId, dateLabel, flow, bookings, canManage, hasSession, ladderSource,
  skills, openedTiers, openPending = false, closePending = false,
  onOpenTier, onCloseTier, onPreviewTier,
  show, slots, showSkillIds, dateSkillIds, droppedSkillIds, onResetSkills, onEditSkills,
  ladderRows, cityName, statusByTier, nextTier, nextTierTarget, nextTierCounts,
  requiredSkillNames, requiredSkillIds, candidates, excludedDetail,
}: TierTimelineProps) {
  // The open-offer confirm dialog is controlled (like the close dialog) so the
  // hero can open it programmatically for the resolved next tier. `skillFilterIds`
  // is the "Narrow this offer" state, shared by the confirm and the preview.
  const [openTarget, setOpenTarget] = useState<number | null>(null);
  const [closeTarget, setCloseTarget] = useState<number | null>(null);
  const [skillFilterIds, setSkillFilterIds] = useState<string[]>([]);
  const [narrowActive, setNarrowActive] = useState(false);

  if (!flow.artist_acceptance) {
    return (
      <p className="text-sm text-muted-foreground" aria-label="Offer tiers">
        Direct booking: producers book from the eligibility list
      </p>
    );
  }

  // Preserve the order skills were toggled in (not the `skills` prop order).
  const skillFilterNames = skillFilterIds
    .map((id) => skills.find((s) => s.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  // Cast-aware confirm copy (owner's RELABEL rule): name the cast + its match
  // count only when the next tier resolves to a SINGLE cast AND no extra skill
  // filter is applied. A narrow filter shrinks the pool, so the unfiltered cast
  // count would overstate — fall back to the tier copy, which surfaces the cue.
  const useCastCopy = nextTierTarget?.kind === "cast" && skillFilterIds.length === 0;
  const confirmCopy = openTarget != null
    ? offerConfirmCopy({
      tier: openTarget,
      dateLabel,
      alreadyOpened: openedTiers.some((o) => o.tier === openTarget),
      offerDelivery: flow.offer_delivery,
      skillFilterNames,
      ...(useCastCopy
        ? {
          castName: nextTierTarget!.cast.name,
          matchCount: nextTierCounts?.matchCount,
          castTotal: nextTierCounts?.castTotal,
          requiredSkillNames,
          excludedDetail,
        }
        : {}),
    })
    : null;

  const closeCopy = closeTarget !== null
    ? closeConfirmCopy({ tier: closeTarget, pendingCount: pendingOfferCount(bookings, closeTarget) })
    : null;

  // The narrow chips offer only skills the date doesn't already require.
  const narrowSkills = skills.filter((s) => !requiredSkillIds.includes(s.id));

  // A viewer who can't run the offer engine sees opened tiers read-only (no Close
  // control), mirroring the old opened-badge canManage gate.
  const ladderOpenedTiers = openedTiers.map((o) => ({
    tier: o.tier,
    closed: !!o.closedAt || !canManage,
  }));

  return (
    <div className="space-y-4" data-show-date-id={showDateId} aria-label="Offer tier timeline">
      {ladderSource === "show" && (
        <p className="text-xs text-muted-foreground">Using show-specific priorities</p>
      )}

      {canManage && nextTier != null && nextTierTarget && nextTierCounts && (
        <NextOfferHero
          target={nextTierTarget}
          counts={nextTierCounts}
          candidates={candidates}
          requiredSkillNames={requiredSkillNames}
          onOpen={() => setOpenTarget(nextTier)}
          onSeeArtists={() => onPreviewTier(nextTier, skillFilterIds)}
          onNarrow={() => setNarrowActive((a) => !a)}
          narrowActive={narrowActive}
          narrowSkills={narrowSkills}
          narrowSkillIds={skillFilterIds}
          onToggleNarrowSkill={(id) =>
            setSkillFilterIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
        />
      )}

      <RequiredSkillsCard
        show={show}
        slots={slots}
        showSkillIds={showSkillIds}
        dateSkillIds={dateSkillIds}
        droppedSkillIds={droppedSkillIds}
        skills={skills}
        onReset={onResetSkills}
        onEdit={onEditSkills}
      />

      <TierLadder
        rows={ladderRows}
        city={cityName}
        openedTiers={ladderOpenedTiers}
        statusByTier={statusByTier}
        nextTier={canManage ? nextTier : null}
        onCloseTier={(tier) => setCloseTarget(tier)}
      />

      {/* What a tier even is, stated once — a producer opening this tab for the
          first time has no other cue for it. */}
      <p className="text-xs text-muted-foreground">
        {TIER_CONCEPT_NOTE}{" "}
        <Link to={`${ROUTES.SETTINGS}?tab=docs`} className="text-primary underline">
          How casts and tiers work
        </Link>
      </p>

      {canManage && !hasSession && (
        <p className="text-xs text-muted-foreground">Add a session time before opening offers.</p>
      )}

      {/* Open-offer confirmation (controlled; opened by the hero for the next tier) */}
      <AlertDialog open={openTarget !== null} onOpenChange={(o) => { if (!o) setOpenTarget(null); }}>
        <AlertDialogContent>
          {openTarget !== null && confirmCopy && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
                <AlertDialogDescription>{confirmCopy.body}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={openPending || !hasSession}
                  onClick={() => onOpenTier(openTarget, skillFilterIds)}
                >
                  Open offers
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Close-tier confirmation (choose withdraw vs keep) */}
      <AlertDialog open={closeTarget !== null} onOpenChange={(o) => { if (!o) setCloseTarget(null); }}>
        <AlertDialogContent>
          {closeTarget !== null && closeCopy && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{closeCopy.title}</AlertDialogTitle>
                <AlertDialogDescription>{closeCopy.intro}</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <AlertDialogAction asChild>
                  <button
                    type="button"
                    disabled={closePending}
                    onClick={() => onCloseTier(closeTarget, true)}
                    className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted disabled:opacity-50"
                  >
                    <p className="text-sm font-medium">{closeCopy.withdraw.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{closeCopy.withdraw.caption}</p>
                  </button>
                </AlertDialogAction>
                <AlertDialogAction asChild>
                  <button
                    type="button"
                    disabled={closePending}
                    onClick={() => onCloseTier(closeTarget, false)}
                    className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted disabled:opacity-50"
                  >
                    <p className="text-sm font-medium">{closeCopy.keep.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{closeCopy.keep.caption}</p>
                  </button>
                </AlertDialogAction>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
