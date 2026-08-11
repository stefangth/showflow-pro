// src/components/dashboard/firstRun/FirstRunSideCard.tsx
import type { SideLink } from "@/lib/dashboard/stageChain.types";

/** The "Nothing here blocks the rest of the app" card: title + body on the
 *  left, a 300px list of arrow-icon links on the right. Mirrors the side-card
 *  block in docs/superpowers/plans/assets/2026-08-11-dashboard-first-run-5c.reproduction.html. */
export function FirstRunSideCard(props: { title: string; body: string; links: SideLink[] }): JSX.Element {
  const { title, body, links } = props;

  return (
    <div className="flex shrink-0 items-start gap-6 rounded-[var(--radius-l)] border border-border bg-card p-4">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{title}</div>
        <div className="mt-1.5 text-xs leading-[18px] text-muted-foreground text-pretty">{body}</div>
      </div>
      <div className="flex w-[300px] shrink-0 flex-col gap-[9px]">
        {links.map((link, i) => (
          <div key={i} className="flex items-start gap-2">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-[3px] shrink-0 text-accent-500"
              aria-hidden="true"
            >
              <path d="M5 12h13" />
              <path d="M13 6l6 6-6 6" />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-foreground">{link.title}</div>
              <div className="mt-px text-xs leading-[17px] text-[var(--text-faint)] text-pretty">{link.where}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
