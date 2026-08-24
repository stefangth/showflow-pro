/**
 * Build-time internal flags. Read from `import.meta.env.VITE_*`, so they are
 * statically resolved at build and can be flipped per environment without a DB
 * migration. Mirrors the VITE_DEV_AUTOLOGIN precedent (see AuthContext).
 *
 * GETRUNNING_V3 formerly gated the Wireflow v3 Get running board. As of the v3
 * cutover it is retired from the runtime path: v3 is now the app default for every
 * org (see `src/data/getRunningFlag.ts`), and an org falls back to the v1 board only
 * via an explicit per-org `getrunning_v3_enabled = false` override. The const is kept
 * (still parsed and tested) so the env fork can be rewired if the cutover is reverted.
 */
export const GETRUNNING_V3: boolean =
  import.meta.env.VITE_GETRUNNING_V3 === "true";
