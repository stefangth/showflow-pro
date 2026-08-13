import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findUnsupportedRootLockfiles,
  runPackageManagerCheck,
} from "./check-package-manager.mjs";

const roots = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "showflow-package-manager-"));
  roots.push(root);
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("root package-manager policy", () => {
  it("accepts package-lock.json and ignores nested runtime lockfiles", () => {
    const root = makeRoot();
    const functionDir = join(root, "supabase", "functions", "example");
    mkdirSync(functionDir, { recursive: true });
    writeFileSync(join(functionDir, "bun.lock"), "\n");
    writeFileSync(join(functionDir, "deno.lock"), "{}\n");
    expect(findUnsupportedRootLockfiles(root)).toEqual([]);
  });

  it.each(["bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml"])(
    "rejects root %s",
    (filename) => {
      const root = makeRoot();
      writeFileSync(join(root, filename), "\n");
      expect(findUnsupportedRootLockfiles(root)).toEqual([filename]);
    },
  );

  it("reports every unsupported lockfile and returns a failing status", () => {
    const root = makeRoot();
    writeFileSync(join(root, "bun.lock"), "\n");
    writeFileSync(join(root, "yarn.lock"), "\n");
    const errors = [];

    expect(
      runPackageManagerCheck(root, {
        out: () => {},
        error: (message) => errors.push(message),
      }),
    ).toBe(1);
    expect(errors.join("\n")).toContain("bun.lock");
    expect(errors.join("\n")).toContain("yarn.lock");
    expect(errors.join("\n")).toContain("npm install");
  });
});
