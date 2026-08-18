// Plain constants shared by the task-panel registry and (potentially) its tests. Kept out
// of taskPanelRegistry.tsx because react-refresh/only-export-components forbids a .tsx
// file from exporting anything but components.

import type { GetRunningTaskKey } from "@/lib/getRunning/tasks";

/** The `get_dates`/`bookable`-phase task keys, i.e. every task whose readiness the
 *  booking module's own `useBookingSetupStatus` (coverage + active-artist count) can
 *  answer. `letterhead`/`terms`/`countersign` live in the `paperwork` phase and read
 *  nothing from that hook, so an org that only has hire_orders on (booking off) never
 *  pays for a booking-readiness fetch when it opens one of those three panels. */
export const BOOKING_DOMAIN_TASK_KEYS: ReadonlySet<GetRunningTaskKey> = new Set([
  "dates", "slots", "flow", "people", "ladder", "eligibility", "timing", "team",
]);

/**
 * Which of the three screen-02 shapes (choice / values / document) each task's panel
 * reads as. Purely descriptive metadata — every shape shares the same `TaskPanel` frame
 * and the same `panel.eyebrow.<key>` i18n string already carries the shape word, so this
 * is not read by the frame today. Kept as one place documenting the shape assignment
 * (see `docs/superpowers/specs/2026-08-17-setup-settings-design/screens/02_02_Task_panels.html`)
 * rather than only in the eyebrow copy, so a future task deciding how to lay out a new
 * shape variant has a typed source to branch on instead of parsing translated strings.
 */
export const TASK_PANEL_SHAPE: Record<GetRunningTaskKey, "choice" | "values" | "document"> = {
  dates: "document",
  slots: "values",
  flow: "choice",
  people: "document",
  ladder: "document",
  eligibility: "document",
  timing: "values",
  team: "document",
  letterhead: "document",
  terms: "document",
  countersign: "document",
};
