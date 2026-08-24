import { useContext, useLayoutEffect, type ReactNode } from "react";
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
 *
 * Registration is a LAYOUT effect on purpose. A passive effect runs after paint, so on a
 * step change from a body with no footer action to one that has its own (letterhead to
 * fee, terms to document, artists to skills) the shell's generic Continue and this
 * portalled one would both paint for a frame before the shell stood its own down. The
 * mirror case paints a frame with no primary action at all. Running before paint means
 * neither is ever visible.
 */
export function WizardFooterAction({ children }: { children: ReactNode }): JSX.Element {
  const slot = useContext(WizardFooterContext);
  const register = slot?.register;
  useLayoutEffect(() => {
    register?.(true);
    return () => register?.(false);
  }, [register]);
  return slot?.el ? createPortal(children, slot.el) : <>{children}</>;
}
