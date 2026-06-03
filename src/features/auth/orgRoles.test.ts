import { describe, it, expect } from "vitest";
import { rolesForOrg } from "./orgRoles";

describe("rolesForOrg", () => {
  it("returns the roles the user holds in the given org", () => {
    expect(
      rolesForOrg(
        [
          { org_id: "o1", role: "admin" },
          { org_id: "o1", role: "producer" },
          { org_id: "o2", role: "artist" },
        ],
        "o1",
      ),
    ).toEqual(["admin", "producer"]);
  });

  it("returns [] for an org the user is not a member of", () => {
    expect(rolesForOrg([{ org_id: "o1", role: "admin" }], "o2")).toEqual([]);
  });

  it("returns [] when the active org is null", () => {
    expect(rolesForOrg([{ org_id: "o1", role: "admin" }], null)).toEqual([]);
  });
});
