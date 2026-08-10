import { describe, expect, it } from "vitest";
import { CAPABILITY_DEFS } from "@/lib/capabilities";
import { buildCapabilityInventory } from "./capabilityInventory";
import { TRUST_KPIS } from "./facts";

describe("buildCapabilityInventory", () => {
  const inventory = buildCapabilityInventory();

  it("accounts for every right in the registry exactly once", () => {
    const flattened = inventory.groups.flatMap((g) => g.entries);
    expect(flattened).toHaveLength(CAPABILITY_DEFS.length);
    expect(inventory.totalRights).toBe(CAPABILITY_DEFS.length);
  });

  it("preserves registry declaration order within a group", () => {
    const membersGroup = inventory.groups.find((g) => g.group === "Members & access");
    const registryOrder = CAPABILITY_DEFS.filter((d) => d.group === "Members & access").map((d) => d.label);
    expect(membersGroup?.entries.map((e) => e.label)).toEqual(registryOrder);
  });

  it("counts sensitive rights per group and overall", () => {
    expect(inventory.totalSensitive).toBe(CAPABILITY_DEFS.filter((d) => d.risk === "sensitive").length);
    const perGroupSum = inventory.groups.reduce((n, g) => n + g.sensitiveCount, 0);
    expect(perGroupSum).toBe(inventory.totalSensitive);
  });

  it("labels a group's count with its sensitive share, and omits it when there is none", () => {
    for (const group of inventory.groups) {
      const expected = group.sensitiveCount
        ? `${group.entries.length} · ${group.sensitiveCount} sensitive`
        : String(group.entries.length);
      expect(group.countLabel).toBe(expected);
    }
  });

  it("reports each right's shipped default", () => {
    const deleteProductions = inventory.groups
      .flatMap((g) => g.entries)
      .find((e) => e.label === "Delete productions");
    // A destructive right must not ship on. If this flips, the Trust Center is
    // making a promise the registry no longer keeps.
    expect(deleteProductions?.sensitive).toBe(true);
    expect(deleteProductions?.defaultEnabled).toBe(false);
    expect(deleteProductions?.defaultLabel).toBe("Off by default");
  });

  it("derives a headline the marketing page can print verbatim", () => {
    expect(inventory.headline).toBe(
      `${inventory.totalRights} rights · ${inventory.totalGroups} groups · ${inventory.totalSensitive} sensitive`,
    );
  });

  // The public page prints these numbers as a scannable claim. They are the
  // single most checkable thing on it, so they may never be typed by hand.
  it("keeps the published access-control KPI in step with the registry", () => {
    const kpi = TRUST_KPIS.find((k) => k.label === "Access control");
    expect(kpi?.value).toBe(
      `${inventory.totalRights} rights, ${inventory.totalSensitive} sensitive, ${inventory.totalDefaultOff} off by default`,
    );
  });

  // "Sensitive" and "off by default" are separate axes. An earlier draft of the
  // page said all nine sensitive rights ship off, which is false — issuing and
  // voiding hire orders are sensitive and on. Keep the two countable apart.
  it("separates the sensitive set from the off-by-default set", () => {
    const entries = inventory.groups.flatMap((g) => g.entries);
    expect(inventory.totalDefaultOff).toBe(entries.filter((e) => !e.defaultEnabled).length);

    const sensitiveButOn = entries.filter((e) => e.sensitive && e.defaultEnabled).map((e) => e.label);
    expect(sensitiveButOn).toEqual(["Issue hire orders", "Void hire orders"]);
  });

  it("counts groups from the registry rather than a literal", () => {
    const distinctGroups = new Set(CAPABILITY_DEFS.map((d) => d.group));
    expect(inventory.totalGroups).toBe(distinctGroups.size);
  });
});
