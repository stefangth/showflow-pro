import { useCallback, useSyncExternalStore } from "react";

/** Per-browser, per-org dismissal of the setup rail.
 *
 *  localStorage rather than app_settings: app_settings is org-scoped, so a dismissal
 *  stored there would hide the rail for every admin at once. It does not follow a user
 *  across devices, which is an accepted limitation for a surface that retires itself
 *  as soon as setup is complete (spec §7). Matches the showflow_editor_mode precedent. */
function storageKey(orgId: string | null): string {
  return `showflow.hireOrderSetup.hidden.${orgId ?? "none"}`;
}

/** Every mounted reader of the dismissal, so a Hide click updates all of them at once.
 *  Two components read this (the rail and the page's layout decision) and switchOrg
 *  does not remount the route, so neither a one-shot read at mount nor a per-instance
 *  useState would stay correct. */
const listeners = new Set<() => void>();

/** The backing store is localStorage, which is shared across every tab on the origin,
 *  so the subscription has to be too. The in-document listener set covers the tab that
 *  clicked Hide (a `storage` event does not fire on the tab that wrote it); the
 *  `storage` listener covers every other open tab, which would otherwise keep the rail
 *  and its grid column until reload. */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useRailDismissed(orgId: string | null): [boolean, () => void] {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(storageKey(orgId)) === "true",
  );
  const dismiss = useCallback(() => {
    localStorage.setItem(storageKey(orgId), "true");
    for (const notify of listeners) notify();
  }, [orgId]);
  return [dismissed, dismiss];
}
