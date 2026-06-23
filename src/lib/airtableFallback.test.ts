import { describe, it, expect } from "vitest";
import { airtableFallbackMessage } from "./airtableFallback";

describe("airtableFallbackMessage", () => {
  it("tells a no-scope key to grant schema.bases:read", () => {
    expect(airtableFallbackMessage("no-scope")).toMatch(/schema\.bases:read/);
  });
  it("does not blame the scope for a per-base permission failure", () => {
    const m = airtableFallbackMessage("per-base");
    expect(m).toMatch(/this specific base/i);
    expect(m).not.toMatch(/schema\.bases:read/);
  });
  it("describes a transient error without blaming the key", () => {
    const m = airtableFallbackMessage("error");
    expect(m).toMatch(/Couldn't reach Airtable/i);
    expect(m).not.toMatch(/schema\.bases:read/);
  });
});
