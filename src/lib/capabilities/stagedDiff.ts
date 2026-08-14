export type StagedMap = Record<string, boolean>;

interface RightRow {
  key: string;
  label: string;
  effective: boolean;
  risk: "standard" | "sensitive";
}

export function desiredFor(row: RightRow, staged: StagedMap): boolean {
  return staged[row.key] === undefined ? row.effective : staged[row.key];
}

export function changedKeys(rows: RightRow[], staged: StagedMap): string[] {
  return rows
    .filter((r) => staged[r.key] !== undefined && staged[r.key] !== r.effective)
    .map((r) => r.key);
}

export function diffSentence(rows: RightRow[], staged: StagedMap, presetLabel: string): string {
  const changed = rows.filter((r) => changedKeys(rows, staged).includes(r.key));
  if (changed.length === 0) return `Matches the ${presetLabel} baseline exactly.`;
  const names = changed.slice(0, 2).map((r) => r.label.toLowerCase()).join(", ");
  const more = changed.length > 2 ? ` and ${changed.length - 2} more.` : ".";
  const verb = changed.length === 1 ? "right differs" : "rights differ";
  return `${changed.length} ${verb} from ${presetLabel}. ${names}${more}`;
}

export function deltaSentence(rows: RightRow[], staged: StagedMap, who: string): string {
  const changed = rows.filter((r) => changedKeys(rows, staged).includes(r.key));
  if (changed.length === 0) return "";
  const gains = changed.filter((r) => desiredFor(r, staged)).map((r) => r.label);
  const loses = changed.filter((r) => !desiredFor(r, staged)).map((r) => r.label);
  const parts: string[] = [];
  if (gains.length > 0) {
    parts.push(`On apply, ${who} gains: ${gains.join("; ")}`);
  }
  if (loses.length > 0) {
    if (gains.length > 0) {
      parts.push(`${who} loses: ${loses.join("; ")}`);
    } else {
      parts.push(`On apply, ${who} loses: ${loses.join("; ")}`);
    }
  }
  return parts.join(". ") + ".";
}
