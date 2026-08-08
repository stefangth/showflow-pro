import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Print which Supabase project the dev server is pointed at, so `npm run dev`
 * (LOCAL by default) vs `npm run dev:prod` is never ambiguous — for humans or
 * agents. Serve-mode only; never runs in a production build.
 */
function supabaseTargetBanner(url: string | undefined): Plugin {
  return {
    name: "supabase-target-banner",
    apply: "serve",
    configResolved() {
      if (!url) return;
      const isLocal = /127\.0\.0\.1|localhost/.test(url);
      const label = isLocal
        ? "LOCAL (127.0.0.1:54321)"
        : `PRODUCTION (${url.replace(/^https?:\/\//, "").split(".")[0]})`;
      console.log(`\n▶ Supabase: ${label}\n`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    supabaseTargetBanner(loadEnv(mode, process.cwd(), "").VITE_SUPABASE_URL),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
