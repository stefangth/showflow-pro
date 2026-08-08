import type { ReactNode } from "react";

export interface CockpitShellProps {
  /** Anchored header (title, meter, tabs) — rendered sticky at the top. */
  header: ReactNode;
  /** Optional banners under the header (slot-config warning, cancelled notice). */
  banner?: ReactNode;
  /** Left facts / activity / chat rail. */
  rail: ReactNode;
  /** Active tab body. */
  children: ReactNode;
  /** Persistent hire-order footer, pinned to the bottom of the work column. */
  footer?: ReactNode;
}

/**
 * Presentational cockpit shell: the anchored header, the rail + work columns,
 * and the persistent footer. Owns *only* layout — every piece of content is a
 * slot passed by the caller. Shared by `ShowDateDetailSheet` (the live sheet)
 * and the dev harness so the two can never drift.
 *
 * Layout notes:
 * - The outer element is a full-height flex column so the header stays put and
 *   the work column can own its own scroll/footer.
 * - `min-w-0` on the work column is load-bearing: a flex child defaults to
 *   `min-width:auto`, so wide content (the artist rows, the offer ladder) would
 *   otherwise force the column past the sheet edge and clip. This is the fix for
 *   the "Assigned Artists card cut off / overlaps" regression.
 */
export function CockpitShell({ header, banner, rail, children, footer }: CockpitShellProps) {
  return (
    <div className="flex min-h-full flex-col bg-[var(--surface)]">
      <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)]">
        {header}
      </div>

      {banner}

      <div className="flex flex-1 flex-col lg:flex-row lg:items-stretch">
        {rail}

        <div className="flex min-w-0 flex-1 flex-col bg-[var(--bg)]">
          <div className="min-h-[520px] flex-1 p-5">{children}</div>
          {footer}
        </div>
      </div>
    </div>
  );
}
