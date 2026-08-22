import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ROUTES } from "@/config/app.config";
import { useOrgAdminNames } from "@/hooks/useOrgAdminNames";
import { adminDisplayName } from "@/data/orgAdmins";
import type { SettingsTabParam } from "@/lib/settingsTabs";
import type { GetRunningTask, GetRunningTaskKey } from "@/lib/getRunning/tasks";
import { TASK_FEATURE, taskFeatureLink } from "@/lib/getRunning/taskFeature";
import { TaskPanelEditor } from "./taskPanelRegistry";
// The footer-slot context lives in its own leaf module so an editor can read it without
// importing this frame (which would cycle: frame → registry → editor → frame).
import { TaskPanelFooterContext } from "./TaskPanelFooterContext";

/** Where a producer reading a non-actionable task's read-only panel (see `WaitsOnPanelBody`
 *  below) can go to see the real thing in Settings — only for the tasks that have a stable,
 *  producer-reachable `?tab=` destination naming exactly that section (mirrors the admin
 *  breadcrumb `TASK_FEATURE` carries for the actionable case). Kept in sync with
 *  `TASK_FEATURE.tab` (`src/lib/getRunning/taskFeature.ts`), just narrowed to the tasks
 *  whose home is a real Settings tab. `letterhead`/`terms`/`countersign` live in the
 *  now-deep-linkable `hire-orders` tab; `team`/`people` point at admin-only or non-Settings
 *  destinations a producer cannot reach either way, and `dates`/`slots` have no org-level
 *  Settings section at all (per-show, not a setting). Those last five render the waits-on
 *  body with no link rather than a link to nowhere. */
const WAITS_ON_SETTINGS_TAB: Partial<Record<GetRunningTaskKey, SettingsTabParam>> = {
  flow: "booking",
  timing: "booking",
  ladder: "casts-coverage",
  eligibility: "casts-coverage",
  letterhead: "hire-orders",
  terms: "hire-orders",
  countersign: "hire-orders",
};

/**
 * The screen-03 dead-end fix: every reused step editor the registry mounts is a MUTABLE
 * form (`FlowStep`, `TimingStep`, `LetterheadStep`, `TermsStep`, `CountersignStep` have no
 * read-only mode at all; the others assume a capability their own producer viewer may lack).
 * A producer who reaches a panel for a task they cannot act on (`actionableByViewer ===
 * false`) must never land in one of those forms only to have it fail to save — this renders
 * instead of the registry editor for exactly that case: the same "Waits on {admin}"
 * attribution the board rows already carry, plus a deep-link to the real setting in
 * Settings where one exists (`WAITS_ON_SETTINGS_TAB`).
 */
function WaitsOnPanelBody({ task, orgId }: { task: GetRunningTask; orgId: string | null }): JSX.Element {
  const { t } = useTranslation("getRunning");
  const { data: adminNames } = useOrgAdminNames(orgId ?? undefined);
  const adminName = adminDisplayName(adminNames, t("waitsOn.fallbackAdmin"));
  const settingsTab = WAITS_ON_SETTINGS_TAB[task.key];

  return (
    <div className="flex flex-col gap-3">
      <Badge variant="neutral" className="w-fit">
        {t("chips.waitsOn", { name: adminName })}
      </Badge>
      <p className="text-sm leading-5 text-muted-foreground">{t("panel.waitsOn.body", { name: adminName })}</p>
      {settingsTab && (
        <Link
          to={`${ROUTES.SETTINGS}?tab=${settingsTab}`}
          className="text-xs font-medium text-accent-600 underline-offset-2 hover:underline"
        >
          {t(`panel.waitsOn.settingsLink.${task.key}`)}
        </Link>
      )}
    </div>
  );
}

export interface TaskPanelProps {
  task: GetRunningTask;
  orgId: string | null;
  /** "Later" (footer) and the header close control both call this — dismiss with
   *  nothing written. Nothing here undoes a save the editor already made; it only closes
   *  the panel. */
  onClose: () => void;
  /** Called after the mounted editor's own `onDone` fires (a successful save). Optional:
   *  a viewer who cannot act on the task at all renders `WaitsOnPanelBody` instead (see
   *  below), which never reaches `onDone`. When omitted, `onDone` falls back to `onClose`. */
  onNext?: () => void;
}

