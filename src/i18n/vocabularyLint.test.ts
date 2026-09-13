import { describe, it, expect } from "vitest";
import { resources } from "@/i18n";

/**
 * Ratchet: the number of bare domain nouns in English copy may never grow. PR 2 (copy
 * audit) drives BASELINE to 0 by replacing nouns with {{vocabulary}} variables, then this
 * file switches to an explicit allowlist. Until then, any new hardcoded "show", "artist",
 * "production", "cast", "understudy" or "hire order" fails CI.
 *
 * BASELINE is pinned to the measured count of the CURRENT locale files and must never be
 * raised — only lowered as copy is migrated. PR 2 drives it to 0.
 */
const BASELINE = 683; // measured count as of this commit; never raise it, PR 2 drives it to 0

const NOUN = /\b(shows?|artists?|productions?|casts?|understud(?:y|ies)|hire orders?)\b/gi;
// Proper nouns and phrases that are not vocabulary.
const IGNORE = [/ShowFlow/g];

// Key-path prefixes whose strings are exempt from the ratchet entirely (not scanned).
// These are strings that LEGITIMATELY name both the "shows/artists" and "projects/people"
// vocabularies literally (e.g. a workspace-kind picker explaining what each option means).
// Seeded ahead of Task 8, which will add the copy under these paths.
const SKIP_PATHS = [
  "settings.organization.kind",
  "getRunningV3.steps.workspace",
  "getRunningV3.body.workspace",
  "getRunningV3.guide.workspace",
];

function strings(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === "string") out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) strings(v, path ? `${path}.${k}` : k, out);
}

describe("vocabulary ratchet", () => {
  it("bare domain nouns in English copy do not exceed the baseline", () => {
    const out: Array<[string, string]> = [];
    for (const [ns, tree] of Object.entries(resources.en)) strings(tree, ns, out);
    const hits: string[] = [];
    for (const [path, text] of out) {
      if (SKIP_PATHS.some((prefix) => path.startsWith(prefix))) continue;
      let cleaned = text;
      for (const re of IGNORE) cleaned = cleaned.replace(re, "");
      const n = (cleaned.match(NOUN) ?? []).length;
      if (n > 0) hits.push(`${path} (${n})`);
    }
    const total = hits.reduce((s, h) => s + Number(h.match(/\((\d+)\)$/)?.[1] ?? 0), 0);
    expect(total, `bare nouns grew past the baseline. Offenders:\n${hits.join("\n")}`).toBeLessThanOrEqual(BASELINE);
  });
});
