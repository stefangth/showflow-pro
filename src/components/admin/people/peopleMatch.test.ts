// src/components/admin/people/peopleMatch.test.ts
import { describe, it, expect } from "vitest";
import { isValidEmail, parseEmails, matchContact, buildPeople, filterPeopleList, filterInvitesByEmail } from "./peopleMatch";
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
  it("prefers pending over an existing membership row (invite-time member is still pending)", () => {
    // Membership-at-invite-time: a not-yet-accepted invitee is in BOTH lists. matchContact
    // must return "pending" (so the invite bar offers Resend), mirroring buildPeople.
    const both = member({ email: "c@x.com", user_id: "u3" });
    const pend = invite({ email: "c@x.com" });
    expect(matchContact("C@x.com", [both], [pend])).toBe("pending");
  });
});

describe("buildPeople", () => {
  it("emits one active person per member with no pending invite", () => {
    const people = buildPeople([member()], []);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ emailKey: "bob@x.com", status: "active", userId: "u1", roles: ["producer"] });
  });

  it("emits an invited-only person for a pending invite with no member", () => {
    const people = buildPeople([], [invite()]);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ emailKey: "kim@x.com", status: "invited", userId: null, roles: ["artist"] });
    expect(people[0].invitation?.id).toBe("i1");
  });

  it("merges a member and their pending invite into one invited person, keeping membership roles", () => {
    const m = member({ email: "C@x.com", user_id: "u3", roles: ["admin"] });
    const i = invite({ id: "inv3", email: "c@x.com", role: "producer" });
    const people = buildPeople([m], [i]);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ emailKey: "c@x.com", status: "invited", userId: "u3", roles: ["admin"] });
    expect(people[0].invitation?.id).toBe("inv3");
  });

  it("sorts invited people before active, then by email", () => {
    const people = buildPeople([member({ email: "z@x.com" })], [invite({ email: "b@x.com" })]);
    expect(people.map((p) => p.emailKey)).toEqual(["b@x.com", "z@x.com"]);
  });
});

describe("filterPeopleList", () => {
  const list = buildPeople([member({ email: "ada@x.com", display_name: "Ada L" })], [invite({ email: "bob@x.com" })]);
  it("passes through on empty query", () => expect(filterPeopleList("", list)).toHaveLength(2));
  it("matches on email substring", () => expect(filterPeopleList("bob", list).map((p) => p.emailKey)).toEqual(["bob@x.com"]));
  it("matches on display name", () => expect(filterPeopleList("ada l", list).map((p) => p.emailKey)).toEqual(["ada@x.com"]));
});

describe("filterInvitesByEmail", () => {
  it("passes through on empty query and filters by email case-insensitively otherwise", () => {
    const list = [invite({ email: "kim@x.com" }), invite({ id: "i2", email: "sam@y.com" })];
    expect(filterInvitesByEmail("  ", list)).toHaveLength(2);
    expect(filterInvitesByEmail("KIM", list).map((i) => i.email)).toEqual(["kim@x.com"]);
    expect(filterInvitesByEmail("zzz", list)).toHaveLength(0);
  });
});
