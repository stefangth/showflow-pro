/**
 * The single bootstrap org that all pre-multi-tenant data lives in during the
 * single→multi-tenant transition. Mirrors the DB column default on tenant tables
 * and the membership backfill (migration 20260603120100).
 *
 * Edge functions that still default to it are transitional — they will thread the
 * caller's active org once the org switcher (Phase 1C) lands, and the default is
 * dropped with the rest of the bootstrap scaffolding (Phase 2/3).
 */
export const BOOTSTRAP_ORG_ID = "00000000-0000-0000-0000-00000000b007";
