// The Trust Center's whole premise is that a claim on one surface cannot drift
// from the same claim on the other. That holds only while every published
// value comes from facts.ts: the public page reads it through trust.json, and
// the drift gates (build-trust-json --check, sync-trust-fallback --check) can
// see nothing else.
//
// Three values had escaped it as JSX literals in the Settings tab — the backup
// ceiling twice ("Deleted data leaves the backups within 30 days…",
// "Backups age out within 30 days…") and the database region once
// (value="EU · Ireland"). Each restated something facts.ts already owned, in
// different words, with no gate between them: lower the ceiling or move the
// project and the in-app tab would have kept publishing the old figure while
// the public page it links to published the new one, with CI green.
//
// This suite is the gate that was missing. It reads the component sources and
// fails if a period or a region is typed into one instead of imported.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKUP_CEILING_NOTE, CONTROLS, DATABASE_REGION, RETENTION, TRUST_KPIS } from "./facts";

const TRUST_COMPONENTS = resolve(process.cwd(), "src/components/settings/trust");

/** Every rendered component in the Settings > Trust & data tab, minus its
 *  tests. */
function componentSources(): { file: string; source: string }[] {
  const files = readdirSync(TRUST_COMPONENTS).filter(
    (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"),
  );
  expect(files.length, "no trust components found — the directory moved").toBeGreaterThan(0);
  return files.map((file) => ({ file, source: readFileSync(join(TRUST_COMPONENTS, file), "utf8") }));
}

/** Comments removed. These files explain the claims they render, and quoting a
 *  claim in a doc comment is documentation, not publication — only what
 *  survives the strip can reach a reader. */
function renderable(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("the Settings tab publishes no claim it typed itself", () => {
  it("states no retention period of its own", () => {
    for (const { file, source } of componentSources()) {
      const periods = [...renderable(source).matchAll(/\b\d+\s*(?:days?|months?|years?)\b/gi)].map(
        (m) => m[0],
      );
      expect(
        periods,
        `${file} states a period directly. Every period on this tab comes from RETENTION or an exported note in src/lib/trust/facts.ts, so the public page moves with it.`,
      ).toEqual([]);
    }
  });

  it("states no database region of its own", () => {
    for (const { file, source } of componentSources()) {
      expect(
        renderable(source),
        `${file} names the database region directly. Import DATABASE_REGION from src/lib/trust/facts.ts instead.`,
      ).not.toMatch(/Ireland/);
    }
  });
});

describe("the backup ceiling is one string, quoted by every surface that makes the claim", () => {
  it("is the sentence the Backups control publishes", () => {
    const backups = CONTROLS.find((c) => c.title === "Backups");
    expect(backups, "the Backups control was renamed").toBeDefined();
    expect(backups!.claim).toContain(BACKUP_CEILING_NOTE);
  });

  it("states the same number of days as the Backups retention row", () => {
    const row = RETENTION.find((r) => r.item === "Backups");
    expect(row, "the Backups retention row was renamed").toBeDefined();

    const rowDays = row!.period.match(/(\d+)\s*days/)?.[1];
    expect(rowDays, `no day figure in the Backups period "${row!.period}"`).toBeDefined();

    const noteDays = [...BACKUP_CEILING_NOTE.matchAll(/(\d+)\s*days/g)].map((m) => m[1]);
    expect(noteDays.length, "the backup note stopped stating a day figure").toBeGreaterThan(0);
    // Both figures in the note are the same ceiling stated twice; neither may
    // drift from the row the policy is diffed against.
    expect([...new Set(noteDays)]).toEqual([rowDays]);
  });
});

describe("the database region is one string", () => {
  it("is what the Database region KPI publishes", () => {
    const kpi = TRUST_KPIS.find((k) => k.label === "Database region");
    expect(kpi, "the Database region KPI was renamed").toBeDefined();
    expect(kpi!.value).toBe(DATABASE_REGION);
  });
});
