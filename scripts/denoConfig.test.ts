import { readFileSync, existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Why this file exists (PR #198, Supabase Preview "Edge Functions" step):
//
// `supabase functions deploy` resolves Deno config by walking UP from each
// function's own directory, so ANY deno.json at the repo root is inherited by
// every edge function that lacks one of its own. That makes a root config a
// repo-wide blast radius, and this branch learned it the hard way.
//
// render.tsx is dual-homed with the frontend, so it can no longer carry
// `import * as React from "npm:react@18.3.1"` (the specifier is meaningless to
// Vite) the way the edge-only version on main did. The JSX config that import
// used to make unnecessary was moved into a repo-root deno.json instead — and
// with `jsx`/`jsxImportSource`/`types` declared there, Deno expanded the whole
// @react-pdf/renderer module tree into EVERY function's graph: 29 modules each,
// against 2 with per-file scoping, in functions like airtable-poll and
// create-invitation that never touch a PDF. The create-function endpoint
// rejected the resulting payloads with HTTP 413 "request entity too large".
//
// Two size-shaped fixes failed before the cause was found (gzipping the fonts,
// then pinning nodeModulesDir), because size was never it: main carries a
// LARGER supabase/functions tree and deploys fine. The fix is scope, not size —
// the JSX pragma lives on the one generated file that needs it, injected by
// scripts/sync-mirrors.mjs via the manifest's `prelude` field.
//
// This is invisible locally: unit, lint, type and even `deno test` all pass.
// It only surfaces at deploy time. Hence a test.
describe("deno config: edge-function bundle size invariants", () => {
  it("has no deno.json at the repo root", () => {
    // A root config is inherited by all ~26 edge functions. Whatever it
    // declares (JSX, types, nodeModulesDir) is pulled into every bundle.
    const offenders = ["deno.json", "deno.jsonc"].filter((f) => existsSync(f));
    expect(offenders).toEqual([]);
  });

  it("the generated edge renderer carries its own JSX pragma", () => {
    // What replaces the root config. Without it render.tsx compiles as classic
    // JSX and fails at deploy time with "React is not defined".
    const target = "supabase/functions/_shared/hire-order-pdf/render.tsx";
    expect(readFileSync(target, "utf8").split("\n")[0]).toBe(
      "/** @jsxImportSource npm:react@18.3.1 */",
    );
  });

  it("no deno.json that sits beside a package.json sets nodeModulesDir", () => {
    // Deno turns on local node_modules resolution whenever a config file has a
    // package.json next to it, so imports resolve to file:// paths that the CLI
    // uploads as function payload. Per-function configs have no package.json
    // beside them and may set the key freely.
    const configs = functionDenoConfigs();
    const offenders = configs.filter((file) => {
      const dir = file.slice(0, file.lastIndexOf("/"));
      if (!existsSync(`${dir}/package.json`)) return false;
      return JSON.parse(readFileSync(file, "utf8")).nodeModulesDir !== undefined;
    });
    expect(offenders).toEqual([]);
  });
});

function functionDenoConfigs(): string[] {
  const root = "supabase/functions";
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${root}/${entry.name}/deno.json`)
    .filter((file) => existsSync(file));
}
