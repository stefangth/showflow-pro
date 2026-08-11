import { useRef, useState, type KeyboardEvent } from "react";
import {
  CROSS_ORG_EXCEPTIONS_NOTE,
  VISIBILITY_MATRIX,
  TRUST_ROLES,
  type TrustRole,
} from "@/lib/trust/facts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AccessTone } from "@/lib/trust/facts";

/** Maps an access tone to the shared Badge component's variant, so the pills
 *  in this table stay on the design system rather than a hand-rolled palette.
 *
 *  Four tones, four treatments. `scoped` and `none` used to share `neutral`,
 *  which flattened the artist column into six identical grey pills ("Own
 *  record", "Own dates", "Own offers", "Own booking", "Own order", "No
 *  access") and left the Access column carrying no signal at all — the reader
 *  had to read every label. It also put the two surfaces into disagreement:
 *  the public page has always drawn `scoped` filled and `none` outlined.
 *  `outline` is transparent with a hairline, so "No access" now recedes
 *  against `scoped`'s filled `neutral` pill, matching that grammar. */
const TONE_BADGE_VARIANT: Record<AccessTone, "confirmed" | "neutral" | "accent" | "outline"> = {
  full: "confirmed",
  scoped: "neutral",
  gated: "accent",
  none: "outline",
};

/** The distinction is carried by the BORDER, not by the fill.
 *
 *  Routing `scoped` to `neutral` and `none` to `outline` was not enough on its
 *  own: both variants render `border-border`, so the only difference left in
 *  the app was `neutral`'s `bg-muted` against the Card, which measures 1.02:1
 *  in light and in dark. Two pills that differ by one hundredth of a contrast
 *  step are still one pill to a reader scanning the Access column.
 *
 *  The public page's TONE_STYLE (landing `Trust.tsx`) puts the difference on
 *  the edge instead: `scoped` is a filled surface with a TRANSPARENT hairline,
 *  `none` is transparent with a `--line-strong` hairline. Mirroring that here
 *  gives "No access" a visible outline against a borderless filled pill,
 *  which is the same grammar on both surfaces and a difference that survives
 *  a glance. `outline` also ships a `text-foreground` label, which would make
 *  "No access" the boldest text in the column, so the label stays muted. */
const TONE_BADGE_CLASS: Partial<Record<AccessTone, string>> = {
  scoped: "border-transparent",
  none: "border-muted-foreground/80 text-muted-foreground",
};

/** The one footnote this table has. Its id is what the qualified cells point
 *  at, so a screen-reader user who lands on the cross-organisation cell is
 *  read the exception note with it rather than meeting the unqualified claim
 *  and only finding the qualifier if they keep going past the table. */
const EXCEPTIONS_NOTE_ID = "trust-matrix-cross-org-exceptions";

/** The marker that ties a cell to that footnote. `aria-hidden` because the
 *  association is already carried by `aria-describedby`: without it a screen
 *  reader reads a bare "1" at the end of the sentence and then the whole note. */
function ExceptionsMark() {
  return (
    <sup aria-hidden="true" className="ml-0.5 font-mono text-[10px]">
      1
    </sup>
  );
}

function ToneBadge({ tone, children }: { tone: AccessTone; children: string }) {
  return (
    <Badge variant={TONE_BADGE_VARIANT[tone]} className={cn("whitespace-nowrap", TONE_BADGE_CLASS[tone])}>
      {children}
    </Badge>
  );
}

/** Segmented control for picking the role to inspect.
 *
 *  A radiogroup rather than a tablist: there is one table below and it is
 *  re-filtered, not swapped for a different panel. Tab semantics would promise
 *  a tabpanel per trigger that does not exist. Roving tabindex + arrow-key
 *  selection per the WAI-ARIA radiogroup pattern, so the control is both
 *  correctly labelled and actually operable from the keyboard. */
