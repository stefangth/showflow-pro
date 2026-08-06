import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";

/** One address line per row. On SAVE only: trim trailing whitespace per line (leading
 *  indentation and interior blanks preserved), then drop empty lines from the top and
 *  bottom so a stray leading or trailing Enter is not stored.
 *  Moved verbatim out of LetterheadCard.tsx so the rail step can reuse it. */
export function linesFromText(text: string): string[] {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return lines.slice(start, end);
}

export function serializeLines(lines: string[]): string {
  return lines.join("\n");
}

/**
 * Merge partial letterhead edits onto the stored value.
 *
 * The setup rail renders only legal name, address and registration line. Saving that
 * object on its own would erase `agent_name`, `agent_email` and `agent_signature_path`,
 * which only the Settings card renders. Every partial write must go through here.
 */
export function mergeLetterhead(
  stored: Letterhead | null | undefined,
  edits: Partial<Letterhead>,
): Letterhead {
  return { ...LETTERHEAD_DEFAULT, ...(stored ?? {}), ...edits };
}
