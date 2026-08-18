import { createContext } from "react";

/**
 * Optional footer-action SLOT for the task panel frame. An editor mounted in the scroll body
 * may portal its OWN primary action into the pinned footer (next to "Later") by reading this
 * context for the footer slot's DOM node and `createPortal`-ing its button into it. The
 * mutation still lives entirely in the editor (its state, validation, disabled logic and
 * `onDone` are unchanged) — the frame only lends a stable, always-visible mount point, so the
 * design constraint from the frame comment still holds: the footer carries no frame-level
 * primary of its own. Editors that do NOT consume this (all but `FlowStep` today) keep their
 * inline button and the footer shows only "Later", exactly as before. The value is `null`
 * until the footer has mounted its slot, so consumers must guard for that.
 *
 * Lives in its own leaf module (not beside `TaskPanel`) so an editor — or a test's editor
 * probe — can read the context without importing `TaskPanel`, which would form a cycle
 * (`TaskPanel` → registry → editor → back to `TaskPanel`).
 */
export const TaskPanelFooterContext = createContext<HTMLDivElement | null>(null);