function RolePicker({ value, onChange }: { value: TrustRole; onChange: (r: TrustRole) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % TRUST_ROLES.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + TRUST_ROLES.length) % TRUST_ROLES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TRUST_ROLES.length - 1;
    if (next === -1) return;
    event.preventDefault();
    onChange(TRUST_ROLES[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Role to inspect"
      className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {TRUST_ROLES.map((role, index) => {
        const selected = role.value === value;
        return (
          <button
            key={role.value}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(role.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "whitespace-nowrap rounded-[6px] px-3.5 py-1.5 text-[12px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              // Selection is carried by the raised surface and a NEUTRAL
              // hairline, never by `--ring`. Two reasons, both keyboard-facing:
              // painting the selected chip in the focus colour meant a keyboard
              // user saw the same accent ring whether or not the control was
              // focused; and `ring-inset` sets `--tw-ring-inset: inset`
              // unconditionally, which Tailwind then composes into the
              // ring-offset shadow too, so `focus-visible:ring-2
              // ring-offset-2` rendered INSIDE the chip, a pixel from an
              // identical ring. The roving tabindex makes this chip the only
              // tab stop in the group, so that was the first and usually only
              // focus state a keyboard user met here.
              // The hairline is `muted-foreground/80`, not `border`. A raised
              // white chip on the `bg-muted` track measures 1.06:1 in light
              // and 1.08:1 in dark, and a `ring-border` hairline on top of it
              // only reached 1.20:1 / 1.16:1 — under the 3:1 a non-text state
              // indicator needs, which left selection carried by label colour
              // alone. This blend measures about 4:1 against the track in both
              // themes and is still a neutral, so `focus-visible` keeps sole
              // ownership of the accent ring.
              selected
                ? "bg-card text-foreground shadow-elev1 ring-1 ring-muted-foreground/80"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {role.label}
          </button>
        );
      })}
    </div>
  );
}

/** "Who can see what": pick a role, read what it can reach and why.
 *
 *  Only the three roles that exist inside an organisation are offered. Platform
 *  support access is deliberately not a column here — we would have to describe
 *  behaviour we cannot yet evidence, and a trust page is the wrong place to
 *  approximate. */
export function VisibilityMatrix() {
  const [role, setRole] = useState<TrustRole>("artist");
  const roleLabel = TRUST_ROLES.find((r) => r.value === role)?.label ?? role;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-md space-y-1">
          <h3 className="text-base font-semibold tracking-tight">Who can see what</h3>
          {/* "not the interface" was falsified two rows into the table it
           *  introduces: the Show-date chat cells say the database sets no
           *  time limit and the interface turns the thread read-only (admin)
           *  or stops showing it (production team) 30 days after the show
           *  date, which ChatPanel.tsx:141 confirms. The public page's
           *  equivalent line (landing Trust.tsx, Controls section) has always
           *  read "not just the interface"; the two surfaces were stating
           *  different things about the same claim and the app had the wrong
           *  one. VisibilityMatrix.test.tsx pins both halves: this wording,
           *  and the fact that some cell still credits the interface. */}
          <p className="text-sm text-muted-foreground">
            Answer an artist manager on the call. Roles are per organisation, and what each can
            read below is enforced in the database, not just the interface.
          </p>
        </div>
        <RolePicker value={role} onChange={setRole} />
      </div>

      {/* Re-announces the table's subject on every role change — the static
       *  caption below is not re-read by a screen reader on its own. */}
      <p aria-live="polite" className="sr-only">
        Showing what the {roleLabel} role can read
      </p>

      {/* >=1024px (lg): the table, in a scroll region a keyboard-only user can
       *  actually reach (tabIndex + role + aria-label, matching the public
       *  page's .tc-scroll wrappers). The breakpoint is lg, not sm: this tab
       *  always renders inside the app sidebar plus the settings nav column,
       *  so at a 768px viewport the tab itself only has ~460px to work with,
       *  well under the table's min-w. Restacking at sm (640px) left a dead
       *  band between 640 and ~1024px where the table rendered clipped with
       *  no scroll affordance.
       *
       *  min-w is 440px, not 560px, for the same reason. Measured live in the
       *  settings tab: a 1024px viewport leaves the table 470px, so a 560px
       *  floor clipped the Mechanism column by ~98px from 1024 up to ~1130 —
       *  the band moved rather than closing. 440px fits the narrowest width
       *  at which the table renders at all, with room to spare. */}
      <div
        className="-mx-1 hidden overflow-x-auto px-1 lg:block"
        tabIndex={0}
        role="region"
        aria-label={`What the ${roleLabel} role can read, and the mechanism that decides it, scrollable`}
      >
        <table className="w-full min-w-[440px] text-left">
          <caption className="sr-only">
            What the {roleLabel} role can read, and the mechanism that decides it
          </caption>
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <th scope="col" className="pb-2 font-semibold">Data</th>
              <th scope="col" className="pb-2 font-semibold">Access</th>
              <th scope="col" className="pb-2 font-semibold">Mechanism</th>
            </tr>
          </thead>
          <tbody>
            {VISIBILITY_MATRIX.map((row) => {
              const cell = row[role];
              return (
                <tr key={row.object} className="border-t border-border align-middle">
                  <th scope="row" className="py-3 pr-4 text-sm font-medium">
                    {row.object}
                  </th>
                  <td className="py-3 pr-3">
                    <ToneBadge tone={cell.tone}>{cell.value}</ToneBadge>
                  </td>
                  <td
                    className="py-3 text-xs leading-4 text-muted-foreground"
                    aria-describedby={cell.qualifiedByExceptionsNote ? EXCEPTIONS_NOTE_ID : undefined}
                  >
                    {cell.note}
                    {cell.qualifiedByExceptionsNote ? <ExceptionsMark /> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* <1024px (lg): the table restacks as one card per row instead of
       *  scrolling, the same trade the public page makes. The Mechanism
       *  column is this page's whole point and must not read as clipped
       *  text fragments. */}
      <div className="flex flex-col divide-y divide-border lg:hidden">
        {VISIBILITY_MATRIX.map((row) => {
          const cell = row[role];
          return (
            <div key={row.object} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-medium">{row.object}</span>
                <ToneBadge tone={cell.tone}>{cell.value}</ToneBadge>
              </div>
              <p
                className="mt-1.5 text-xs leading-4 text-muted-foreground"
                aria-describedby={cell.qualifiedByExceptionsNote ? EXCEPTIONS_NOTE_ID : undefined}
              >
                {cell.note}
                {cell.qualifiedByExceptionsNote ? <ExceptionsMark /> : null}
              </p>
            </div>
          );
        })}
      </div>

      {/* The four-table exclusion behind the cross-organisation row, held out
       *  of the table on purpose. Both surfaces lay the matrix out `auto`, so
       *  the widest Mechanism cell takes the width: as a 54-word cell against
       *  3-15 words everywhere else it squeezed the Data column to 147px at a
       *  1440px viewport and wrapped five of the eight row labels onto two and
       *  three lines, running the table 108px taller. It is the same sentence
       *  and it is still published — one row below, where it has room to be
       *  read, and where it serves the restacked card list as well as the
       *  table.
       *
       *  It is drawn AS a footnote rather than as another paragraph: the
       *  numbered marker pairs it with the cells that depend on it, and the
       *  measure is capped for the same reason the lede above is (this tab
       *  hands its width to the tables, so copy carries its own). Without the
       *  cap it ran 877px at 1440, about 155 characters, one element below a
       *  sibling deliberately held to 448px. */}
      <p
        id={EXCEPTIONS_NOTE_ID}
        className="flex max-w-2xl gap-2 text-xs leading-4 text-muted-foreground"
      >
        <span aria-hidden="true" className="font-mono">
          1
        </span>
        <span>{CROSS_ORG_EXCEPTIONS_NOTE}</span>
      </p>
    </div>
  );
}
