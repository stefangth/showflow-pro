export const PENDING_INVITATION_TOKEN_KEY = "showflow.pendingInvitationToken";

type InvitationStorage = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;

export function readInvitationToken(storage: Pick<Storage, "getItem">): string | null {
  try {
    return storage.getItem(PENDING_INVITATION_TOKEN_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function clearInvitationToken(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(PENDING_INVITATION_TOKEN_KEY);
  } catch {
    // Session storage can be unavailable in privacy-restricted browsing contexts.
  }
}

export function captureInvitationToken(
  location: Pick<Location, "href" | "pathname" | "search" | "hash">,
  history: Pick<History, "replaceState"> & Partial<Pick<History, "state">>,
  storage: InvitationStorage,
): string | null {
  const url = new URL(location.href);
  const queryToken = url.searchParams.get("token")?.trim() || null;

  if (queryToken) {
    try {
      storage.setItem(PENDING_INVITATION_TOKEN_KEY, queryToken);
    } catch {
      // Keep the in-memory token and continue to scrub the address bar.
    }
  }

  if (url.searchParams.has("token")) {
    url.searchParams.delete("token");
    try {
      history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Storage and history failures are independent; neither should expose the other.
    }
  }

  return queryToken ?? readInvitationToken(storage);
}