/**
 * The task panel frame (screen 02 · `02_02_Task_panels.html`): one shell shared by all
 * eleven tasks — eyebrow, title, intro body, a scrollable slot hosting the task's own
 * reused step editor (via `taskPanelRegistry`), and a footer note + "Later" dismiss.
 *
 * Screen 02 mocks a second, generic primary submit button in the footer next to "Later"
 * ("Keep offers" / "Confirm timing" / "Save letterhead"). Every reused editor already
 * renders its OWN primary action inline instead — FlowStep's "Use {preset}", TimingStep's
 * "Save timing", LetterheadStep's confirm button, SlotsStep's "Save slot counts", and so
 * on — each wired to that editor's own mutation, its own validation and its own disabled
 * state. A second, frame-level "primary" button with no mutation behind it would either
 * do nothing or have to reach into each editor's internal state to drive it, which is
 * exactly the modification this task was told to avoid ("wrap, don't modify"). So the
 * footer here stays the frame's own chrome only: a task-specific note (what the change
 * applies to / whether it's logged) plus "Later", which just closes the panel. The
 * editor's own save button already sits at the bottom of the scroll body, directly above
 * this footer, so the visual result still reads as "one action to finish this task."
 *
 * The scroll slot mounts the registry editor ONLY when `task.actionableByViewer`. A
 * producer who opens a panel for a task they cannot act on gets `WaitsOnPanelBody` instead
 * — never the raw registry editor — because several of those editors (`FlowStep`,
 * `TimingStep`, `LetterheadStep`, `TermsStep`, `CountersignStep`) are mutable forms with no
 * read-only mode: mounting one for a viewer who lacks the capability to save it would be a
 * dead end (the mutation 403s at RLS, surfaced as a bare error toast). This is the single
 * root-cause guard for every entry point into this panel — the board's "View"
 * buttons and the paperwork header's "Do it now" link both just call `onOpenTask`, so they
 * inherit this automatically rather than needing their own read-only awareness.
 */
export function TaskPanel({ task, orgId, onClose, onNext }: TaskPanelProps): JSX.Element {
  const { t } = useTranslation("getRunning");
  // The footer slot the mounted editor may portal its primary action into (see
  // `TaskPanelFooterContext`). Held in state so the portal re-runs once the ref attaches.
  const [footerSlotEl, setFooterSlotEl] = useState<HTMLDivElement | null>(null);
  // The scroll cue below only earns its place when the body can actually scroll and isn't
  // already at the bottom — otherwise it just washes out the last line of short content.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [showScrollCue, setShowScrollCue] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setShowScrollCue(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Recompute when the viewport or the content height changes (async data load, preset switch).
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [task.key]);
  const handleDone = () => (onNext ? onNext() : onClose());
  // The eyebrow is a breadcrumb to where this setting really LIVES (question 1), replacing
  // the old shape word ("Values · …") that meant nothing to a user. When the viewer can act
  // on the task, the crumb is a live deep link to that home; a producer viewing a task they
  // cannot act on gets the same crumb as plain text (the home is admin-only or the deep link
  // would bounce), with `WaitsOnPanelBody` carrying its own producer-safe Settings link below.
  const crumb = t(TASK_FEATURE[task.key].crumbKey);

  return (
    <div
      data-testid="task-panel"
      className="flex h-fit max-h-[calc(100vh-140px)] w-[440px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-elev3"
    >
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          {task.actionableByViewer ? (
            <Link
              to={taskFeatureLink(task.key)}
              className="group inline-flex items-center gap-1 text-accent-600 hover:text-accent-700"
            >
              <Eyebrow className="text-inherit">{crumb}</Eyebrow>
              <ExternalLink className="h-3 w-3 opacity-70 group-hover:opacity-100" aria-hidden="true" />
            </Link>
          ) : (
            <Eyebrow className="text-accent-600">{crumb}</Eyebrow>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("panel.close")}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-1.5 text-title font-semibold tracking-[-0.3px] text-foreground">
          {t(`tasks.${task.key}.title`)}
        </div>
        <p className="mt-1.5 text-control leading-[19px] text-muted-foreground text-pretty">
          {t(`tasks.${task.key}.description`)}
        </p>
      </div>

      <div ref={scrollRef} data-testid="task-panel-scroll" className="relative flex-1 overflow-y-auto p-4">
        <div ref={contentRef}>
          <TaskPanelFooterContext.Provider value={footerSlotEl}>
            {task.actionableByViewer ? (
              <TaskPanelEditor task={task} orgId={orgId} onDone={handleDone} />
            ) : (
              <WaitsOnPanelBody task={task} orgId={orgId} />
            )}
          </TaskPanelFooterContext.Provider>
        </div>
        {/* Scroll cue: a subtle bottom fade so it reads as "more content continues above the
            footer". Rendered only while the body actually overflows and isn't scrolled to the
            bottom, so it never washes out the last line of short content. Sticky so it hugs the
            bottom of the scroll viewport; matches the panel's `bg-card` so it is dark-mode safe. */}
        {showScrollCue && (
          <div
            data-testid="task-panel-scroll-cue"
            className="pointer-events-none sticky bottom-0 -mt-4 h-4 bg-gradient-to-t from-card to-transparent"
          />
        )}
      </div>

      <div className="flex items-center gap-2.5 border-t border-border bg-well-tint px-4 py-3.5">
        <span className="text-xs text-muted-foreground">{t(`panel.footerNote.${task.key}`)}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("panel.later")}
          </Button>
          {/* Optional editor-provided primary action portals in here (see
              `TaskPanelFooterContext`). Empty for every editor that does not opt in, so the
              footer then looks identical to before. */}
          <div ref={setFooterSlotEl} className="flex items-center gap-2" />
        </div>
      </div>
    </div>
  );
}
