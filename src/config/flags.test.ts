import { describe, it, expect, vi, afterEach } from "vitest";

describe("GETRUNNING_V3 flag", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("is false when the env var is unset", async () => {
    vi.stubEnv("VITE_GETRUNNING_V3", "");
    const { GETRUNNING_V3 } = await import("./flags");
    expect(GETRUNNING_V3).toBe(false);
  });

  it("is true only for the exact string 'true'", async () => {
    vi.stubEnv("VITE_GETRUNNING_V3", "true");
    const { GETRUNNING_V3 } = await import("./flags");
    expect(GETRUNNING_V3).toBe(true);
  });
});
