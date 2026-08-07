import { describe, expect, it } from "vitest";
import {
  blockingFailures,
  compareMigrations,
  parseAppliedRows,
  parseCliOptions,
  parseMigrationFilename,
} from "./check-migrations.mjs";

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
    expect(compareMigrations(repo, [...repo])).toEqual({ missing: [], orphaned: [], mismatched: [], duplicated: [] });
  });

  it("is insensitive to the order rows come back in", () => {
    const repo = [m("20260101000000", "a"), m("20260102000000", "b")];
    const applied = [m("20260102000000", "b"), m("20260101000000", "a")];
    expect(compareMigrations(repo, applied)).toEqual({ missing: [], orphaned: [], mismatched: [], duplicated: [] });
  });

  it("reports a repo migration that was never applied", () => {
    const repo = [m("20260101000000", "a"), m("20260102000000", "b")];
    const applied = [m("20260101000000", "a")];
    expect(compareMigrations(repo, applied)).toEqual({
      missing: [m("20260102000000", "b")],
      orphaned: [],
      mismatched: [],
      duplicated: [],
    });
  });

  it("reports an applied migration with no repo file", () => {
    const repo = [m("20260101000000", "a")];
    const applied = [m("20260101000000", "a"), m("20260102000000", "ghost")];
    expect(compareMigrations(repo, applied)).toEqual({
      missing: [],
      orphaned: [m("20260102000000", "ghost")],
      mismatched: [],
      duplicated: [],
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
      duplicated: [],
    });
  });

  it("separates a genuine mismatch from a genuine gap in the same run", () => {
    const repo = [m("20260101000000", "drifted"), m("20260103000000", "unapplied")];
    const applied = [m("20260102000000", "drifted")];
    expect(compareMigrations(repo, applied)).toEqual({
      missing: [m("20260103000000", "unapplied")],
      orphaned: [],
      mismatched: [{ name: "drifted", repoVersion: "20260101000000", appliedVersion: "20260102000000" }],
      duplicated: [],
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

  // Name is the join key, so a duplicate makes every result ambiguous. A repo-side
  // duplicate is a repo bug the author can fix, so it throws.
  it("throws when a repo migration name is not unique", () => {
    const dupe = [m("20260101000000", "a"), m("20260102000000", "a")];
    expect(() => compareMigrations(dupe, [])).toThrow(/duplicate migration name/i);
  });

  // A production-side duplicate is a real state the operator has to be told about,
  // not a crash: the same name applied twice under different versions is exactly
  // the drift-shaped incident this script exists to explain.
  // A duplicated name is already reported under its own heading. Letting it also
  // land in `orphaned` prints the same name twice under two headings, which is
  // exactly the noise someone triaging the alert does not need.
  it("does not also report a duplicated name as orphaned", () => {
    const applied = [m("20260101000000", "ghost"), m("20260102000000", "ghost")];
    const result = compareMigrations([], applied);
    expect(result.duplicated).toEqual([{ name: "ghost", versions: ["20260101000000", "20260102000000"] }]);
    expect(result.orphaned).toEqual([]);
  });

  it("reports a duplicate applied name instead of throwing", () => {
    const repo = [m("20260101000000", "a")];
    const applied = [m("20260101000000", "a"), m("20260102000000", "a")];
    const result = compareMigrations(repo, applied);
    expect(result.duplicated).toEqual([{ name: "a", versions: ["20260101000000", "20260102000000"] }]);
    expect(result.missing).toEqual([]);
    expect(result.mismatched).toEqual([]);
  });
});

describe("parseAppliedRows", () => {
  it("maps well-formed rows", () => {
    expect(parseAppliedRows([{ version: "20260101000000", name: "a" }])).toEqual([
      { version: "20260101000000", name: "a" },
    ]);
  });

  // Silently dropping a row makes its repo counterpart look `missing` (wrong
  // remediation) or makes a genuine orphan vanish and the check pass on a database
  // db push will still refuse. The one input everything depends on fails loudly.
  it("throws rather than dropping a malformed row", () => {
    expect(() => parseAppliedRows([{ version: 20260101000000, name: "a" }])).toThrow(/unusable/i);
    expect(() => parseAppliedRows([{ version: "20260101000000", name: null }])).toThrow(/unusable/i);
    expect(() => parseAppliedRows([{ version: "20260101000000", name: "" }])).toThrow(/unusable/i);
  });
});

describe("parseCliOptions", () => {
  it("defaults to enforcing everything with no wait", () => {
    expect(parseCliOptions([])).toEqual({ allowMissing: false, waitSeconds: 0 });
  });

  it("reads --allow-missing and --wait-seconds", () => {
    expect(parseCliOptions(["--allow-missing"])).toEqual({ allowMissing: true, waitSeconds: 0 });
    expect(parseCliOptions(["--wait-seconds=120"])).toEqual({ allowMissing: false, waitSeconds: 120 });
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseCliOptions(["--nope"])).toThrow(/unknown option/i);
    expect(() => parseCliOptions(["--wait-seconds=soon"])).toThrow(/--wait-seconds/i);
  });
});

describe("blockingFailures", () => {
  const empty = { missing: [], orphaned: [], mismatched: [], duplicated: [] };

  it("returns nothing when everything agrees", () => {
    expect(blockingFailures(empty, { allowMissing: false })).toEqual([]);
  });

  it("blocks on mismatched, orphaned and duplicated", () => {
    expect(blockingFailures({ ...empty, mismatched: [{}] }, { allowMissing: false })).toEqual(["mismatched"]);
    expect(blockingFailures({ ...empty, orphaned: [{}] }, { allowMissing: false })).toEqual(["orphaned"]);
    expect(blockingFailures({ ...empty, duplicated: [{}] }, { allowMissing: false })).toEqual(["duplicated"]);
  });

  // At PR time a migration the PR ADDS cannot be in production yet -- the merge is
  // what applies it. Enforcing `missing` there would fail every migration-bearing
  // PR by construction. Drift and orphans are still meaningful pre-merge.
  it("does not block on missing when allowMissing is set", () => {
    expect(blockingFailures({ ...empty, missing: [{}] }, { allowMissing: true })).toEqual([]);
    expect(blockingFailures({ ...empty, missing: [{}] }, { allowMissing: false })).toEqual(["missing"]);
  });

  it("still blocks on drift in a pre-merge run", () => {
    expect(blockingFailures({ ...empty, missing: [{}], mismatched: [{}] }, { allowMissing: true })).toEqual([
      "mismatched",
    ]);
  });
});
