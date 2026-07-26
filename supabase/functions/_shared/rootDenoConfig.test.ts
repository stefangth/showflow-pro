import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

/**
 * Guards the repo-root deno.json against losing `nodeModulesDir: "none"`.
 *
 * That file sits beside the frontend package.json. Deno turns on local
 * node_modules resolution whenever a config file has a package.json next to
 * it, so *omitting* the key does not mean "off" — it means "on". The ten edge
 * functions that have no deno.json of their own inherit the root config
 * (`supabase functions deploy` walks up from each function's directory), and
 * with node_modules resolution on, their imports resolve to file:// paths
 * inside node_modules instead of `npm:` specifiers. The CLI then uploads those
 * files as part of the function payload and the create-function endpoint
 * rejects it with HTTP 413.
 *
 * This is invisible locally: every test passes, the app builds, and only the
 * branch/production deploy fails. It cost several wrong fixes on PR #198 —
 * including one that deleted this very key as "unused". Keep it pinned.
 */
Deno.test("root deno.json pins nodeModulesDir to none", async () => {
  const url = new URL("../../../deno.json", import.meta.url);
  const config = JSON.parse(await Deno.readTextFile(url)) as {
    nodeModulesDir?: string;
  };

  assertEquals(
    config.nodeModulesDir,
    "none",
    'Root deno.json must set nodeModulesDir: "none". Without it, edge ' +
      "functions inheriting this config bundle the repo's node_modules and " +
      "the deploy fails with HTTP 413. See the comment in this test.",
  );
});
