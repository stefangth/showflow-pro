// src/components/admin/people/peopleMatch.test.ts
import { describe, it, expect } from "vitest";
import { isValidEmail, parseEmails, matchContact, filterPeople, filterInvitesByEmail } from "./peopleMatch";
import type { OrgMember } from "@/data/members";
import type { Invitation } from "@/data/invitations";

const member = (o: Partial<OrgMember> = {}): OrgMember => ({
  user_id: "u1", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null, ...o,
});
const invite = (o: Partial<Invitation> = {}): Invitation => ({
  id: "i1", org_id: "org-1", email: "kim@x.com", role: "artist", status: "pending",
  token: "t", expires_at: "2026-12-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", ...o,
});

describe("isValidEmail", () => {
  it("accepts a normal address and rejects junk", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});

describe("parseEmails", () => {
  it("splits on comma/newline/space, trims, dedupes case-insensitively", () => {
    expect(parseEmails("a@x.com, b@x.com\nA@X.com  c@x.com")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(parseEmails("   ")).toEqual([]);
  });
});

describe("matchContact", () => {
  it("finds a member case-insensitively", () => {
    expect(matchContact("BOB@x.com", [member()], [])).toBe("member");
  });
  it("finds a pending invite but ignores non-pending", () => {
    expect(matchContact("kim@x.com", [], [invite()])).toBe("pending");
    expect(matchContact("kim@x.com", [], [invite({ status: "revoked" })])).toBe("none");
  });
  it("returns none when nothing matches", () => {
    expect(matchContact("new@x.com", [member()], [invite()])).toBe("none");
  });
});

describe("filterPeople", () => {
  it("passes through on empty query", () => {
    const r = filterPeople("  ", [member()], [invite()]);
    expect(r.members).toHaveLength(1);
    expect(r.invites).toHaveLength(1);
  });
  it("matches members by name or email, invites by email; null-safe", () => {
    const m2 = member({ user_id: "u2", email: null, display_name: "Zoe" });
    expect(filterPeople("zoe", [member(), m2], []).members).toHaveLength(1);
    expect(filterPeople("kim", [member()], [invite()]).invites).toHaveLength(1);
    expect(filterPeople("bob", [member()], [invite()]).members).toHaveLength(1);
  });
});

describe("filterInvitesByEmail", () => {
  it("passes through on empty query and filters by email case-insensitively otherwise", () => {
    const list = [invite({ email: "kim@x.com" }), invite({ id: "i2", email: "sam@y.com" })];
    expect(filterInvitesByEmail("  ", list)).toHaveLength(2);
    expect(filterInvitesByEmail("KIM", list).map((i) => i.email)).toEqual(["kim@x.com"]);
    expect(filterInvitesByEmail("zzz", list)).toHaveLength(0);
  });
});
