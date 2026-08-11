import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_INVITATION_TOKEN_KEY,
  captureInvitationToken,
  clearInvitationToken,
  readInvitationToken,
} from "./invitationToken";

describe("invitation token handoff", () => {
  beforeEach(() => sessionStorage.clear());

  it("stores a query token and scrubs only that parameter from the visible URL", () => {
    const history = { state: { keep: true }, replaceState: vi.fn() };
    const token = captureInvitationToken(
      {
        href: "https://showflow.test/accept-invite?source=email&token=stable-token#details",
        pathname: "/accept-invite",
        search: "?source=email&token=stable-token",
        hash: "#details",
      },
      history,
      sessionStorage,
    );

    expect(token).toBe("stable-token");
    expect(sessionStorage.getItem(PENDING_INVITATION_TOKEN_KEY)).toBe("stable-token");
    expect(history.replaceState).toHaveBeenCalledWith(history.state, "", "/accept-invite?source=email#details");
  });

  it("returns an existing stored token when the URL has none", () => {
    sessionStorage.setItem(PENDING_INVITATION_TOKEN_KEY, "stored-token");
    expect(captureInvitationToken(
      { href: "https://showflow.test/accept-invite", pathname: "/accept-invite", search: "", hash: "" },
      { replaceState: vi.fn() },
      sessionStorage,
    )).toBe("stored-token");
  });

  it.each(["", "   "])("rejects an empty query token %j", (queryToken) => {
    sessionStorage.setItem(PENDING_INVITATION_TOKEN_KEY, "stored-token");
    const encoded = encodeURIComponent(queryToken);
    expect(captureInvitationToken(
      { href: `https://showflow.test/accept-invite?token=${encoded}`, pathname: "/accept-invite", search: `?token=${encoded}`, hash: "" },
      { replaceState: vi.fn() },
      sessionStorage,
    )).toBe("stored-token");
  });

  it("still scrubs the URL and degrades safely when storage throws", () => {
    const replaceState = vi.fn();
    const throwingStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(captureInvitationToken(
      { href: "https://showflow.test/accept-invite?token=secret", pathname: "/accept-invite", search: "?token=secret", hash: "" },
      { replaceState },
      throwingStorage,
    )).toBe("secret");
    expect(replaceState).toHaveBeenCalledWith(undefined, "", "/accept-invite");
    expect(readInvitationToken(throwingStorage)).toBeNull();
  });

  it("removes only the pending invitation key", () => {
    sessionStorage.setItem(PENDING_INVITATION_TOKEN_KEY, "secret");
    sessionStorage.setItem("unrelated", "keep");
    clearInvitationToken(sessionStorage);
    expect(sessionStorage.getItem(PENDING_INVITATION_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem("unrelated")).toBe("keep");
  });
});
