import { useCallback, useSyncExternalStore } from "react";

/** Per-browser, per-org dismissal of a setup rail.
 *
 *  localStorage rather than app_settings: a dismissal in the org-scoped settings table
 *  would hide the rail for every admin at once. It does not follow a user across devices,
 *  an accepted limitation for a surface that retires itself once setup is complete.
 *  `namespace` keeps each rail's dismissal independent (e.g. "hireOrderSetup",
 *  "bookingSetup", "artistFirstOffer"). */
function storageKey(namespace: string, orgId: string | null): string {
  return `showflow.${namespace}.hidden.${orgId ?? "none"}`;
}

/** Every mounted reader, so a Hide click updates all of them at once. A single shared
 *  set across namespaces is fine: each reader re-reads its OWN key, so a Hide in one
 *  namespace triggers a harmless no-op re-read in the others. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useRailDismissed(namespace: string, orgId: string | null): [boolean, () => void] {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(storageKey(namespace, orgId)) === "true",
  );
  const dismiss = useCallback(() => {
    localStorage.setItem(storageKey(namespace, orgId), "true");
    for (const notify of listeners) notify();
  }, [namespace, orgId]);
  return [dismissed, dismiss];
}
