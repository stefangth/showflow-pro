import { useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { WizardFooterContext } from "./WizardFooterContext";

/**
 * A step body's own primary action, rendered in the wizard footer beside "Finish later".
 *
 * Replaces the `footerSlot ? createPortal(button, footerSlot) : button` idiom that eight
 * step bodies each carried their own copy of, and additionally registers with the shell so
 * it stands its generic Continue down. The shell renders that generic Continue for the
 * eight steps whose bodies come from v1 and the setup rails and cannot portal one, which
 * is what makes all sixteen steps end in exactly one primary action.
 *
 * Falls back to rendering inline when there is no shell around it, so a step body stays
 * usable in its other hosts and in tests that mount it bare.
 */
export function WizardFooterAction({ children }: { children: ReactNode }): JSX.Element {
  const slot = useContext(WizardFooterContext);
  const register = slot?.register;
  useEffect(() => {
    register?.(true);
    return () => register?.(false);
  }, [register]);
  return slot?.el ? createPortal(children, slot.el) : <>{children}</>;
}
