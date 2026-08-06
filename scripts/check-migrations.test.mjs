import { describe, expect, it } from "vitest";
import { compareMigrations, parseMigrationFilename } from "./check-migrations.mjs";

describe("parseMigrationFilename", () => {
  it("splits the version prefix from the name", () => {
    expect(parseMigrationFilename("20260724120000_hire_order_dates_and_delivery.sql")).toEqual({
      version: "20260724120000",
      name: "hire_order_dates_and_delivery",
    });
  });

  it("handles the all-zero bootstrap version", () => {
    expect(parseMigrationFilename("00000000000000_local_extensions.sql")).toEqual({
      version: "00000000000000",
      name: "local_extensions",
    });
  });

  it("keeps hyphens in the early Supabase UUID-named files", () => {
    expect(parseMigrationFilename("20260416115633_d565d983-e98a-468a-a272-cbac9f2bdb89.sql")).toEqual({
      version: "20260416115633",
      name: "d565d983-e98a-468a-a272-cbac9f2bdb89",
    });
  });
});

describe("compareMigrations", () => {
  const m = (version, name) => ({ version, name });

  it("reports nothing when versions and names match exactly", () => {
    const repo = [m("20260101000000", "a"), m("20260102000000", "b")];
    expect(compareMigrations(repo, [...repo])).toEqual({ missing: [], orphaned: [], mismatched: [] });
  });

  it("is insensitive to the order rows come back in", () => {
    const repo = [m("20260101000000", "a"), m("20260102000000", "b")];
    const applied = [m("20260102000000", "b"), m("20260101000000", "a")];
    expect(compareMigrations(repo, applied)).toEqual({ missing: [], orphaned: [], mismatched: [] });
  });

  it("reports a repo migration that was never applied", () => {
    const repo = [m("20260101000000", "a"), m("20260102000000", "b")];
    const applied = [m("20260101000000", "a")];
    expect(compareMigrations(repo, applied)).toEqual({
      missing: [m("20260102000000", "b")],
      orphaned: [],
      mismatched: [],
    });
  });

  it("reports an applied migration with no repo file", () => {
    const repo = [m("20260101000000", "a")];
    const applied = [m("20260101000000", "a"), m("20260102000000", "ghost")];
    expect(compareMigrations(repo, applied)).toEqual({
      missing: [],
      orphaned: [m("20260102000000", "ghost")],
      mismatched: [],
    });
  });

  // The bug this whole script exists to catch: same name on both sides, different
  // version. `supabase db push` aborts wholesale on this, applying nothing.
  it("reports a version mismatch, and does not double-report it as missing or orphaned", () => {
    const repo = [m("20260723002807", "platform_audit_log")];
    const applied = [m("20260723002902", "platform_audit_log")];
    expect(compareMigrations(repo, applied)).toEqual({
      missing: [],
      orphaned: [],
      mismatched: [{ name: "platform_audit_log", repoVersion: "20260723002807", appliedVersion: "20260723002902" }],
    });
  });

  it("separates a genuine mismatch from a genuine gap in the same run", () => {
    const repo = [m("20260101000000", "drifted"), m("20260103000000", "unapplied")];
    const applied = [m("20260102000000", "drifted")];
    expect(compareMigrations(repo, applied)).toEqual({
      missing: [m("20260103000000", "unapplied")],
      orphaned: [],
      mismatched: [{ name: "drifted", repoVersion: "20260101000000", appliedVersion: "20260102000000" }],
    });
  });

  // Regression fixture: production's real state on 2026-08-07, before the repair.
  it("reports exactly the nine known drift pairs and nothing else", () => {
    const pairs = [
      ["20260723002807", "20260723002902", "platform_audit_log"],
      ["20260723003210", "20260723003308", "platform_membership_rpcs"],
      ["20260723003453", "20260723003543", "platform_link_artist_rpc"],
      ["20260723213733", "20260723213921", "email_health_event_window"],
      ["20260723225000", "20260723215420", "email_health_latest_lifecycle_event"],
      ["20260728131500", "20260728135342", "cron_stagger_and_timeout"],
      ["20260728132500", "20260728144736", "cron_health_scan_answered"],
      ["20260728133500", "20260728145106", "cron_health_observation_key"],
      ["20260804184500", "20260804184302", "health_daily_monotonic_upsert"],
    ];
    const aligned = [m("20260101000000", "already_fine")];
    const repo = [...aligned, ...pairs.map(([repoV, , name]) => m(repoV, name))];
    const applied = [...aligned, ...pairs.map(([, appliedV, name]) => m(appliedV, name))];

    const result = compareMigrations(repo, applied);
    expect(result.missing).toEqual([]);
    expect(result.orphaned).toEqual([]);
    expect(result.mismatched).toHaveLength(9);
    expect(result.mismatched[0]).toEqual({
      name: "platform_audit_log",
      repoVersion: "20260723002807",
      appliedVersion: "20260723002902",
    });
  });

  // Name is the join key, so a duplicate makes every result ambiguous. Fail loudly
  // rather than silently comparing against whichever row happened to land last.
  it("throws when a migration name is not unique", () => {
    const dupe = [m("20260101000000", "a"), m("20260102000000", "a")];
    expect(() => compareMigrations(dupe, [])).toThrow(/duplicate migration name/i);
    expect(() => compareMigrations([], dupe)).toThrow(/duplicate migration name/i);
  });
});
