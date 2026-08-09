import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { safeAppOrigin } from "./appOrigin.ts";
import type { Deps } from "./deps.ts";

// Minimal Deps stub: only deps.env is read (via appUrl). APP_URL unset => prod default.
const depsWith = (appUrl?: string): Deps =>
  ({ env: (k: string) => (k === "APP_URL" ? appUrl : undefined) } as unknown as Deps);

Deno.test("safeAppOrigin: accepts the canonical prod origin", () => {
  assertEquals(safeAppOrigin("https://app.showflow.pro", depsWith()), "https://app.showflow.pro");
});

Deno.test("safeAppOrigin: accepts a custom APP_URL canonical", () => {
  const d = depsWith("https://staging.example.com");
  assertEquals(safeAppOrigin("https://staging.example.com", d), "https://staging.example.com");
});

Deno.test("safeAppOrigin: accepts localhost:8080 even when APP_URL is unset (prod default canonical)", () => {
  // The load-bearing local-stack case: APP_URL unset => canonical is prod, but :8080 is still allowed.
  assertEquals(safeAppOrigin("http://localhost:8080", depsWith()), "http://localhost:8080");
  assertEquals(safeAppOrigin("http://127.0.0.1:8080", depsWith()), "http://127.0.0.1:8080");
});

Deno.test("safeAppOrigin: trims a trailing slash before matching", () => {
  assertEquals(safeAppOrigin("https://app.showflow.pro/", depsWith()), "https://app.showflow.pro");
});

Deno.test("safeAppOrigin: rejects a foreign origin -> null", () => {
  assertEquals(safeAppOrigin("https://evil.example", depsWith()), null);
});

Deno.test("safeAppOrigin: rejects missing / malformed -> null", () => {
  assertEquals(safeAppOrigin(undefined, depsWith()), null);
  assertEquals(safeAppOrigin("not a url", depsWith()), null);
});
