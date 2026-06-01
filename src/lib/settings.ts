import type { NestedSlotDefaults } from "@/hooks/useSubProgramSlots";

export interface ProgramPair {
  program: string;
  sub_program: string;
}

export interface SettingsWarnings {
  /** Number of (program, sub_program) combinations with no slot defaults configured. */
  schedulingWarnings: number;
  /** True when any warning exists. */
  hasAnyWarning: boolean;
}

/** Dedupe raw shows rows into distinct, fully-populated (program, sub_program) pairs. */
export function dedupeProgramPairs(
  rows: { program: string | null; sub_program: string | null }[] | null | undefined,
): ProgramPair[] {
  const seen = new Set<string>();
  const out: ProgramPair[] = [];
  (rows ?? []).forEach((r) => {
    if (!r.program || !r.sub_program) return;
    const key = `${r.program}::${r.sub_program}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ program: r.program, sub_program: r.sub_program });
    }
  });
  return out;
}

/** Count program/sub-program pairs that lack a slot-defaults entry. */
export function computeSchedulingWarnings(
  pairs: ProgramPair[] | null | undefined,
  slotDefaults: NestedSlotDefaults | null | undefined,
): SettingsWarnings {
  const unconfigured = (pairs ?? []).filter(
    (p) => !slotDefaults?.[p.program]?.[p.sub_program],
  );
  const schedulingWarnings = unconfigured.length;
  return { schedulingWarnings, hasAnyWarning: schedulingWarnings > 0 };
}
