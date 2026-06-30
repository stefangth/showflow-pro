import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = { org_id?: string; baseId?: string; linkedTableId?: string; tableName?: string; programField?: string; subProgramField?: string };

const AIRTABLE_META = "https://api.airtable.com/v0/meta";
const AIRTABLE_DATA = "https://api.airtable.com/v0";
/** meta/bases returns <=1000 bases/page; cap the offset loop so a pathological
 *  response can never spin forever (mirrors airtable-poll's MAX_PAGES guard). */
const MAX_BASE_PAGES = 10;
const MAX_RECORD_PAGES = 50;

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
 * Modes (one Airtable scope, schema.bases:read, gates all):
 *  - body has no baseId → list accessible bases  → { schemaAccessible: true, bases: [{ id, name }] }.
 *  - body has a baseId  → describe that base      → { schemaAccessible: true, tables: [{ id, name, fields: [{ id, name, type, options? }] }] }.
 *  - body has baseId + linkedTableId → list that linked table's records → { schemaAccessible: true, records: [{ id, name }] }.
 *  - body has baseId + tableName + subProgramField (+ programField?) → distinct (program, sub_program) pairs → { schemaAccessible: true, pairs: [{ program, sub_program }] }.
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

    // ── Mode C: list a linked table's records (id + primary-field name) ───────
    if (body?.baseId && body?.linkedTableId) {
      const schemaRes = await deps.fetch(`${AIRTABLE_META}/bases/${encodeURIComponent(body.baseId)}/tables`, { headers });
      const schemaFail = await airtableFailure(schemaRes, "Airtable schema read failed");
      if (schemaFail) return schemaFail;
      const schemaData = (await schemaRes.json()) as { tables?: Array<{ id: string; primaryFieldId?: string }> };
      const linked = (schemaData.tables ?? []).find((t) => t.id === body.linkedTableId);
      if (!linked?.primaryFieldId) return json({ error: "Linked table not found in base schema" }, 404);
      const primaryFieldId = linked.primaryFieldId;

      const records: Array<{ id: string; name: string }> = [];
      let offset: string | undefined;
      let pages = 0;
      do {
        const params = new URLSearchParams({ returnFieldsByFieldId: "true" });
        params.append("fields[]", primaryFieldId);
        if (offset) params.set("offset", offset);
        const recRes = await deps.fetch(
          `${AIRTABLE_DATA}/${encodeURIComponent(body.baseId)}/${encodeURIComponent(body.linkedTableId)}?${params.toString()}`,
          { headers },
        );
        const recFail = await airtableFailure(recRes, "Airtable records read failed");
        if (recFail) return recFail;
        const data = (await recRes.json()) as { records?: Array<{ id: string; fields?: Record<string, unknown> }>; offset?: string };
        for (const r of data.records ?? []) {
          const v = r.fields?.[primaryFieldId];
          if (v != null && String(v) !== "") records.push({ id: r.id, name: String(v) });
        }
        offset = data.offset;
        pages += 1;
      } while (offset && pages < MAX_RECORD_PAGES);

      return json({ schemaAccessible: true, records });
    }

    // ── Mode D: distinct (program, sub_program) pairs from the main table ──────
    //    Powers composite-grain catalog linking; the UI builds keys from these.
    if (body?.baseId && body?.tableName && body?.subProgramField) {
      const seen = new Set<string>();
      const pairs: Array<{ program: string | null; sub_program: string }> = [];
      let offset: string | undefined;
      let pages = 0;
      do {
        const params = new URLSearchParams();
        params.append("fields[]", body.subProgramField);
        if (body.programField) params.append("fields[]", body.programField);
        if (offset) params.set("offset", offset);
        const recRes = await deps.fetch(
          `${AIRTABLE_DATA}/${encodeURIComponent(body.baseId)}/${encodeURIComponent(body.tableName)}?${params.toString()}`,
          { headers },
        );
        const recFail = await airtableFailure(recRes, "Airtable records read failed");
        if (recFail) return recFail;
        const data = (await recRes.json()) as { records?: Array<{ fields?: Record<string, unknown> }>; offset?: string };
        for (const r of data.records ?? []) {
          const subRaw = r.fields?.[body.subProgramField];
          const sub = subRaw == null ? "" : String(subRaw).trim();
          if (!sub) continue;
          const progRaw = body.programField ? r.fields?.[body.programField] : null;
          const prog = progRaw == null ? null : (String(progRaw).trim() || null);
          const dedup = `${prog ?? ""}\x00${sub}`;
          if (seen.has(dedup)) continue;
          seen.add(dedup);
          pairs.push({ program: prog, sub_program: sub });
        }
        offset = data.offset;
        pages += 1;
      } while (offset && pages < MAX_RECORD_PAGES);

      return json({ schemaAccessible: true, pairs });
    }

    // ── Mode B: describe one base's tables + fields ───────────────────────────
    // The tables endpoint returns every table in one response (not offset-paginated,
    // unlike /meta/bases below), so there is no page loop here.
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
