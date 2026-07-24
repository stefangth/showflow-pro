import { describe, expect, it } from "vitest";
import { diffMigrations, repoNameFromFilename } from "./check-migrations.mjs";

describe("repoNameFromFilename", () => {
  it("strips the version prefix and .sql suffix", () => {
    expect(repoNameFromFilename("20260724120000_hire_order_dates_and_delivery.sql")).toBe("hire_order_dates_and_delivery");
    expect(repoNameFromFilename("00000000000000_local_extensions.sql")).toBe("local_extensions");
  });
});

describe("diffMigrations", () => {
  it("returns [] when every repo name is applied (drift-tolerant: version ignored)", () => {
    expect(diffMigrations(["a", "b"], new Set(["a", "b", "extra"]))).toEqual([]);
  });
  it("returns the repo names missing from the applied set", () => {
    expect(diffMigrations(["a", "b", "c"], new Set(["a"]))).toEqual(["b", "c"]);
  });
});
