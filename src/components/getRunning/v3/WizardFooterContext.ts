import { createContext } from "react";

/**
 * The v3 wizard shell's footer contract.
 *
 * `el` is the footer's portal target (null until the footer has mounted its slot, so
 * consumers must guard for it). `register` is how a step body tells the shell that it is
 * supplying its own primary action: without it the shell cannot tell an empty slot from
 * one a portal is about to fill on the same commit, and every step that portals would end
 * up showing two primary buttons next to each other.
 *
 * Bodies should not read this directly. Use `WizardFooterAction`, which does both halves.
 *
 * Mirrors `TaskPanelFooterContext` (`src/components/getRunning/TaskPanelFooterContext.ts`):
 * lives in its own leaf module so a step body can read it without importing `WizardShell`,
 * which would cycle (`WizardShell` -> step registry -> step body -> back to `WizardShell`).
 */
export interface WizardFooterSlot {
  el: HTMLDivElement | null;
  register: (has: boolean) => void;
}

export const WizardFooterContext = createContext<WizardFooterSlot | null>(null);
