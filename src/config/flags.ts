/**
 * Build-time internal flags. Read from `import.meta.env.VITE_*`, so they are
 * statically resolved at build and can be flipped per environment without a DB
 * migration. Mirrors the VITE_DEV_AUTOLOGIN precedent (see AuthContext).
 *
 * GETRUNNING_V3 gates the Wireflow v3 Get running board. Default OFF; the v1
 * board renders until every v3 phase lands and the host sets this to "true".
 */
export const GETRUNNING_V3: boolean =
  import.meta.env.VITE_GETRUNNING_V3 === "true";
