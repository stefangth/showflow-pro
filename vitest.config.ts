import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
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
        // Conservative starting gate — ratchet up over time, never down.
        // Most pages/components aren't unit-covered yet; the data/lib layers are.
        // The gate exists to prevent regression, not to assert high coverage.
        statements: 25,
        branches: 60,
        functions: 40,
        lines: 25,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
