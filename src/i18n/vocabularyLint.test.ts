import { execSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { englishSources, scanBareNouns, capitalisedTokens } from "./vocabularyScan";

/**
 * Ratchet: the number of bare domain nouns in English copy may never grow. The copy audit
 * (PR 2 tasks 7 to 13) drives BASELINE to 0, then Task 14 replaces it with ALLOW.
 * `VOCAB_REPORT=1 npx vitest run src/i18n/vocabularyLint.test.ts` prints every hit.
 */
const BASELINE = 845; // measured count as of this commit; never raise it, PR 2 drives it to 0

// Key-path prefixes exempt from the scan: copy that legitimately names both vocabularies
// (the workspace-type picker explains what each option means).
const SKIP_PATHS = [
  "settings.organization.kind",
  "getRunningV3.steps.workspace",
  "getRunningV3.body.workspace",
  "getRunningV3.guide.workspace",
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
    // Grep-level guard: t('key', { show: ... }) would shadow the noun. Runtime variables
    // are showTitle / castName / artistName / artistCount / productionCount.
    let src = "";
    try {
      src = execSync(
        "git grep -nE \"\\bt\\([^)]*\\{[^}]*\\b(show|shows|cast|casts|artist|artists|production|productions|skill|skills|showDate|showDates|understudy|understudies|hireOrder|hireOrders)\\s*:\" -- src ':!*.test.*'",
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch {
      src = "";
    }
    expect(src, "rename the variable (showTitle / castName / artistName / artistCount / productionCount / skillNames / understudyCount)").toBe("");
  });
});
