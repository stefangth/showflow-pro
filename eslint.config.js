import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// All three rules are errors and the lint script runs with --max-warnings 0:
// any new violation fails CI. The `any` boundary policy lives in CLAUDE.md
// ("TypeScript" section).
const strictness = {
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "@typescript-eslint/no-explicit-any": "error",
};

export default tseslint.config(
  { ignores: ["dist"] },
  // App, tests, e2e, scripts — browser runtime, Vite fast refresh.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    ignores: ["supabase/functions/**"],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
      ...strictness,
    },
  },
  // shadcn primitives are generated (never hand-edited) and the test harness
  // is never HMR'd — fast-refresh hygiene is meaningless in both. The three
  // context modules deliberately co-locate provider + hooks (editing them
  // full-reloads the dev server; accepted). Splitting them for fast refresh
  // is deferred to a standalone PR — that PR deletes this carve-out.
  //
  // render.tsx is the hire-order PDF document: dual-homed (byte-identical
  // with its generated supabase/functions/ mirror, which is why it can't
  // just export buildStyles/renderHireOrderPdf from a second file) and never
  // mounted as a live DOM component, so Fast Refresh has nothing to do with
  // it either way — it's called once to produce PDF bytes, in the browser
  // (settings preview) or on the edge (issue/download).
  {
    files: [
      "src/components/ui/**",
      "src/test/**",
      "src/features/auth/AuthContext.tsx",
      "src/features/editor/EditorContext.tsx",
      "src/features/consent/ConsentContext.tsx",
      "src/lib/hireOrders/pdf/render.tsx",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },
  // Deno edge functions: server runtime. No Vite fast refresh (the React
  // Email templates are rendered server-side, never HMR'd) and no browser
  // globals. rules-of-hooks still applies to the email template components.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["supabase/functions/**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2020, globals: { Deno: "readonly" } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...strictness,
    },
  },
);
