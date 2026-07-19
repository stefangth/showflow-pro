import { describe, it, expect } from "vitest";
import { missingClientEnv } from "./env";

describe("missingClientEnv", () => {
  it("reports nothing when both required vars are present", () => {
    expect(
      missingClientEnv({
        VITE_SUPABASE_URL: "https://x.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "anon-key",
      }),
    ).toEqual([]);
  });

  it("reports vars that are undefined", () => {
    // The exact production failure: the Vite build baked in undefined, so
    // createClient(undefined, ...) threw at import and blanked the app.
    expect(missingClientEnv({})).toEqual([
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    ]);
  });

  it("treats empty / whitespace-only values as missing", () => {
    expect(
      missingClientEnv({ VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "   " }),
    ).toEqual(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  });

  it("reports only the missing one", () => {
    expect(
      missingClientEnv({ VITE_SUPABASE_URL: "https://x.supabase.co" }),
    ).toEqual(["VITE_SUPABASE_PUBLISHABLE_KEY"]);
  });
});
