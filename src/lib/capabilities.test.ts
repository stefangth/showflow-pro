import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DEFS,
  CAPABILITY_KEYS,
  capabilityByKey,
  capabilityFor,
  enabledCapabilities,
  isCapabilityEnabled,
} from "./capabilities";

describe("capability registry", () => {
  it("has 27 producer rights, all role=producer, unique keys", () => {
    expect(CAPABILITY_DEFS).toHaveLength(27);
    expect(CAPABILITY_DEFS.every((d) => d.role === "producer")).toBe(true);
    expect(new Set(CAPABILITY_KEYS).size).toBe(27);
  });

  it("pins the spec defaults (§5 / §9)", () => {
    const on = (k: string) => capabilityByKey(k)!.defaultEnabled;
    // §9 default-ON-beyond-today
    expect(on("producer_can_invite")).toBe(true);
    expect(on("producer_can_manage_invitations")).toBe(true);
    expect(on("producer_can_view_linked_accounts")).toBe(true);
    expect(on("producer_can_issue_hire_orders")).toBe(true);
    expect(on("producer_can_void_hire_orders")).toBe(true);
    expect(on("producer_can_add_artists")).toBe(true);
    // sensitive, default OFF
    expect(on("producer_can_hard_delete_productions")).toBe(false);
    expect(on("producer_can_edit_booking_settings")).toBe(false);
    expect(on("producer_can_rename_org")).toBe(false);
    expect(on("producer_can_configure_airtable")).toBe(false);
  });

  it("capabilityFor maps (role, action) to its def", () => {
    expect(capabilityFor("producer", "issue_hire_orders")?.key).toBe("producer_can_issue_hire_orders");
    expect(capabilityFor("producer", "does_not_exist")).toBeUndefined();
  });

  it("enabledCapabilities falls back to registry defaults for missing rows", () => {
    const set = enabledCapabilities([{ capability: "producer_can_hard_delete_productions", enabled: true }]);
    expect(set.has("producer_can_hard_delete_productions")).toBe(true); // override
    expect(set.has("producer_can_invite")).toBe(true); // default on
    expect(set.has("producer_can_rename_org")).toBe(false); // default off
    expect(isCapabilityEnabled([], "producer_can_issue_hire_orders")).toBe(true);
  });

  it("hire-order rights carry the module gate", () => {
    expect(capabilityByKey("producer_can_issue_hire_orders")!.module).toBe("hire_orders");
    expect(capabilityByKey("producer_can_invite")!.module).toBeUndefined();
  });
});
