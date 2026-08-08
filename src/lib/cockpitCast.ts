// Maps real bookings + slot config into the cockpit Cast-tab groups
// (`CockpitCastList`). Kept out of the component so it is unit-testable with
// plain data. Callbacks are injected so the list rows can confirm / jump to the
// offers tab without this module importing React or Supabase.
import type { CastGroup, CastRow, CastTone } from "@/components/shows/date/CockpitCastList";
import { bookingStatusDisplayLabel } from "@/lib/bookings";

// The booking clock is Berlin-anchored, so a confirmation date is formatted in
// Europe/Berlin rather than the viewer's local timezone (which could show the
// wrong day for a confirmation that landed near midnight Berlin time).
const berlinDayMonth = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", day: "numeric", month: "short" }).format(d);

export interface CastBookingLike {
  id: string;
  status: string;
  is_understudy: boolean;
  offer_tier: number | null;
  confirmed_at: string | null;
  artist: { name: string } | null;
}

/** Named rows in a group are the ones with a real artist attached to the slot. */
const NAMED = new Set(["confirmed", "soft_booked", "suggested"]);

const toneFor = (status: string): CastTone =>
  status === "confirmed" ? "green" : status === "soft_booked" ? "violet" : "amber";

const badgeFor = (status: string): CastRow["status"] =>
  status === "confirmed" ? "confirmed" : status === "soft_booked" ? "accepted" : "offered";

function metaFor(b: CastBookingLike): string {
  const tier = b.offer_tier ? `Tier ${b.offer_tier}` : null;
  const stamp =
    b.confirmed_at && !Number.isNaN(new Date(b.confirmed_at).getTime())
      ? berlinDayMonth(new Date(b.confirmed_at))
      : null;
  const word =
    b.status === "confirmed"
      ? stamp
        ? `confirmed ${stamp}`
        : "confirmed"
      : b.status === "soft_booked"
        ? "accepted"
        : b.status === "suggested"
          ? "offer pending"
          : bookingStatusDisplayLabel(b.status);
  return [tier, word].filter(Boolean).join(" · ");
}

export interface BuildCastGroupsOpts {
  canConfirm: boolean;
  onConfirm: (bookingId: string) => void;
  /** Whether the viewer may cancel a booking (broad producer/admin gate). */
  canCancel: boolean;
  onCancel: (bookingId: string) => void;
  /** Whether the viewer may act on an open slot — the capability that gates the
   *  target action, NOT confirm_bookings: run_offer_engine for the classic offer
   *  flow, plain canManage for direct booking. */
  canOpenSlot: boolean;
  /** Flow-appropriate open-slot label ("Open next tier" classic / "Book artist"
   *  direct). */
  slotActionLabel: string;
  /** Jump to the offers/book tab from an open slot. */
  onOpenSlot: () => void;
}

/**
 * Build the Main cast / Understudies groups for the cockpit Cast tab. Named rows
 * (confirmed → accepted → offered) come first, then dashed open-slot rows up to
 * the configured capacity. When the date has no slot config, capacity is unknown
 * so only the named rows render (no open slots, no "N of M" count).
 */
export function buildCastGroups(
  bookings: CastBookingLike[],
  slots: { main_cast: number; understudies: number } | null,
  opts: BuildCastGroupsOpts,
): CastGroup[] {
  const active = bookings.filter((b) => b.status !== "cancelled");

  const make = (isUnderstudy: boolean, title: string, capacity: number | null): CastGroup => {
    const inGroup = active.filter((b) => Boolean(b.is_understudy) === isUnderstudy);
    const named = inGroup.filter((b) => NAMED.has(b.status));
    const confirmed = inGroup.filter((b) => b.status === "confirmed").length;
    const pending = inGroup.filter((b) => b.status === "suggested").length;
    // Only confirmed/accepted actually fill a slot — the same semantics the header
    // meter uses. `suggested` (merely offered) bookings are shown as extra named
    // rows layered on top; a tier is routinely offered to more candidates than
    // there are slots, so they must NOT consume the open-slot rows.
    const filled = inGroup.filter((b) => b.status === "confirmed" || b.status === "soft_booked").length;

    const rows: CastRow[] = named.map((b) => ({
      id: b.id,
      name: b.artist?.name ?? "Artist",
      meta: metaFor(b),
      tone: toneFor(b.status),
      status: badgeFor(b.status),
      onConfirm: b.status === "soft_booked" && opts.canConfirm ? () => opts.onConfirm(b.id) : undefined,
      onCancel: opts.canCancel ? () => opts.onCancel(b.id) : undefined,
    }));

    // Open dashed rows = unfilled slots (capacity minus filled). Unknown capacity
    // (unconfigured date) → no open rows, but named/offered rows still render.
    const open = capacity != null ? Math.max(0, capacity - filled) : 0;
    for (let i = 0; i < open; i++) {
      rows.push({
        id: `${isUnderstudy ? "us" : "main"}-open-${i}`,
        open: true,
        // `pending` is a group total, so annotate only the first open row —
        // repeating "N offers pending" on every open slot reads as N-per-slot.
        meta: i === 0 && pending > 0 ? `${pending} ${pending === 1 ? "offer" : "offers"} pending` : "No booking yet",
        slotActionLabel: opts.canOpenSlot ? opts.slotActionLabel : undefined,
        onSlotAction: opts.onOpenSlot,
      });
    }

    return {
      key: isUnderstudy ? "us" : "main",
      title,
      count: capacity != null ? `${confirmed} of ${capacity}` : `${confirmed}`,
      rows,
    };
  };

  const groups: CastGroup[] = [make(false, "Main cast", slots ? slots.main_cast : null)];
  // Show the understudies group whenever it has capacity OR an active understudy
  // booking exists — otherwise a booking left over after capacity was reduced to 0
  // would silently vanish from the tab while still counted in the header/footer.
  const wantUnderstudies = (slots ? slots.understudies > 0 : false) || active.some((b) => b.is_understudy);
  if (wantUnderstudies) groups.push(make(true, "Understudies", slots ? slots.understudies : null));
  return groups;
}
