import { createRoot } from "react-dom/client";
import "./index.css";
import { missingClientEnv } from "./config/env";

const rootEl = document.getElementById("root")!;
const missing = missingClientEnv(import.meta.env);

if (missing.length > 0) {
  // Required env is absent — importing App would pull in the Supabase client,
  // whose createClient(undefined, ...) throws at module load and leaves a blank
  // screen. Render a legible config-error screen instead, and do NOT import App.
  rootEl.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0b0f;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
      <div style="max-width:520px">
        <h1 style="font-size:20px;font-weight:600;margin:0 0 12px">Configuration error</h1>
        <p style="margin:0 0 12px;color:#9ca3af;line-height:1.5">
          The app can’t start because required configuration is missing from this deployment.
          Set the following environment variable${missing.length > 1 ? "s" : ""} and redeploy:
        </p>
        <ul style="margin:0;padding-left:20px;line-height:1.9">
          ${missing.map((k) => `<li><code style="background:#1f2937;padding:2px 6px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${k}</code></li>`).join("")}
        </ul>
      </div>
    </div>
  `;
} else {
  // Defer App (and thus the Supabase client) until env is confirmed present.
  void import("./App.tsx").then(({ default: App }) => {
    createRoot(rootEl).render(<App />);
  });
}
