import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
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
 *  NO COLOUR FOR AN ANSWER, ONE EXCEPTION (`gated`, at the foot of this note).
 *  `full` used to route to `confirmed`, which is the
 *  green success pill: on the Administrator role that painted six green "Full"
 *  badges down the Access column, and green in a table of neutral facts reads
 *  as a verdict — as though "Full" were the good answer and "No access" the
 *  bad one. It is neither. The column answers "what does this role read", and
 *  the honest reading of six greens is closer to the opposite of reassuring.
 *  Colour is spent where it carries a state a reader must act on (the
 *  subprocessor Core/Consent/Off column on the public page, which is a
 *  different table with a different job), not here.
 *
 *  `full` and `scoped` therefore share one neutral fill — the pill's own text
 *  already says "Full" against "Own record", so the fill has nothing left to
 *  distinguish — and the distinctions the column does draw visually are the
 *  ones worth drawing.
 *
 *  `gated` is the second of them, and it is the one exception to the paragraph
 *  above: it does carry a state a reader must act on. It marks a row whose
 *  answer is conditional on a module the organisation may not have — today the
 *  hire-order fees row, since `hire_orders` ships with `defaultEnabled: false`
 *  (src/lib/entitlements.ts). "Full" printed in the same neutral fill as every
 *  other row tells an administrator of an organisation without the module
 *  something about their own workspace that is not true of it. The accent is
 *  the same one the public page gives the tone (landing Trust.tsx's
 *  ACCESS_TONE_STYLE), so the two surfaces read the same. */
const TONE_BADGE_VARIANT: Record<AccessTone, "confirmed" | "neutral" | "accent" | "outline"> = {
  full: "neutral",
  scoped: "neutral",
  gated: "accent",
  none: "outline",
};

/** The distinction is carried by the BORDER, not by the fill.
 *
 *  Routing `scoped` to `neutral` and `none` to `outline` was not enough on its
 *  own: both variants render `border-border`, so the only difference left in
 *  the app was `neutral`'s `bg-well-tint` against the Card. Two pills that
 *  differ subtly in fill are still one pill to a reader scanning the Access
 *  column.
 *
 *  The public page's ACCESS_TONE_STYLE (landing `Trust.tsx`) puts the
 *  difference on the edge instead: a granted answer is a filled surface with a
 *  TRANSPARENT hairline, `none` is transparent with a `--line-strong` hairline.
 *  Mirroring that here gives "No access" a visible outline against a
 *  borderless filled pill, which is the same grammar on both surfaces and a
 *  difference that survives a glance. `outline` also ships a `text-foreground`
 *  label, which would make "No access" the boldest text in the column, so the
 *  label stays muted — the one place this column does mute something, and it
 *  mutes the answer that means "nothing here". */
