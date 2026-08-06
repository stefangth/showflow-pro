import { useCallback, useState } from "react";

/** Per-browser, per-org dismissal of the setup rail.
 *
 *  localStorage rather than app_settings: app_settings is org-scoped, so a dismissal
 *  stored there would hide the rail for every admin at once. It does not follow a user
 *  across devices, which is an accepted limitation for a surface that retires itself
 *  as soon as setup is complete (spec §7). Matches the showflow_editor_mode precedent. */
function storageKey(orgId: string | null): string {
  return `showflow.hireOrderSetup.hidden.${orgId ?? "none"}`;
}

export function useRailDismissed(orgId: string | null): [boolean, () => void] {
  const [dismissed, setDismissed] = useState<boolean>(
    () => localStorage.getItem(storageKey(orgId)) === "true",
  );
  const dismiss = useCallback(() => {
    localStorage.setItem(storageKey(orgId), "true");
    setDismissed(true);
  }, [orgId]);
  return [dismissed, dismiss];
}
