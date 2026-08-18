// One-time post-login landing on the Get running board.
//
// The onboarding gate in DashboardPage redirects a non-artist to /get-running while the
// board is incomplete. That redirect must fire only ONCE per session — as the post-login
// landing target — never on every subsequent visit to the dashboard, or the user could
// never reach the dashboard by hand (clicking "Dashboard" would bounce straight back).
//
// We record "the landing has been consumed" in sessionStorage: it survives in-tab reloads
// and route changes, and is cleared automatically when the tab closes. AuthContext also
// clears it on sign-out, so a fresh login in the same tab re-arms the landing. All access
// is wrapped in try/catch so a disabled/blocked storage (private mode, SSR) degrades to
// "not yet landed" rather than throwing.
//
// The flag is keyed PER ORG. A multi-org producer/admin can land on org A's board, then
// switch to org B (whose board is also incomplete) in the same tab: a single shared flag
// would read "already landed" and drop them on org B's empty dashboard instead of its
// board. Per-org keys make each org's first visit land independently; switching back to a
// board already landed this session correctly does not re-trap.

const LANDED_PREFIX = 'showflow.getRunning.landed';
const keyFor = (orgId: string) => `${LANDED_PREFIX}.${orgId}`;

/** Has the one-time Get running landing already happened this session for this org? */
export function hasLandedGetRunning(orgId: string): boolean {
  try {
    return sessionStorage.getItem(keyFor(orgId)) === '1';
  } catch {
    return false;
  }
}

/** Mark the one-time Get running landing as consumed for this org this session. */
export function markLandedGetRunning(orgId: string): void {
  try {
    sessionStorage.setItem(keyFor(orgId), '1');
  } catch {
    // no-op: storage unavailable → we simply treat the landing as not-yet-consumed
  }
}

/** Re-arm the landing for EVERY org (called on sign-out so the next login lands again). */
export function resetGetRunningLanding(): void {
  try {
    // Clear all per-org keys, not just one — sign-out isn't org-scoped, and the next login
    // (same tab) may be a different user whose org set overlaps.
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k === LANDED_PREFIX || k?.startsWith(`${LANDED_PREFIX}.`)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // no-op
  }
}
