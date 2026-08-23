import { createContext } from "react";

/**
 * Optional footer-action SLOT for the v3 wizard shell. A step body mounted as `children`
 * may portal its own primary action into the pinned footer (next to "Finish later") by
 * reading this context for the footer slot's DOM node and `createPortal`-ing its button
 * into it. The value is `null` until the footer has mounted its slot, so consumers must
 * guard for that.
 *
 * Mirrors `TaskPanelFooterContext` (`src/components/getRunning/TaskPanelFooterContext.ts`):
 * lives in its own leaf module so a step body can read it without importing `WizardShell`,
 * which would cycle (`WizardShell` → step registry → step body → back to `WizardShell`).
 */
export const WizardFooterContext = createContext<HTMLDivElement | null>(null);
