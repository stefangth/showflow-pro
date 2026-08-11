import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITY_DEFS } from "@/lib/capabilities";
import { buildCapabilityInventory } from "./capabilityInventory";
import { CONTROLS, TRUST_KPIS } from "./facts";

/** Spells out a small count the way the CONTROLS prose does ("Nine rights",
 *  not "9 rights") — capitalised, since it always opens a sentence. */
function spelledOut(n: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  return words[n] ?? String(n);
}

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

  // TAUTOLOGY, closed. This used to rebuild the expected label out of
  // `group.entries.length` and `group.sensitiveCount` — the builder's own
  // output — so it proved the format string and nothing about the numbers: a
  // fold that dropped a right would produce a wrong count and a label that
  // matched it. Both sides now come from CAPABILITY_DEFS.
  it("labels a group's count with its sensitive share, and omits it when there is none", () => {
    const seen = new Set<string>();
    for (const group of inventory.groups) {
      const registry = CAPABILITY_DEFS.filter((d) => d.group === group.group);
      expect(registry.length, `no registry rights in group "${group.group}"`).toBeGreaterThan(0);
      const sensitive = registry.filter((d) => d.risk === "sensitive").length;
      expect(group.countLabel).toBe(
        sensitive ? `${registry.length} · ${sensitive} sensitive` : String(registry.length),
      );
      seen.add(group.group);
    }
    // …and every registry group produced a label, so a group silently missing
    // from the fold cannot pass by never being iterated.
    expect(seen).toEqual(new Set(CAPABILITY_DEFS.map((d) => d.group)));
    // At least one group of each shape, or half the branch above is untested.
    expect(inventory.groups.some((g) => g.countLabel.includes("sensitive"))).toBe(true);
    expect(inventory.groups.some((g) => !g.countLabel.includes("sensitive"))).toBe(true);
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

  // TAUTOLOGY, closed, for the same reason as the group label above: this
  // rebuilt the headline out of the three fields it was checking. The public
  // page prints this string verbatim, so the numbers in it have to be pinned to
  // the registry, not to themselves.
  it("derives a headline the marketing page can print verbatim", () => {
    const groups = new Set(CAPABILITY_DEFS.map((d) => d.group)).size;
    const sensitive = CAPABILITY_DEFS.filter((d) => d.risk === "sensitive").length;
    expect(inventory.headline).toBe(
      `${CAPABILITY_DEFS.length} rights · ${groups} groups · ${sensitive} sensitive`,
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

  // CONTROLS[1] ("Roles and rights") restates the sensitive count, the
  // off-by-default count, the total rights, and the group count as English
  // sentences — hand-typed because facts.ts cannot import capabilities.ts
  // (scripts/build-trust-json.mjs's loader rejects any import in facts.ts).
  // Nothing else pins those four numbers to the registry, so add a capability
  // and this is the only assertion in the suite that would catch the Controls
  // card publishing a stale count on the public page.
  it("keeps the Roles and rights control's hand-typed counts in step with the registry", () => {
    const control = CONTROLS.find((c) => c.title === "Roles and rights");
    expect(control, "CONTROLS has no 'Roles and rights' entry").toBeDefined();

    expect(control!.claim).toContain(`${spelledOut(inventory.totalSensitive)} rights are marked sensitive`);
    // Lower-cased: the off-by-default count now sits mid-sentence ("a different
    // nine ship switched off"), which is where the disambiguation of the two
    // nines lives after the claim was shortened.
    expect(control!.claim.toLowerCase()).toContain(
      `${spelledOut(inventory.totalDefaultOff).toLowerCase()} ship switched off`,
    );
    expect(control!.claim).toContain(`${inventory.totalRights} rights`);
    expect(control!.evidence).toContain(`${inventory.totalRights} rights across ${inventory.totalGroups} groups`);
  });

  // "Issuing and voiding hire orders are sensitive yet ship on, which is why
  // the two nines differ" gave half the reason, and a reviewer checking the
  // arithmetic landed on seven: 9 sensitive minus the 2 that ship on is 7, and
  // the sets only meet at nine again because two STANDARD rights also ship off.
  // Both directions are now stated, and both are re-derived here — so the
  // sentence goes red if either side of the overlap moves, which is exactly
  // what would happen the day one of those four rights changes its default.
  it("explains both directions of the sensitive / off-by-default overlap", () => {
    const sensitiveButOn = CAPABILITY_DEFS.filter((d) => d.risk === "sensitive" && d.defaultEnabled);
    const offButStandard = CAPABILITY_DEFS.filter((d) => d.risk !== "sensitive" && !d.defaultEnabled);

    // The arithmetic the published sentence has to survive.
    expect(inventory.totalSensitive - sensitiveButOn.length + offButStandard.length).toBe(
      inventory.totalDefaultOff,
    );
    expect(sensitiveButOn).toHaveLength(2);
    expect(offButStandard).toHaveLength(2);

    const control = CONTROLS.find((c) => c.title === "Roles and rights");
    expect(control!.evidence).toMatch(/sensitive yet ship on/i);
    expect(
      control!.evidence,
      "naming only the sensitive-yet-on pair leaves a reviewer's arithmetic at seven",
    ).toMatch(/two standard rights ship off/i);
  });

  // scripts/build-trust-json.mjs cannot import this module (it loads facts.ts
  // and capabilities.ts through a dependency-free transpile step, and this
  // file reaches capabilities.ts via the "@/" alias), so the generator
  // hand-duplicates the same fold. This is the assertion that keeps the
  // duplicate honest: if the generator's loop and this function ever
  // disagree, public/trust.json's capabilities block will not match what
  // buildCapabilityInventory() produces from the same registry.
  it("matches the capabilities block the generator wrote to public/trust.json", () => {
    const raw = readFileSync(resolve(process.cwd(), "public/trust.json"), "utf8");
    const published = JSON.parse(raw);
    expect(published.capabilities).toEqual(inventory);
  });
});
