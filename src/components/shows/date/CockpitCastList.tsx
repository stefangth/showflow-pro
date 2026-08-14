import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { IconTooltip } from "@/components/common/IconTooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BOOKING_FLOW_DEFAULTS, type BookingFlow } from "@/lib/bookingFlow";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { confirmConsequenceNote, cancelBookingCopy, SOFT_BOOKED_MEANING } from "@/lib/bookings/actionCopy";

export type CastTone = "green" | "violet" | "amber";

// Use the semantic tokens (not raw hex) so avatars adapt in dark mode, matching
// the status badges below — CLAUDE.md: never hardcode colors.
const AVATAR_TONE: Record<CastTone, string> = {
  green: "bg-[var(--green-100)] text-[var(--green-600)]",
  violet: "bg-accent-100 text-accent-700",
  amber: "bg-[var(--amber-100)] text-[var(--amber-600)]",
};

export interface CastRow {
  id: string;
  /** Filled row: the artist. Omitted for an open slot. */
  name?: string;
  meta: string;
  tone?: CastTone;
  status?: "confirmed" | "accepted" | "offered";
  /** True → render as an empty (dashed-avatar) open slot. */
  open?: boolean;
  /** Confirm action, shown for accepted rows when the viewer may confirm. */
  onConfirm?: () => void;
  /** Cancel action on a filled row (producer/admin). Hover/focus-revealed so it
   *  stays out of the way but keeps the affordance the pre-cockpit rows had. */
  onCancel?: () => void;
  /** Open-slot primary action (e.g. "Open next tier" / "Book artist"). */
  slotActionLabel?: string;
  onSlotAction?: () => void;
}

export interface CastGroup {
  key: string;
  /** "Main cast" / "Understudies". */
  title: string;
  /** "2 of 4". */
  count: string;
  rows: CastRow[];
}

/** The flow fields the list needs for its point-of-action narration: the confirm
 *  consequence line, and (via cancelBookingCopy) the cancel dialog's understudy
 *  and who-hears lines. */
export type CockpitCastListFlow = Pick<BookingFlow, "active" | "confirmation_digest" | "understudy_promotion">;

const initialsOf = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function Avatar({ row }: { row: CastRow }) {
  if (row.open || !row.name) {
    return <span className="h-7 w-7 shrink-0 rounded-full border-[0.5px] border-dashed border-[var(--line-strong)]" />;
  }
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        AVATAR_TONE[row.tone ?? "violet"],
      )}
    >
      {initialsOf(row.name)}
    </span>
  );
}

const STATUS_BADGE_BASE = "rounded-[var(--radius-xs)] px-2 py-[3px] text-xs font-medium";

function StatusBadge({ status }: { status: NonNullable<CastRow["status"]> }) {
  const { t } = useTranslation("showsDetail");
  if (status === "accepted") {
    // "Accepted" is the cockpit's label for a soft_booked row: the artist said yes, but
    // nothing is booked until a producer confirms it — SOFT_BOOKED_MEANING spells that out
    // for anyone who reads "Accepted" as already-booked.
    return (
      <IconTooltip label={SOFT_BOOKED_MEANING}>
        <span className={cn(STATUS_BADGE_BASE, "bg-accent-100 text-accent-700")}>{t("cockpitCastList.accepted")}</span>
      </IconTooltip>
    );
  }
  return (
    <span
      className={cn(
        STATUS_BADGE_BASE,
        status === "confirmed" ? "bg-[var(--green-100)] text-[var(--green-600)]" : "bg-[var(--amber-100)] text-[var(--amber-600)]",
      )}
    >
      {status === "confirmed" ? t("cockpitCastList.confirmed") : t("cockpitCastList.offered")}
    </span>
  );
}

