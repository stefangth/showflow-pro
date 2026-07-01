import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = { org_id: string; url: string };

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const TIMEOUT_MS = 8000;

/**
 * SSRF guard: only allow Google Sheets "publish to web / export as CSV" links.
 * Host must be exactly docs.google.com, the path a /spreadsheets/ path, and the
 * export format csv. Anything else (internal hosts, other schemes) is rejected.
 */
function isAllowedSheetUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.hostname !== "docs.google.com") return false;
  if (!u.pathname.startsWith("/spreadsheets/")) return false;
  return u.searchParams.get("format") === "csv";
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.org_id || !body?.url) return json({ error: "Invalid payload" }, 400);

    // Producer or admin of the target org (super-admins pass via requireOrgRole).
    const auth = await requireOrgRole(deps, req, body.org_id, ["producer", "admin"]);
    if (!auth.ok) return auth.response;

    if (!isAllowedSheetUrl(body.url)) {
      return json({ error: "Only public Google Sheets CSV links are allowed" }, 400);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await deps.fetch(body.url, { redirect: "manual", signal: controller.signal });

      // Never follow a redirect (could bounce to an internal host).
      if (res.status >= 300 && res.status < 400) {
        return json({ error: "Redirects are not allowed" }, 400);
      }
      if (!res.ok) {
        return json({ error: "The sheet was not reachable (is it published to the web?)" }, 502);
      }

      // Reject early on a declared-oversized body...
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_BYTES) {
        return json({ error: "Sheet is too large" }, 502);
      }

      // ...then read (the abort timer still guards this download) and re-check the cap.
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) return json({ error: "Sheet is too large" }, 502);
      return json({ csv: new TextDecoder().decode(buf) }, 200);
    } catch (_e) {
      // fetch failure, or an abort (timeout) during the headers/body read.
      return json({ error: "Could not fetch the sheet (timed out or unreachable)" }, 502);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("fetch-remote-sheet error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
