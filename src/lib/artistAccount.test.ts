import { describe, it, expect } from "vitest";
import { artistAccountState, ACCOUNT_STATE_META } from "./artistAccount";

describe("artistAccountState", () => {
  const pending = new Set<string>(["a-invited"]);

  it("returns 'active' when the artist has a user_id", () => {
    expect(artistAccountState({ id: "a-active", user_id: "u1" }, pending)).toBe("active");
  });

  it("active wins even if a stale pending id is present", () => {
    const stale = new Set<string>(["a-active"]);
    expect(artistAccountState({ id: "a-active", user_id: "u1" }, stale)).toBe("active");
  });

  it("returns 'invited' when unregistered but in the pending set", () => {
    expect(artistAccountState({ id: "a-invited", user_id: null }, pending)).toBe("invited");
  });

  it("returns 'none' when unregistered and not pending", () => {
    expect(artistAccountState({ id: "a-none", user_id: null }, pending)).toBe("none");
  });

  it("exposes a label + dot token for every state", () => {
    expect(ACCOUNT_STATE_META.active.label).toBe("Active account");
    expect(ACCOUNT_STATE_META.invited.label).toBe("Invite pending");
    expect(ACCOUNT_STATE_META.none.label).toBe("No account");
    expect(ACCOUNT_STATE_META.active.dotClass).toContain("success");
    expect(ACCOUNT_STATE_META.invited.dotClass).toContain("warning");
    expect(ACCOUNT_STATE_META.none.dotClass).toContain("muted");
  });
});
