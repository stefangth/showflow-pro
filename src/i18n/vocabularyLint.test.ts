import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { englishSources, scanBareNouns, capitalisedTokens } from "./vocabularyScan";
import { VOCABULARY } from "@/lib/orgKind";

/**
 * Ratchet: the number of bare domain nouns in English copy may never grow. The copy audit
 * (PR 2 tasks 7 to 13) drives BASELINE to 0, then Task 14 replaces it with ALLOW.
 * `VOCAB_REPORT=1 npx vitest run src/i18n/vocabularyLint.test.ts` prints every hit.
 */
const BASELINE = 801; // measured count as of this commit; never raise it, PR 2 drives it to 0.
// Raised once, from 737, when "contract(s)" joined the NOUN regex: it is the production value of
// {{hireOrder}}, so a literal "contract" in copy is a missed substitution a staffing org would read.
// Raised again when "skill(s)" joined the regex, for the same reason: a staffing org reads
// "qualification", so a literal "skill" in copy is a missed substitution.

// Key-path prefixes exempt from the scan: copy that legitimately names both vocabularies
// (the workspace-type picker explains what each option means).
const SKIP_PATHS = [
  "settings.organization.kind",
  "getRunningV3.steps.workspace",
  "getRunningV3.body.workspace",
  "getRunningV3.guide.workspace",
  // A spreadsheet-column concept, not the catalog entity: the importer asks which sheet column
  // holds the sub-program. Reviewed and kept verbatim; carry it into the Task 14 allowlist.
  "getRunningV3.body.map.sheet.fields.subProgram",
];

describe("vocabulary ratchet", () => {
  const sources = englishSources();

  it("bare domain nouns in English copy do not exceed the baseline", () => {
    const hits = scanBareNouns(sources, SKIP_PATHS);
    const lines = hits.map((h) => `${h.path} (${h.count})`);
    const total = hits.reduce((s, h) => s + h.count, 0);
    if (process.env.VOCAB_REPORT) console.log(`${lines.join("\n")}\nTOTAL ${total}`);
    expect(total, `bare nouns grew past the baseline. Offenders:\n${lines.join("\n")}`).toBeLessThanOrEqual(BASELINE);
  });

  it("every capitalised {{Token}} is a vocabulary key", () => {
    expect(capitalisedTokens(sources)).toEqual([]);
  });

  it("no call site passes a vocabulary key as a runtime interpolation variable", () => {
    const offenders = findShadowedInterpolations();
    expect(
      offenders,
      `rename the variable (showTitle / castName / artistName / artistCount / productionCount / skillNames / understudyCount):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

const SRC_ROOT = resolve(process.cwd(), "src");

/** Every `.ts`/`.tsx` file under src, excluding tests, the test harness, and the
 *  auto-generated Supabase types (too large, and not something PR 2 touches). */
function sourceFiles(dir = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === join(SRC_ROOT, "test")) continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.") && full !== join(SRC_ROOT, "integrations/supabase/types.ts")) {
      out.push(full);
    }
  }
  return out;
}

// Every vocabulary noun form (show, shows, Show, Shows, artist, artists, ..., roleProducer, kind).
const VOCAB_NAMES = new Set(Object.keys(VOCABULARY.production.en));

// Anchors a `t(` call, word-boundary-safe without relying on `\b` support (this replaces a
// git-grep guard that silently matched nothing on macOS, where `git grep -E`'s `\b` is a no-op).
// `(?<![\w.])` stops `insert(`/`set(` (and `foo.t(`) from matching.
const CALL_START_RE = /(?<![\w.])t\(/g;

/** This is a scanner, not a single regex, because the guard must be multi-line aware (a
 *  `t()` call whose options object spans lines, which this codebase already does — see
 *  LadderPanelBody.tsx and PermissionsMatrix.tsx) and must NOT flag a vocabulary-named key
 *  that belongs to some *nested* object literal inside the options (e.g. `t("x", { label:
 *  referenceLabel({ show: {...} }) })` — `show` there is an argument to `referenceLabel`,
 *  not an i18next interpolation variable). A single non-nesting-aware regex over `[^}]*?`
 *  cannot tell those apart; this walks brace/paren/bracket depth so only the options
 *  object's own top-level keys (depth 1, i.e. immediately inside its own `{`) are checked. */
function findShadowedInterpolations(): string[] {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    for (const call of text.matchAll(CALL_START_RE)) {
      const braceStart = findOptionsObjectStart(text, call.index + call[0].length);
      if (braceStart === -1) continue;
      for (const key of topLevelKeys(text, braceStart)) {
        if (VOCAB_NAMES.has(key.name)) {
          const line = text.slice(0, key.index).split("\n").length;
          offenders.push(`${relative(process.cwd(), file)}:${line}`);
        }
      }
    }
  }
  return offenders;
}

/** After `t(`, skip whitespace, the literal string key, and the following comma, and return
 *  the index of the options object's opening `{`. Returns -1 when the second argument isn't
 *  an object literal directly following a string key (a ternary/dynamic key, a variable, or
 *  no second argument) — nothing to scan there. */
function findOptionsObjectStart(text: string, afterParen: number): number {
  let i = afterParen;
  while (i < text.length && /\s/.test(text[i])) i++;
  const quote = text[i];
  if (quote !== '"' && quote !== "'" && quote !== "`") return -1;
  i++;
  while (i < text.length && text[i] !== quote) { if (text[i] === "\\") i++; i++; }
  i++; // past the closing quote
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== ",") return -1;
  i++;
  while (i < text.length && /\s/.test(text[i])) i++;
  return text[i] === "{" ? i : -1;
}

/** Property names directly inside the object literal starting at `braceStart`, skipping over
 *  string contents and any nested `{ }` / `( )` / `[ ]` (a property of a nested object, or an
 *  argument to a nested call, is not a key i18next will see). */
function topLevelKeys(text: string, braceStart: number): Array<{ name: string; index: number }> {
  const keys: Array<{ name: string; index: number }> = [];
  let depth = 0;
  let i = braceStart;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < text.length && text[i] !== quote) { if (text[i] === "\\") i++; i++; }
      i++;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") { depth++; i++; continue; }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth--;
      i++;
      if (depth === 0) break; // end of the options object
      continue;
    }
    if (depth === 1 && /[A-Za-z_$]/.test(ch)) {
      const idMatch = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i));
      if (idMatch) {
        const name = idMatch[0];
        let j = i + name.length;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] === ":") keys.push({ name, index: i });
        i = j;
        continue;
      }
    }
    i++;
  }
  return keys;
}
