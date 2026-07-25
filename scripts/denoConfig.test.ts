import { readFileSync, existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Why this file exists (PR #198, Supabase Preview "Edge Functions" step):
//
// The repo-root deno.json was added purely to give the whole-suite `deno test`
// invocation an ambient JSX config (render.tsx needs the automatic runtime, and
// CI runs deno from the repo root). It was copied from
// generate-hire-orders/deno.json, so it also carried `nodeModulesDir: "auto"`.
//
// That one key is safe inside a function directory and catastrophic at the repo
// root, because the root deno.json sits NEXT TO the frontend package.json:
// `nodeModulesDir: "auto"` makes Deno treat the repo as an npm project and pull
// that entire ~760-package dependency tree into the module graph.
//
// `supabase functions deploy` resolves Deno config by walking up from each
// function's OWN directory, so every function without a deno.json of its own
// inherits the root file. Their bundles went from ~4MB to ~52MB and the
// create-function endpoint rejected them with HTTP 413 "request entity too
// large" — killing the whole deploy after a couple of functions had landed.
//
// The failure is invisible locally: every unit/lint/type check passes, and CI's
// own `deno test --node-modules-dir=none` explicitly overrides the key. It only
// surfaces at deploy time. Hence a test.
describe("deno config: edge-function bundle size invariants", () => {
  it("the repo-root deno.json does not set nodeModulesDir", () => {
    const config = JSON.parse(readFileSync("deno.json", "utf8"));
    expect(config.nodeModulesDir).toBeUndefined();
  });

  it("the repo-root deno.json still declares the automatic JSX runtime", () => {
    // The only reason the file exists. Dropping this silently reverts render.tsx
    // to classic-mode JSX for the repo-root `deno test` run.
    const config = JSON.parse(readFileSync("deno.json", "utf8"));
    expect(config.compilerOptions?.jsx).toBe("react-jsx");
    expect(config.compilerOptions?.jsxImportSource).toBe("npm:react@18.3.1");
  });

  it("no deno.json that sits beside a package.json sets nodeModulesDir", () => {
    // The general form of the rule: the key is only ever safe where there is no
    // package.json for Deno to resolve into the graph. Per-function configs
    // (e.g. generate-hire-orders) have no package.json beside them and may keep
    // it — that is how the PDF renderer gets its node_modules layout.
    const configs = ["deno.json", ...functionDenoConfigs()];
    const offenders = configs.filter((file) => {
      const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
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
