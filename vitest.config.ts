import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // Dummy Supabase env so the client singleton can be constructed without a
    // local .env file — unit tests only ever talk to the supabaseFake harness.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
      VITE_SUPABASE_PROJECT_ID: "test",
      // Pin the dev auto-login OFF for the suite. `devAutoLogin` is guarded by
      // `import.meta.env.DEV`, which is TRUE under vitest, so a developer who
      // enables VITE_DEV_AUTOLOGIN in their local .env would otherwise have
      // AuthProvider attempt a real sign-in on mount inside tests. That turns
      // AuthContext.bootstrapResilience.test.tsx red on their machine and green
      // in CI (which has no .env), which is the worst possible split.
      VITE_DEV_AUTOLOGIN: "false",
    },
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.{ts,mjs}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "src/components/ui/**", // shadcn primitives — generated
        "src/integrations/supabase/types.ts", // auto-generated
        "src/**/*.d.ts",
        "src/main.tsx",
      ],
      thresholds: {
        // Ratchet up over time, never down. The gate exists to prevent
        // regression, not to assert high coverage — so each number sits a few
        // points under the actual at the time it was last raised, leaving room
        // for a PR that adds a not-yet-covered page without going red.
        //
        // Raised 2026-08-05 from 25/60/40/25, which the suite had long outgrown
        // (actuals were 78.36 / 81.23 / 66.26 / 78.36 — years of slack, so a
        // real regression could never have tripped it). Re-check the actuals in
        // the CI job output before raising these again.
        statements: 75,
        branches: 78,
        functions: 63,
        lines: 75,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
