import { cn } from "@/lib/utils";

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

function Row({ row, last }: { row: CastRow; last: boolean }) {
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
            {row.name ?? "Open slot"}
          </p>
          <p className={cn("mt-px font-mono text-[11px] leading-[14px]", row.open ? "text-[var(--amber-600)]" : "text-[var(--text-faint)]")}>
            {row.meta}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.status && (
          <span
            className={cn(
              "rounded-[var(--radius-xs)] px-2 py-[3px] text-xs font-medium",
              row.status === "confirmed"
                ? "bg-[var(--green-100)] text-[var(--green-600)]"
                : row.status === "accepted"
                  ? "bg-accent-100 text-accent-700"
                  : "bg-[var(--amber-100)] text-[var(--amber-600)]",
            )}
          >
            {row.status === "confirmed" ? "Confirmed" : row.status === "accepted" ? "Accepted" : "Offered"}
          </span>
        )}
        {row.status === "accepted" && row.onConfirm && (
          <button
            type="button"
            onClick={row.onConfirm}
            className="h-[30px] rounded-[var(--radius-m)] border-[0.5px] border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-[var(--surface-2)]"
          >
            Confirm
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
          <button
            type="button"
            onClick={row.onCancel}
            // Hidden until the row is hovered/focused. `pointer-events-none` while
            // hidden so it is never a tap target on touch (no hover) — otherwise an
            // invisible control could fire an unconfirmed cancel.
            className="h-[30px] rounded-[var(--radius-m)] px-2 text-xs font-medium text-[var(--text-muted)] opacity-0 transition pointer-events-none hover:text-[var(--red-600)] focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** The cockpit Cast tab: one card per group (main cast, understudies), each with
 *  a count header and artist/open-slot rows. Matches the prototype's Cast panel. */
export function CockpitCastList({ groups }: { groups: CastGroup[] }) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div
          key={g.key}
          className="overflow-hidden rounded-[var(--radius-l)] border-[0.5px] border-[var(--line)] bg-[var(--surface)]"
        >
          <p className="border-b-[0.5px] border-[var(--line)] px-3.5 py-3 text-[11px] font-semibold uppercase leading-[14px] tracking-[1.6px] text-muted-foreground">
            {g.title} · {g.count}
          </p>
          {g.rows.map((r, i) => (
            <Row key={r.id} row={r} last={i === g.rows.length - 1} />
          ))}
        </div>
      ))}
    </div>
  );
}
