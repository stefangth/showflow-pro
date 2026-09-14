import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import i18n, { resources } from "@/i18n";
import { applyVocabulary } from "@/features/i18n/vocabulary";
import type { Lang } from "./config";

/**
 * Production orgs must render byte-identically after the copy audit. This report
 * renders every locale key under the production vocabulary (variables and per-kind
 * siblings resolved) and diffs it against the same key on origin/main. Runs only with
 * VOCAB_DIFF=1 (it shells out to git); prints the differences and never fails, so the
 * executor and the reviewer can read the deliberate rewordings.
 */
function flat(node: unknown, path = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === "string") out[path] = node;
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flat(v, path ? `${path}.${k}` : k, out);
  return out;
}

const run = process.env.VOCAB_DIFF ? describe : describe.skip;

run("production-vocabulary diff against origin/main", () => {
  for (const lang of ["en", "de"] as Lang[]) {
    it(`prints ${lang} differences`, async () => {
      await i18n.changeLanguage(lang);
      applyVocabulary(i18n, "production", lang);
      const diffs: string[] = [];
      for (const ns of Object.keys(resources[lang])) {
        let before: Record<string, string> = {};
        try { before = flat(JSON.parse(execSync(`git show origin/main:src/i18n/locales/${lang}/${ns}.json`, { encoding: "utf8" }))); } catch { continue; }
        for (const [key, old] of Object.entries(before)) {
          const now = i18n.t(key, { ns, lng: lang });
          if (now !== old) diffs.push(`${ns}.${key}\n  main: ${old}\n  now:  ${now}`);
        }
      }
      console.log(`[${lang}] ${diffs.length} differences\n${diffs.join("\n")}`);
      expect(diffs).toBeInstanceOf(Array);
    });
  }
});
