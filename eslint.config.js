import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Severity is "warn" during the cleanup tasks of the zero-warnings plan;
// the final task flips these to "error" and adds --max-warnings 0 to the
// lint script so new violations fail CI.
const strictness = {
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "@typescript-eslint/no-explicit-any": "warn",
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
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      ...strictness,
    },
  },
  // shadcn primitives are generated (never hand-edited) and the test harness
  // is never HMR'd — fast-refresh hygiene is meaningless in both.
  {
    files: ["src/components/ui/**", "src/test/**"],
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