function Row({
  row, last, flow, bookingFlowEnabled, confirmationDigestHour,
}: {
  row: CastRow;
  last: boolean;
  flow: CockpitCastListFlow;
  bookingFlowEnabled: boolean;
  confirmationDigestHour: number;
}) {
  const { t } = useTranslation("showsDetail");
  const [cancelOpen, setCancelOpen] = useState(false);
  // Only an explicit active===false pauses promotion, matching the same convention used
  // throughout bookingFlow.ts and actionCopy.ts.
  const understudyPromotionEnabled = flow.active !== false && flow.understudy_promotion;
  // Memoised, not rebuilt on every render: the inputs are stable for a given row, and these
  // strings are only ever read inside the confirmation dialog below, so recomputing them each
  // time a sibling row's dialog opens/closes (or any parent re-render) is pure waste. Falls
  // back to a generic name so a booked row that somehow arrives without one still gets
  // coherent copy — the Cancel affordance keys on `onCancel` (below), never on this being
  // non-null, so it can no longer silently vanish just because `name` is absent.
  const cancelCopy = useMemo(
    () =>
      cancelBookingCopy({
        artistName: row.name ?? t("cockpitCastList.thisArtist"),
        understudyPromotionEnabled,
        bookingFlowEnabled,
        flow,
        confirmationDigestHour,
      }),
    [row.name, understudyPromotionEnabled, bookingFlowEnabled, flow, confirmationDigestHour, t],
  );

  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-3 px-3.5 py-[11px]",
        !last && "border-b-[0.5px] border-[var(--line)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar row={row} />
        <div className="min-w-0">
          <p className={cn("text-sm leading-[18px]", row.open ? "font-normal text-[var(--text-faint)]" : "font-medium text-foreground")}>
            {row.name ?? t("cockpitCastList.openSlot")}
          </p>
          <p className={cn("mt-px font-mono text-[11px] leading-[14px]", row.open ? "text-[var(--amber-600)]" : "text-[var(--text-faint)]")}>
            {row.meta}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.status && <StatusBadge status={row.status} />}
        {row.status === "accepted" && row.onConfirm && (
          <button
            type="button"
            onClick={row.onConfirm}
            className="h-[30px] rounded-[var(--radius-m)] border-[0.5px] border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-[var(--surface-2)]"
          >
            {t("cockpitCastList.confirm")}
          </button>
        )}
        {row.open && row.slotActionLabel && (
          <button
            type="button"
            onClick={row.onSlotAction}
            className="h-[30px] whitespace-nowrap rounded-[var(--radius-m)] border-[0.5px] border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-[var(--surface-2)]"
          >
            {row.slotActionLabel}
          </button>
        )}
        {!row.open && row.onCancel && (
          <>
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              // Hidden until the row is hovered/focused. `pointer-events-none` while
              // hidden so it is never a tap target on touch (no hover) — otherwise an
              // invisible control could fire an unconfirmed cancel.
              className="h-[30px] rounded-[var(--radius-m)] px-2 text-xs font-medium text-[var(--text-muted)] opacity-0 transition pointer-events-none hover:text-[var(--red-600)] focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
            >
              {t("cockpitCastList.cancel")}
            </button>
            {/* Cancellation is consequential (understudy promotion, an artist told), so it
                sits behind a confirmation dialog like the surface's other committing actions
                (EligibilityBookList's Book confirm, TierTimeline's open/close confirms). */}
            <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{cancelCopy.title}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {[cancelCopy.understudyLine, cancelCopy.whoHearsLine].filter(Boolean).join(" ")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("cockpitCastList.keepBooking")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      row.onCancel?.();
                      setCancelOpen(false);
                    }}
                  >
                    {t("cockpitCastList.cancelBooking")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </div>
  );
}

export interface CockpitCastListProps {
  groups: CastGroup[];
  /** Optional so a caller with no real org flow to read (the dev cockpit harness,
   *  `src/pages/DevCockpitHarness.tsx`, which renders fixture-only cast groups) still
   *  type-checks and renders instead of crashing on `flow.active`. Defaults to
   *  `BOOKING_FLOW_DEFAULTS`, the same fallback `ShowDateDetailSheet.tsx` itself uses when
   *  its own flow query hasn't resolved yet. */
  flow?: CockpitCastListFlow;
  /** The org's actual booking_flow entitlement (not the module-gate's super-admin-exempt
   *  read) — feeds cancelBookingCopy's who-hears line via scheduleChangeNote, which makes a
   *  factual claim about what will happen, not a permission check. Defaults to `false`
   *  (fail closed) when the caller has no real entitlement to pass. */
  bookingFlowEnabled?: boolean;
  /** Defaults to the canonical fallback hour when the caller has no resolved org setting. */
  confirmationDigestHour?: number;
}

/** The cockpit Cast tab: one card per group (main cast, understudies), each with
 *  a count header and artist/open-slot rows. Matches the prototype's Cast panel. */
export function CockpitCastList({
  groups,
  flow = BOOKING_FLOW_DEFAULTS,
  bookingFlowEnabled = false,
  confirmationDigestHour = BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin,
}: CockpitCastListProps) {
  // Rendered once for the whole list, not per row: every accepted row's Confirm button does
  // the same thing, so repeating this line once per row would just be noise.
  const hasConfirmable = groups.some((g) => g.rows.some((r) => r.status === "accepted" && r.onConfirm));

  return (
    <div className="flex flex-col gap-4">
      {hasConfirmable && (
        <p className="text-xs text-muted-foreground">
          {confirmConsequenceNote(flow, confirmationDigestHour, bookingFlowEnabled)}
        </p>
      )}
      {groups.map((g) => (
        <div
          key={g.key}
          className="overflow-hidden rounded-[var(--radius-l)] border-[0.5px] border-[var(--line)] bg-[var(--surface)]"
        >
          <p className="border-b-[0.5px] border-[var(--line)] px-3.5 py-3 text-[11px] font-semibold uppercase leading-[14px] tracking-[1.6px] text-muted-foreground">
            {g.title} · {g.count}
          </p>
          {g.rows.map((r, i) => (
            <Row
              key={r.id}
              row={r}
              last={i === g.rows.length - 1}
              flow={flow}
              bookingFlowEnabled={bookingFlowEnabled}
              confirmationDigestHour={confirmationDigestHour}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
