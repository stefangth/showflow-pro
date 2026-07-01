export type AccountState = "active" | "invited" | "none";

/**
 * Three-state account status shared by the artist card chip and LinkedAccountPanel.
 * `active` (has a login) always wins; `invited` requires a live pending invite id
 * (from list_pending_invited_artists); otherwise `none`.
 */
export function artistAccountState(
  artist: { id: string; user_id: string | null },
  pendingSet: Set<string>,
): AccountState {
  if (artist.user_id) return "active";
  if (pendingSet.has(artist.id)) return "invited";
  return "none";
}

/** Presentational map: one vocabulary + semantic dot token per state. */
export const ACCOUNT_STATE_META: Record<AccountState, { label: string; dotClass: string }> = {
  active: { label: "Active account", dotClass: "bg-success" },
  invited: { label: "Invite pending", dotClass: "bg-warning" },
  none: { label: "No account", dotClass: "bg-muted-foreground" },
};
