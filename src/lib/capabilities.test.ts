import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DEFS,
  CAPABILITY_KEYS,
  capabilityByKey,
  capabilityFor,
  enabledCapabilities,
  isCapabilityEnabled,
} from "./capabilities";
import { resolveCapability, resolveAllCapabilities } from "./capabilities";
import { CAPABILITY_GROUPS, capabilitiesByGroup } from "./capabilities";

describe("capability registry", () => {
  it("has 29 producer rights, all role=producer, unique keys", () => {
    expect(CAPABILITY_DEFS).toHaveLength(29);
    expect(CAPABILITY_DEFS.every((d) => d.role === "producer")).toBe(true);
    expect(new Set(CAPABILITY_KEYS).size).toBe(29);
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
    expect(on("producer_can_edit_email_templates")).toBe(false);
  });

  it("defines the sensitive, opt-in email-template editing grant", () => {
    expect(capabilityByKey("producer_can_edit_email_templates")).toMatchObject({
      key: "producer_can_edit_email_templates",
      action: "edit_email_templates",
      role: "producer",
      group: "Email",
      label: "Edit email templates",
      description: "Producers can change email copy and branding.",
      risk: "sensitive",
      defaultEnabled: false,
    });
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

describe("layered resolver", () => {
  const KEY = "producer_can_rename_org"; // registry default false

  it("registry default when nothing set", () => {
    expect(resolveCapability(KEY, { registryDefault: false })).toEqual({
      effective: false, locked: false, source: "registry",
    });
  });

  it("org override wins over registry default", () => {
    expect(resolveCapability(KEY, { orgRow: { capability: KEY, enabled: true }, registryDefault: false }))
      .toEqual({ effective: true, locked: false, source: "org" });
  });

  it("platform default applies when no org override", () => {
    expect(resolveCapability(KEY, { policyRow: { capability: KEY, enabled: true, locked: false }, registryDefault: false }))
      .toEqual({ effective: true, locked: false, source: "policy_default" });
  });

  it("lock overrides the org override and reports locked", () => {
    expect(resolveCapability(KEY, {
      orgRow: { capability: KEY, enabled: true },
      policyRow: { capability: KEY, enabled: false, locked: true },
      registryDefault: false,
    })).toEqual({ effective: false, locked: true, source: "policy_lock" });
  });

  it("lock with null platform value falls back to registry default", () => {
    expect(resolveCapability(KEY, {
      policyRow: { capability: KEY, enabled: null, locked: true },
      registryDefault: true,
    })).toEqual({ effective: true, locked: true, source: "policy_lock" });
  });

  it("resolveAllCapabilities covers every registry key", () => {
    const map = resolveAllCapabilities([], []);
    expect(map.size).toBe(29);
    expect(map.get("producer_can_invite")!.effective).toBe(true);
    expect(map.get("producer_can_rename_org")!.effective).toBe(false);
  });
});

describe("capability grouping", () => {
  it("lists the 8 groups in registry order", () => {
    expect(CAPABILITY_GROUPS).toEqual([
      "Members & access",
      "Productions & show dates",
      "Bookings & engine",
      "Artists",
      "Hire orders",
      "Settings & organization",
      "Integrations",
      "Email",
    ]);
  });
  it("capabilitiesByGroup partitions all 29 defs, preserving order", () => {
    const groups = capabilitiesByGroup();
    expect(groups.map((g) => g.group)).toEqual(CAPABILITY_GROUPS);
    expect(groups.reduce((n, g) => n + g.defs.length, 0)).toBe(29);
    expect(groups[0].defs.every((d) => d.group === "Members & access")).toBe(true);
  });
});
