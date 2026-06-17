import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = { org_id?: string; baseId?: string };

const AIRTABLE_META = "https://api.airtable.com/v0/meta";
/** meta/bases returns <=1000 bases/page; cap the offset loop so a pathological
 *  response can never spin forever (mirrors airtable-poll's MAX_PAGES guard). */
const MAX_BASE_PAGES = 10;

interface AirtableBase { id: string; name: string; permissionLevel?: string }
interface AirtableField { id: string; name: string; type: string; options?: Record<string, unknown> }
interface AirtableTable { id: string; name: string; fields?: AirtableField[] }

/** Map a non-OK Airtable Meta response to a client response.
 *  403 (missing schema.bases:read scope) is the EXPECTED manual-fallback signal,
 *  not an error. 401 means the stored PAT is bad. Returns null when res is OK
 *  and the caller should proceed to parse the body. */
async function airtableFailure(res: Response, label: string): Promise<Response | null> {
  if (res.ok) return null;
  if (res.status === 403) return json({ schemaAccessible: false });
  if (res.status === 401) return json({ error: "Airtable key is invalid or revoked" }, 400);
  const detail = (await res.text()).slice(0, 300);
  return json({ error: `${label} (${res.status})`, detail }, 502);
}

/**
 * Reads the org's Airtable schema for the mapping UI.
 *
 * Auth: user JWT, requireOrgRole(org_id, ['admin']) (super-admins pass too).
 * The org PAT is read from the Vault via get_org_airtable_key and used only
 * server-side — it is NEVER returned to the client.
 *
 * Modes (one Airtable scope, schema.bases:read, gates both):
 *  - body has no baseId → list accessible bases  → { schemaAccessible: true, bases: [{ id, name }] }.
 *  - body has a baseId  → describe that base      → { schemaAccessible: true, tables: [{ id, name, fields: [{ id, name, type, options? }] }] }.
 *  - Airtable 403 (no scope) → { schemaAccessible: false } so the UI falls back to typed inputs.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const orgId = body?.org_id;
    if (!orgId) return json({ error: "Invalid payload: org_id is required" }, 400);

    // Caller must be an admin of the target org (super-admins pass via requireOrgRole).
    const auth = await requireOrgRole(deps, req, orgId, ["admin"]);
    if (!auth.ok) return auth.response;

    // The org's Vault-stored PAT, used server-side only. Never echoed to the client.
    const { data: apiKey } = await deps.admin.rpc("get_org_airtable_key", { _org: orgId });
    if (!apiKey) return json({ error: "No Airtable key configured for this organization" }, 400);
    const headers = { Authorization: `Bearer ${apiKey as string}` };

    // ── Mode B: describe one base's tables + fields ───────────────────────────
    if (body?.baseId) {
      const res = await deps.fetch(`${AIRTABLE_META}/bases/${encodeURIComponent(body.baseId)}/tables`, { headers });
      const fail = await airtableFailure(res, "Airtable schema read failed");
      if (fail) return fail;
      const data = (await res.json()) as { tables?: AirtableTable[] };
      const tables = (data.tables ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        fields: (t.fields ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          ...(f.options ? { options: f.options } : {}),
        })),
      }));
      return json({ schemaAccessible: true, tables });
    }

    // ── List accessible bases (offset-paginated) ──────────────────────────────
    const bases: Array<{ id: string; name: string }> = [];
    let offset: string | undefined;
    let pages = 0;
    do {
      const url = offset
        ? `${AIRTABLE_META}/bases?offset=${encodeURIComponent(offset)}`
        : `${AIRTABLE_META}/bases`;
      const res = await deps.fetch(url, { headers });
      const fail = await airtableFailure(res, "Airtable base list failed");
      if (fail) return fail;
      const data = (await res.json()) as { bases?: AirtableBase[]; offset?: string };
      for (const b of data.bases ?? []) {
        // permissionLevel "none" = interface-only base the PAT can't actually read.
        if (b.permissionLevel !== "none") bases.push({ id: b.id, name: b.name });
      }
      offset = data.offset;
      pages += 1;
    } while (offset && pages < MAX_BASE_PAGES);

    // Never silently drop bases: if we stopped at the page cap with more to fetch, say so.
    if (offset && pages >= MAX_BASE_PAGES) {
      console.warn("airtable-schema: MAX_BASE_PAGES reached; base list is truncated", { orgId, pages });
    }

    return json({ schemaAccessible: true, bases });
  } catch (e) {
    console.error("airtable-schema error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
