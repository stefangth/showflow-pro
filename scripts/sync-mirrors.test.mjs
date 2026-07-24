import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { syncMirrors } from "./sync-mirrors.mjs";

function scratch() {
  return mkdtempSync(join(tmpdir(), "mirrors-"));
}
function put(root, rel, text) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

// File-mode targets are stamped with a three-line "generated, do not edit"
// header (see stamp() in sync-mirrors.mjs) so a reader who opens the target
// directly is warned off hand-editing it. Fixtures below bake that header in.
const HEADER_FOR_A_TS =
  "// GENERATED FILE. Do not edit.\n" +
  "// Source: a.ts\n" +
  "// Regenerate: npm run sync:mirrors\n";

describe("syncMirrors file mode", () => {
  it("writes the target from the source, stamped with a generated header", () => {
    const root = scratch();
    put(root, "a.ts", "export const x = 1;\n");
    put(root, "b.ts", "stale\n");
    const result = syncMirrors({ root, entries: [{ mode: "file", source: "a.ts", target: "b.ts" }] });
    expect(readFileSync(join(root, "b.ts"), "utf8")).toBe(`${HEADER_FOR_A_TS}export const x = 1;\n`);
    expect(result.written).toEqual(["b.ts"]);
  });

  it("reports nothing written when the target already matches", () => {
    const root = scratch();
    put(root, "a.ts", "same\n");
    put(root, "b.ts", `${HEADER_FOR_A_TS}same\n`);
    const result = syncMirrors({ root, entries: [{ mode: "file", source: "a.ts", target: "b.ts" }] });
    expect(result.written).toEqual([]);
  });

  it("check mode reports staleness without writing", () => {
    const root = scratch();
    put(root, "a.ts", "new\n");
    put(root, "b.ts", "old\n");
    const result = syncMirrors({ root, entries: [{ mode: "file", source: "a.ts", target: "b.ts" }], check: true });
    expect(result.stale).toEqual(["b.ts"]);
    expect(readFileSync(join(root, "b.ts"), "utf8")).toBe("old\n");
  });
});

describe("syncMirrors block mode", () => {
  const START = "// >>> M >>>";
  const END = "// <<< M <<<";
  const entry = { mode: "block", source: "a.ts", target: "b.ts", start: START, end: END };

  it("replaces only the delimited block, preserving the rest of the target", () => {
    const root = scratch();
    put(root, "a.ts", `import x from "npm:x";\n${START}\nexport const R = 1;\n${END}\nsource tail\n`);
    put(root, "b.ts", `import x from "x";\n${START}\nexport const R = 0;\n${END}\ntarget tail\n`);
    syncMirrors({ root, entries: [entry] });
    const out = readFileSync(join(root, "b.ts"), "utf8");
    expect(out).toContain('import x from "x";');
    expect(out).toContain("export const R = 1;");
    expect(out).toContain("target tail");
    expect(out).not.toContain("source tail");
  });

  it("throws a named error when a sentinel is missing", () => {
    const root = scratch();
    put(root, "a.ts", `${START}\nx\n${END}\n`);
    put(root, "b.ts", "no sentinels here\n");
    expect(() => syncMirrors({ root, entries: [entry] })).toThrow(/sentinel/i);
  });
});

describe("the real manifest", () => {
  it("is already in sync, so a clean checkout passes check mode", () => {
    const result = syncMirrors({ check: true });
    expect(result.stale).toEqual([]);
  });
});
