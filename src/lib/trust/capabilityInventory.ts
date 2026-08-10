// Folds the capability registry into the grouped shape the Trust Center
// renders. Deriving it here — rather than restating the rights in facts.ts —
// is what makes "28 rights, 8 groups, 9 sensitive" impossible to get wrong:
// the headline counts and the expandable list come from the same array that
// the database checks.

import { CAPABILITY_DEFS, type CapabilityDef } from "@/lib/capabilities";

export interface InventoryEntry {
  label: string;
  description: string;
  sensitive: boolean;
  /** "On by default" / "Off by default" — the registry's shipped position. */
  defaultLabel: string;
  defaultEnabled: boolean;
}

export interface InventoryGroup {
  group: string;
  entries: InventoryEntry[];
  /** e.g. "6 · 2 sensitive", or just "6" when the group has none. */
  countLabel: string;
  sensitiveCount: number;
}

export interface CapabilityInventory {
  groups: InventoryGroup[];
  totalRights: number;
  totalGroups: number;
  totalSensitive: number;
  /** Rights that ship switched off. NOT the same set as the sensitive ones:
   *  issuing and voiding hire orders are sensitive but on by default, because a
   *  production team that cannot issue an order cannot do its job. Conflating
   *  the two is the easiest way to put a false claim on the public page. */
  totalDefaultOff: number;
  /** e.g. "28 rights · 8 groups · 9 sensitive" */
  headline: string;
}

/** Group the registry in declaration order — the registry is authored in a
 *  deliberate order (members, productions, bookings, …) and a reviewer reading
 *  top to bottom should meet the rights in that same order. */
export function buildCapabilityInventory(defs: CapabilityDef[] = CAPABILITY_DEFS): CapabilityInventory {
  const byGroup = new Map<string, CapabilityDef[]>();
  for (const def of defs) {
    const existing = byGroup.get(def.group);
    if (existing) existing.push(def);
    else byGroup.set(def.group, [def]);
  }

  const groups: InventoryGroup[] = [...byGroup.entries()].map(([group, groupDefs]) => {
    const sensitiveCount = groupDefs.filter((d) => d.risk === "sensitive").length;
    return {
      group,
      sensitiveCount,
      countLabel: sensitiveCount ? `${groupDefs.length} · ${sensitiveCount} sensitive` : String(groupDefs.length),
      entries: groupDefs.map((d) => ({
        label: d.label,
        description: d.description,
        sensitive: d.risk === "sensitive",
        defaultEnabled: d.defaultEnabled,
        defaultLabel: d.defaultEnabled ? "On by default" : "Off by default",
      })),
    };
  });

  const totalSensitive = defs.filter((d) => d.risk === "sensitive").length;
  const totalDefaultOff = defs.filter((d) => !d.defaultEnabled).length;

  return {
    groups,
    totalRights: defs.length,
    totalGroups: groups.length,
    totalSensitive,
    totalDefaultOff,
    headline: `${defs.length} rights · ${groups.length} groups · ${totalSensitive} sensitive`,
  };
}