const TONE_BADGE_CLASS: Partial<Record<AccessTone, string>> = {
  full: "border-transparent",
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
  // `leading-[0]` so the raised glyph cannot grow the line box it sits in.
  // Without it the marker pushed the cross-organisation row off the declared
  // row height — a fraction of a pixel, but the point of a declared row height
  // is that there are no steps at all.
  return (
    <sup aria-hidden="true" className="ml-0.5 font-mono text-eyebrow leading-[0]">
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
  const { t } = useTranslation('settingsTrust');
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
      aria-label={t('visibilityMatrix.roleToInspect')}
      className="inline-flex gap-0.5 rounded-card bg-well-tint p-0.5"
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
              "whitespace-nowrap rounded-field px-3.5 py-1.5 text-caption font-medium transition-colors",
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
              // chip on the `bg-well-tint` track with this blend achieves
              // sufficient contrast against the track in both themes and is
              // still a neutral, so `focus-visible` keeps sole ownership of
              // the accent ring.
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
  const { t } = useTranslation('settingsTrust');
  const [role, setRole] = useState<TrustRole>("artist");
  const roleLabel = TRUST_ROLES.find((r) => r.value === role)?.label ?? role;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-md space-y-1">
          <h3 className="text-base font-semibold tracking-tight">{t('visibilityMatrix.title')}</h3>
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
            {t('visibilityMatrix.description')}
          </p>
        </div>
        <RolePicker value={role} onChange={setRole} />
      </div>

      {/* Re-announces the table's subject on every role change — the static
       *  caption below is not re-read by a screen reader on its own. */}
      <p aria-live="polite" className="sr-only">
        {t('visibilityMatrix.showingRole', { role: roleLabel })}
      </p>

      {/* >=1280px (xl): the table, in a scroll region a keyboard-only user can
       *  actually reach (tabIndex + role + aria-label, matching the public
       *  page's .tc-scroll wrappers).
       *
       *  THE BREAKPOINT MOVED lg -> xl, and it moved because the layout below
       *  is now `fixed`. This tab renders inside the app sidebar plus the
       *  settings nav column, so the table gets 1358px of a 1920 viewport,
       *  878 of 1440, 718 of 1280 and only 462 of 1024. At 462 a declared Data
       *  column wide enough for "Availability and blocked dates" leaves the
       *  Mechanism column 197px, which is three and four lines per cell — the
       *  ragged rhythm this whole change exists to remove, arriving by a
       *  different door. So 1024 and 1180 restack instead, which the audit's
       *  design lane already called the most readable rendering of this table.
       *
       *  FIXED, NOT AUTO. Auto layout hands the width to whichever Mechanism
       *  cell is longest, and that cell changes with the ROLE: measured on the
       *  public page at 1440, the Data column was 314.5px on Artist and 259.2px
       *  on Administrator, so the table visibly re-flowed under a control that
       *  is supposed to change only the answers. Declared widths make the grid
       *  stand still while the content behind it changes.
       *
       *  34% Data: the widest label is "Notes and cancellation reasons" at
       *  205.7px intrinsic (14px/500), and 34% of the narrowest table this
       *  branch renders (718px at 1280) is 244.1px, less the cell's 16px of
       *  padding-right — 228.1px of content box, so 22.4px of headroom at the
       *  tightest width and more everywhere above it. None of the eight wraps
       *  at any width or role. 108px Access: the widest pill is "Own booking"
       *  at 84.5px against a 96px content box.
       *
       *  BOTH FIGURES ARE MAXIMA OVER ALL THREE ROLES, which is the only way
       *  to read them: the pill values change with the role, so "Append-only"
       *  (83px) is the widest the Administrator column ever shows and "Own
       *  booking" (84.5px) is the widest the table can show at all. Two
       *  earlier drafts of this comment got this wrong in the same way — first
       *  naming "Availability and blocked dates" (194.9px, the second-widest
       *  label) and a 96px pill that was really the auto layout's whole column,
       *  then naming the second-widest pill after measuring only one role.
       *  These numbers are the justification for the one dimension the fix
       *  rests on, so they are re-measured rather than remembered. Source:
       *  .superpowers/sdd/2026-08-11-trust-center-findings-fix/shots-density/
       *  app-after/measurements.json, `matrix.labelIntrinsic`/`pillWidths`,
       *  folded to a maximum across every captured width and role.
       *
       *  min-w drops to 400px because a fixed layout no longer needs a floor
       *  to stop the Mechanism column collapsing — the declared widths are the
       *  floor. It is kept only so a sub-400px container scrolls rather than
       *  crushing the columns to nothing. */}
      <div
        className="-mx-1 hidden overflow-x-auto px-1 xl:block"
        tabIndex={0}
        role="region"
        aria-label={t('visibilityMatrix.regionScrollableLabel', { role: roleLabel })}
      >
        <table className="w-full min-w-[400px] table-fixed text-left">
          <caption className="sr-only">
            {t('visibilityMatrix.caption', { role: roleLabel })}
          </caption>
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[108px]" />
            <col />
          </colgroup>
          <thead>
            {/* eslint-disable-next-line no-restricted-syntax -- table header row, non-standard tracking */}
            <tr className="text-eyebrow font-semibold uppercase tracking-widest text-muted-foreground">
              <th scope="col" className="pb-2 font-semibold">{t('visibilityMatrix.columnData')}</th>
              <th scope="col" className="pb-2 font-semibold">{t('visibilityMatrix.columnAccess')}</th>
              <th scope="col" className="pb-2 font-semibold">{t('visibilityMatrix.columnMechanism')}</th>
            </tr>
          </thead>
          <tbody>
            {VISIBILITY_MATRIX.map((row) => {
              const cell = row[role];
              return (
                // ONE ROW HEIGHT, all eight rows, every width and every role.
                // `h-[50px]` on a table row is a floor, not a cap, so a cell
                // that ever needed a third line would still get it rather than
                // clipping; nothing does, because AccessCell.note is capped at
                // 110 characters and 110 characters is two lines of the
                // narrowest Mechanism column this branch renders. py-2 rather
                // than py-3 so a two-line cell measures 48px of content and
                // the floor is what every row lands on — 50px, against an auto
                // layout that produced 49 / 57 / 65 / 72 / 85 / 89px in one
                // table. 50 and not 49: the borders collapse, so a row driven
                // by its own content carries a border pixel that a row driven
                // by the floor does not, and the floor has to clear both.
                //
                // `align-top` rather than `align-middle`: the badge has to
                // line up with the first line of the mechanism it explains,
                // and centring a 22px pill against a two-line cell put it half
                // a line below the sentence it belongs to.
                <tr key={row.object} className="h-[50px] border-t border-border align-top">
                  <th scope="row" className="py-2 pr-4 text-sm font-medium">
                    {row.object}
                  </th>
                  <td className="py-2 pr-3">
                    <ToneBadge tone={cell.tone}>{cell.value}</ToneBadge>
                  </td>
                  <td
                    className="py-2 text-xs leading-4 text-muted-foreground"
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

      {/* <1280px (xl): the table restacks as one card per row instead of
       *  scrolling, the same trade the public page makes. The Mechanism
       *  column is this page's whole point and must not read as clipped
       *  text fragments. */}
      <div className="flex flex-col divide-y divide-border xl:hidden">
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
       *  of the table on purpose. Both surfaces laid the matrix out `auto`
       *  when it was moved, so the widest Mechanism cell took the width: as a
       *  54-word cell against 3-15 words everywhere else it squeezed the Data
       *  column to 147px at a 1440px viewport and wrapped five of the eight
       *  row labels onto two and three lines, running the table 108px taller.
       *  Both are `fixed` now (see the colgroup above), which removes that
       *  particular damage but not the reason to keep the sentence out here:
       *  at 54 words it would blow through the 110-character cell cap and take
       *  the row rhythm with it. It is the same sentence and it is still
       *  published — one row below, where it has room to be read, and where it
       *  serves the restacked card list as well as the table.
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
