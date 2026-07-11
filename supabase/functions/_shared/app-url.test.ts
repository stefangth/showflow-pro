import { assertEquals } from "./test-asserts.ts";
import { appUrl, DEFAULT_APP_URL } from "./app-url.ts";

Deno.test("appUrl: default is the app host, not the marketing site", () => {
  assertEquals(appUrl(() => undefined), "https://app.showflow.pro");
  assertEquals(DEFAULT_APP_URL, "https://app.showflow.pro");
});

Deno.test("appUrl: honors the APP_URL env override", () => {
  assertEquals(appUrl(() => "https://staging.example.com"), "https://staging.example.com");
});

Deno.test("appUrl: trims trailing slashes from the override", () => {
  assertEquals(appUrl(() => "https://staging.example.com/"), "https://staging.example.com");
  assertEquals(appUrl(() => "https://staging.example.com///"), "https://staging.example.com");
});

Deno.test("appUrl: blank/whitespace override falls back to the default", () => {
  assertEquals(appUrl(() => ""), DEFAULT_APP_URL);
  assertEquals(appUrl(() => "   "), DEFAULT_APP_URL);
});
