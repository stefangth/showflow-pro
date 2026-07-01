# Bulk artist import from a spreadsheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a producer+admin "Import from sheet" wizard on the Artists page that ingests a CSV/XLSX file or a pasted public Google Sheets link, maps columns to artist fields, lets the operator review/dedup/select rows, and bulk-creates artists in one atomic RPC — with an optional "send login invites" step reusing Spec A.

**Architecture:** Parsing/mapping/dedup live in three pure `src/lib/artistImport/*` modules (unit-tested in isolation); the `ArtistImportDialog` 4-step wizard is a thin shell over them plus two data-access functions. Commit goes through a `SECURITY DEFINER` `bulk_import_artists` RPC (server-side role gate + server-side dedup); the paste-link path goes through a new SSRF-guarded `fetch-remote-sheet` edge proxy. Producer+admin gating is enforced server-side in both the RPC and the edge function, never trusting the client.

**Tech Stack:** React 18 + Vite + TS, @tanstack/react-query v5, papaparse (CSV), SheetJS xlsx (lazy), shadcn/ui (Dialog, Command, Table, Badge, Progress), Supabase (Postgres + Deno edge fns), vitest + jsdom, pgTAP, Deno test.

> **DEPENDS ON Spec A — implement A first, same feature branch, order A→B.** This plan **consumes** these Spec-A interfaces without redefining them:
> - `inviteArtistToApp(client, { orgId, artistId, email }): Promise<void>` in `src/data/invitations.ts`
> - `fetchPendingInvitedArtistIds(client, orgId): Promise<string[]>` in `src/data/artists.ts`
> - React Query key `['artists','pending-invites', orgId]`
> - `create-invitation` edge fn accepts optional `artist_id` (forces `role = 'artist'`)
>
> The optional invite-on-import step (Task 8H) is the only place B touches these. If A has not merged when B lands, that step's checkbox is simply hidden — B still builds and ships.

## Global Constraints

- **Local env is Deno-only.** `npx vitest run`, `npm run lint`, pgTAP (`supabase test db`) run in **CI only** — show the real command marked `# (CI — not run locally)`. Deno edge tests run locally: `deno test --allow-all --node-modules-dir=none supabase/functions/<fn>/`.
- **Migrations** via Supabase MCP `apply_migration` (real-timestamp version names; name files to match). Never hand-edit `supabase/migrations/*` or `src/integrations/supabase/types.ts`; regenerate types via MCP `generate_typescript_types` after a migration.
- **Edge functions** use DI: `handle(req, deps)` + `Deno.serve` at bottom; tests use `handle` + `makeFakeDeps` from `supabase/functions/_shared/testing.ts`; use `_shared/http.ts`, `_shared/auth.ts` (`requireOrgRole`). New function needs a `[functions.fetch-remote-sheet]` block in `supabase/config.toml` with `verify_jwt = true`.
- **Frontend data-access pattern:** `src/data/<domain>.ts` `fetchX(client,args)`; thin hooks; test with `src/test/supabaseFake.ts`; components with `src/test/renderWithProviders.tsx`. Keep parse/map/dedup logic in pure `src/lib/artistImport/*` modules, unit-tested independently; the wizard component is a thin shell.
- **Dedup = skip existing** on `lower(email)` within org, re-checked server-side in the RPC.
- **Producer+admin gating** enforced server-side (`has_org_role(uid, org, ['producer','admin'])` in the RPC; `requireOrgRole(org_id, ['producer','admin'])` in the edge fn), not just UI.
- **Security:** the `fetch-remote-sheet` proxy MUST host-allowlist Google Sheets published-CSV URLs, reject other hosts, not follow redirects to internal hosts, and cap response size + timeout (SSRF).
- **Styling:** semantic tokens only. **Commits:** imperative lowercase ≤72 chars, conventional prefixes.
- **Versioning:** user-facing → MINOR bump (`package.json` + `APP_META.VERSION`), `public/changelog.md` newest-first, regenerate `public/changelog.json` via the deno script. Include a final versioning task (note: coordinate a single combined vX.Y.0 with Spec A if landing together).

> **House-pattern note (`has_org_role` has no array overload):** the SQL helper is `has_org_role(_uid uuid, _org uuid, _role app_role)` — a single role. The plan's "`has_org_role(uid, org, ['producer','admin'])`" shorthand is realized in SQL as
> `(public.has_org_role(v_uid, p_org, 'producer') or public.has_org_role(v_uid, p_org, 'admin'))`.
> (`has_org_role` already short-circuits `true` for super-admins.) Use that OR everywhere the RPC guards the role.

---

### Task 1: Add spreadsheet-parsing dependencies

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `papaparse`, `xlsx` runtime deps + `@types/papaparse` dev dep available to import.

- [ ] Read `package.json`; confirm none of `papaparse`, `xlsx`, `@types/papaparse` are present (verified absent at plan time).
- [ ] Add to `dependencies`: `"papaparse": "^5.4.1"` and `"xlsx": "^0.18.5"`. Add to `devDependencies`: `"@types/papaparse": "^5.3.14"`. Keep the existing alpha-ordering of each block.
- [ ] Run install so the lockfile updates (CI uses `npm ci`): `npm install papaparse xlsx && npm install -D @types/papaparse` `# (CI — not run locally; if a package manager is unavailable locally, edit package.json + let CI resolve, and note the lockfile follow-up)`.
- [ ] Verify import resolves in a scratch check: `node -e "require('papaparse'); console.log('ok')"` `# (CI — not run locally)`. Expected: `ok`.
- [ ] Commit: `chore: add papaparse + xlsx for artist import`.

---

### Task 2: Pure `parseSheet` — file/text → { headers, rows }

**Files:**
- Create: `src/lib/artistImport/parseSheet.ts`
- Test: `src/lib/artistImport/parseSheet.test.ts`
- Create (fixtures): `src/lib/artistImport/__fixtures__/artists.csv`, `src/lib/artistImport/__fixtures__/artists.b64xlsx.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SheetKind = 'csv' | 'xlsx';
  export interface ParsedSheet { headers: string[]; rows: Record<string, string>[]; }
  export const MAX_IMPORT_ROWS = 5000;
  export async function parseSheet(input: string | ArrayBuffer, kind: SheetKind): Promise<ParsedSheet>;
  ```
  `csv` → `input` is CSV text, parsed with papaparse (`header: true`, `skipEmptyLines: true`). `xlsx` → `input` is an `ArrayBuffer`, parsed via **dynamic** `await import('xlsx')` (first sheet, `sheet_to_json` with `header: 1` then normalized to objects). Throws `Error('Sheet exceeds N rows')` when `rows.length > MAX_IMPORT_ROWS`. Header order is preserved; every cell coerced to trimmed `string` (missing → `''`).

- [ ] Write the failing test `parseSheet.test.ts`: a CSV fixture string with header `name,email,phone,bio` and 2 rows → `parseSheet(csv, 'csv')` resolves `{ headers: ['name','email','phone','bio'], rows: [{name:'Ada',email:'ada@x.com',...}, ...] }`. Add a quoted-comma case (`"Doe, Jane"`) that stays one cell. Add a case: 5001-row CSV rejects with `/exceeds/`.
- [ ] Run it: `npx vitest run src/lib/artistImport/parseSheet.test.ts` `# (CI — not run locally)`. Expected: FAIL (module missing).
- [ ] Implement `parseSheet.ts` CSV branch fully with papaparse:
  ```ts
  import Papa from 'papaparse';

  export type SheetKind = 'csv' | 'xlsx';
  export interface ParsedSheet { headers: string[]; rows: Record<string, string>[]; }
  export const MAX_IMPORT_ROWS = 5000;

  function coerceRows(headers: string[], raw: Record<string, unknown>[]): Record<string, string>[] {
    return raw.map((r) => {
      const out: Record<string, string> = {};
      for (const h of headers) out[h] = String(r[h] ?? '').trim();
      return out;
    });
  }

  function guard(rows: unknown[]): void {
    if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Sheet exceeds ${MAX_IMPORT_ROWS} rows`);
  }

  export async function parseSheet(input: string | ArrayBuffer, kind: SheetKind): Promise<ParsedSheet> {
    if (kind === 'csv') {
      const parsed = Papa.parse<Record<string, string>>(String(input), {
        header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(),
      });
      const headers = (parsed.meta.fields ?? []).map((h) => h.trim());
      guard(parsed.data);
      return { headers, rows: coerceRows(headers, parsed.data) };
    }
    const XLSX = await import('xlsx');
    const wb = XLSX.read(input, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false, defval: '' });
    const headers = (matrix[0] ?? []).map((h) => String(h).trim());
    const body = matrix.slice(1);
    guard(body);
    const rows = body.map((arr) => {
      const out: Record<string, string> = {};
      headers.forEach((h, i) => { out[h] = String(arr[i] ?? '').trim(); });
      return out;
    });
    return { headers, rows };
  }
  ```
- [ ] Add the XLSX fixture as a base64 workbook string in `__fixtures__/artists.b64xlsx.ts` (a tiny 1-sheet workbook with the same headers + 1 row); in the test, decode to `ArrayBuffer` and assert `parseSheet(buf, 'xlsx')` yields the same shape. (Generating the fixture: build once with `XLSX.utils.aoa_to_sheet` in a throwaway script and paste the base64; keep it small.)
- [ ] Run: `npx vitest run src/lib/artistImport/parseSheet.test.ts` `# (CI — not run locally)`. Expected: PASS (CSV + XLSX + cap).
- [ ] Commit: `feat: add parseSheet csv/xlsx reader for artist import`.

---

### Task 3: Pure `guessMapping` — headers → suggested field map

**Files:**
- Create: `src/lib/artistImport/guessMapping.ts`
- Test: `src/lib/artistImport/guessMapping.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FieldMapping { name?: string; email?: string; phone?: string; bio?: string; }
  export function guessMapping(headers: string[]): FieldMapping;
  ```
  Fuzzy, case-insensitive, punctuation-insensitive header match: `name`/`full name`/`artist` → `name`; `email`/`e-mail`/`mail` → `email`; `phone`/`tel`/`mobile`/`cell` → `phone`; `bio`/`notes`/`about` → `bio`. Each source header maps to at most one field (first match wins); unmatched fields stay `undefined`.

- [ ] Write the failing test: `guessMapping(['Full Name','E-Mail','Mobile','Notes'])` → `{ name:'Full Name', email:'E-Mail', phone:'Mobile', bio:'Notes' }`; `guessMapping(['col1','col2'])` → `{}`; ambiguous `['Name','Artist Name']` picks the first (`'Name'`) for `name` and does not overwrite.
- [ ] Run: `npx vitest run src/lib/artistImport/guessMapping.test.ts` `# (CI — not run locally)`. Expected: FAIL (module missing).
- [ ] Implement `guessMapping.ts` fully:
  ```ts
  export interface FieldMapping { name?: string; email?: string; phone?: string; bio?: string; }

  const RULES: { field: keyof FieldMapping; patterns: RegExp[] }[] = [
    { field: 'email', patterns: [/^e[-_ ]?mail$/, /mail/] },
    { field: 'phone', patterns: [/^phone$/, /^tel$/, /mobile/, /cell/, /phone/] },
    { field: 'name',  patterns: [/^full[-_ ]?name$/, /^artist([-_ ]?name)?$/, /^name$/, /name/] },
    { field: 'bio',   patterns: [/^bio$/, /notes?/, /about/, /description/] },
  ];

  const norm = (h: string) => h.trim().toLowerCase();

  export function guessMapping(headers: string[]): FieldMapping {
    const mapping: FieldMapping = {};
    const claimed = new Set<string>();
    for (const { field, patterns } of RULES) {
      if (mapping[field]) continue;
      const hit = headers.find((h) => !claimed.has(h) && patterns.some((p) => p.test(norm(h))));
      if (hit) { mapping[field] = hit; claimed.add(hit); }
    }
    return mapping;
  }
  ```
- [ ] Run: `npx vitest run src/lib/artistImport/guessMapping.test.ts` `# (CI — not run locally)`. Expected: PASS.
- [ ] Commit: `feat: add guessMapping fuzzy header matcher`.

---

### Task 4: Pure `buildImportRows` — normalize + validate + dedup

**Files:**
- Create: `src/lib/artistImport/buildImportRows.ts`
- Test: `src/lib/artistImport/buildImportRows.test.ts`

**Interfaces:**
- Consumes: `FieldMapping` from `./guessMapping`.
- Produces:
  ```ts
  export type ImportRowStatus = 'new' | 'skipped_existing' | 'error';
  export interface ImportValues { name: string; email: string | null; phone: string | null; bio: string | null; }
  export interface ImportRow { index: number; values: ImportValues; status: ImportRowStatus; error?: string; }
  export const IMPORT_EMAIL_RE: RegExp;
  export function buildImportRows(
    rows: Record<string, string>[],
    mapping: FieldMapping,
    existingEmails: Iterable<string>,   // any casing; normalized internally to lower()
  ): ImportRow[];
  ```
  Rules per row (index = source row index): map cells via `mapping`; empty strings → `null` for email/phone/bio; `name` empty → `status:'error', error:'Name is required'`; email present but not `IMPORT_EMAIL_RE` → `status:'error', error:'Invalid email'`; email present + `lower(email)` in `existingEmails` set → `status:'skipped_existing'`; otherwise `status:'new'`. No-email rows are always `'new'` (never dedup'd). Name-error precedence over email-error.

- [ ] Write the failing test covering: valid new row; missing-name → `error` "Name is required"; malformed email → `error` "Invalid email"; email matching an existing (mixed-case) email → `skipped_existing`; no-email row → `new`; empty phone/bio coerced to `null`. Include a row whose email is `'Ada@X.com'` against `existingEmails: ['ada@x.com']` → `skipped_existing` (case-insensitive).
- [ ] Run: `npx vitest run src/lib/artistImport/buildImportRows.test.ts` `# (CI — not run locally)`. Expected: FAIL (module missing).
- [ ] Implement `buildImportRows.ts` fully:
  ```ts
  import type { FieldMapping } from './guessMapping';

  export type ImportRowStatus = 'new' | 'skipped_existing' | 'error';
  export interface ImportValues { name: string; email: string | null; phone: string | null; bio: string | null; }
  export interface ImportRow { index: number; values: ImportValues; status: ImportRowStatus; error?: string; }

  export const IMPORT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const cell = (row: Record<string, string>, col?: string): string => (col ? (row[col] ?? '').trim() : '');
  const orNull = (s: string): string | null => (s === '' ? null : s);

  export function buildImportRows(
    rows: Record<string, string>[],
    mapping: FieldMapping,
    existingEmails: Iterable<string>,
  ): ImportRow[] {
    const existing = new Set<string>();
    for (const e of existingEmails) existing.add(e.trim().toLowerCase());

    return rows.map((row, index) => {
      const name = cell(row, mapping.name);
      const email = cell(row, mapping.email);
      const values: ImportValues = {
        name,
        email: orNull(email),
        phone: orNull(cell(row, mapping.phone)),
        bio: orNull(cell(row, mapping.bio)),
      };
      if (name === '') return { index, values, status: 'error', error: 'Name is required' };
      if (email !== '' && !IMPORT_EMAIL_RE.test(email)) {
        return { index, values, status: 'error', error: 'Invalid email' };
      }
      if (email !== '' && existing.has(email.toLowerCase())) {
        return { index, values, status: 'skipped_existing' };
      }
      return { index, values, status: 'new' };
    });
  }
  ```
- [ ] Run: `npx vitest run src/lib/artistImport/buildImportRows.test.ts` `# (CI — not run locally)`. Expected: PASS.
- [ ] Commit: `feat: add buildImportRows normalizer with dedup + validation`.

---

### Task 5: Migration + `bulk_import_artists` RPC (+ pgTAP)

**Files:**
- Create (via MCP `apply_migration`, name `bulk_import_artists`): `supabase/migrations/<real-ts>_bulk_import_artists.sql`
- Create: `supabase/tests/rpc/bulk_import_artists.sql`
- Modify (after migration): `src/integrations/supabase/types.ts` (regenerate via MCP — do not hand-edit)

**Interfaces:**
- Produces (SQL):
  ```sql
  public.bulk_import_artists(p_org uuid, p_rows jsonb) returns jsonb
  ```
  `SECURITY DEFINER`, `set search_path = public`. `p_rows` = JSON array of `{ index:int, name:text, email:text|null, phone:text|null, bio:text|null }`. Behavior:
  - Guard: `if not (has_org_role(auth.uid(),p_org,'producer') or has_org_role(auth.uid(),p_org,'admin')) then raise exception ... errcode='42501'`.
  - For each element: skip (`status:'skipped_existing'`) when `email` is non-null and `lower(email)` already exists in `public.artists` for `p_org`; else insert `{ name, email, phone, bio, org_id:p_org, status:'active' }` and return `status:'created', artist_id`. Rows with blank name → `status:'error', error:'Name is required'` (defense-in-depth; client pre-filters).
  - Returns `jsonb` array of `{ index, status:'created'|'skipped_existing'|'error', artist_id?, error? }` (order preserved).
  - Runs in the function's implicit transaction (atomic). `revoke all ... from public, anon; grant execute ... to authenticated`.

- [ ] Write the failing pgTAP test `supabase/tests/rpc/bulk_import_artists.sql` (mirror `list_org_members.sql`: `BEGIN; plan(N); session_replication_role=replica` seeding; `set_config('request.jwt.claims', ...)`; `SET LOCAL ROLE authenticated`). Cases:
  1. Producer of the org → RPC returns `created` for a new row; a matching `public.artists` row exists with `status='active'` and `org_id=p_org`.
  2. Artist (non-producer/admin) of the org → RPC raises `42501` (use `throws_ok`/`throws_like`).
  3. Cross-org: caller is producer of org A, `p_org` = org B → raises `42501`.
  4. Dedup: seed an artist `ada@x.com`; import `{email:'Ada@X.com'}` → result element `skipped_existing`, no second insert.
  5. Result jsonb shape: element carries `index` + `status` (+ `artist_id` on create).
- [ ] Run: `supabase test db` `# (CI — not run locally)`. Expected: FAIL (function missing).
- [ ] Apply the migration via MCP `apply_migration` with version name `bulk_import_artists` and this body:
  ```sql
  create or replace function public.bulk_import_artists(p_org uuid, p_rows jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_uid uuid := auth.uid();
    v_row jsonb;
    v_index int;
    v_name text;
    v_email text;
    v_phone text;
    v_bio text;
    v_new_id uuid;
    v_results jsonb := '[]'::jsonb;
  begin
    if not (public.has_org_role(v_uid, p_org, 'producer')
            or public.has_org_role(v_uid, p_org, 'admin')) then
      raise exception 'Forbidden: producer or admin only' using errcode = '42501';
    end if;

    for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
    loop
      v_index := coalesce((v_row->>'index')::int, 0);
      v_name  := nullif(btrim(coalesce(v_row->>'name', '')), '');
      v_email := nullif(btrim(coalesce(v_row->>'email', '')), '');
      v_phone := nullif(btrim(coalesce(v_row->>'phone', '')), '');
      v_bio   := nullif(btrim(coalesce(v_row->>'bio', '')), '');

      if v_name is null then
        v_results := v_results || jsonb_build_object('index', v_index, 'status', 'error', 'error', 'Name is required');
        continue;
      end if;

      if v_email is not null and exists (
        select 1 from public.artists a
        where a.org_id = p_org and lower(a.email) = lower(v_email)
      ) then
        v_results := v_results || jsonb_build_object('index', v_index, 'status', 'skipped_existing');
        continue;
      end if;

      insert into public.artists (name, email, phone, bio, org_id, status)
      values (v_name, v_email, v_phone, v_bio, p_org, 'active')
      returning id into v_new_id;

      v_results := v_results || jsonb_build_object('index', v_index, 'status', 'created', 'artist_id', v_new_id);
    end loop;

    return v_results;
  end;
  $$;

  revoke all on function public.bulk_import_artists(uuid, jsonb) from public, anon;
  grant execute on function public.bulk_import_artists(uuid, jsonb) to authenticated;
  ```
- [ ] Regenerate DB types via MCP `generate_typescript_types` and write the result to `src/integrations/supabase/types.ts` (so `rpc('bulk_import_artists', ...)` is typed). Do not hand-edit.
- [ ] Run: `supabase test db` `# (CI — not run locally)`. Expected: PASS (all 5 cases).
- [ ] Commit: `feat: add bulk_import_artists rpc with role guard + dedup`.

---

### Task 6: `fetch-remote-sheet` edge function (SSRF-guarded proxy)

**Files:**
- Create: `supabase/functions/fetch-remote-sheet/index.ts`
- Test: `supabase/functions/fetch-remote-sheet/index.di.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `preflight`, `json` from `_shared/http.ts`; `requireOrgRole` from `_shared/auth.ts`; `realDeps`/`Deps` from `_shared/deps.ts`; `deps.fetch` for the outbound request (mockable).
- Produces:
  ```ts
  export async function handle(req: Request, deps: Deps): Promise<Response>;
  // POST body: { org_id: string; url: string }
  // 200 → { csv: string }
  // 400 → { error } (bad payload / disallowed host / non-CSV shape)
  // 401/403 → auth (requireOrgRole producer+admin)
  // 502 → { error } (upstream fetch failed / too large / timed out)
  ```
  **SSRF guard:** allow only `https://docs.google.com/spreadsheets/d/.../export?format=csv...` (host === `docs.google.com`, pathname starts `/spreadsheets/`, query `format` is `csv`); reject anything else `400`. Outbound `deps.fetch` with `redirect: 'manual'` (a 3xx → `400 'Redirects are not allowed'`), an `AbortController` timeout (~8s), and a response-size cap (~5 MB — read the stream and abort past the cap). Return only `{ csv }` text.

- [ ] Write the failing DI test `index.di.test.ts` (mirror `create-invitation/index.di.test.ts`: `makeFakeDeps`, `makeRequest`, seed `org_memberships` role, pass `fetchImpl`). Cases:
  1. OPTIONS → preflight (200/204).
  2. No Bearer → 401.
  3. Non-`docs.google.com` URL (e.g. `https://evil.internal/x`) with a producer caller → **400** and `deps.fetch` **not** called (assert via a fetch stub that throws if invoked).
  4. Caller is `artist` role → 403.
  5. Producer + valid Google CSV URL, `fetchImpl` returns `new Response('name,email\nAda,ada@x.com', {status:200})` → 200 `{ csv }` echoing that text.
  6. Upstream returns a 302 (redirect) → 400 `/redirect/i`.
- [ ] Run: `deno test --allow-all --node-modules-dir=none supabase/functions/fetch-remote-sheet/` `# (runs locally)`. Expected: FAIL (module missing).
- [ ] Implement `index.ts` fully:
  ```ts
  import { preflight, json } from "../_shared/http.ts";
  import { requireOrgRole } from "../_shared/auth.ts";
  import { realDeps, type Deps } from "../_shared/deps.ts";

  type Body = { org_id: string; url: string };
  const MAX_BYTES = 5 * 1024 * 1024;
  const TIMEOUT_MS = 8000;

  function isAllowedSheetUrl(raw: string): boolean {
    let u: URL;
    try { u = new URL(raw); } catch { return false; }
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

      const auth = await requireOrgRole(deps, req, body.org_id, ["producer", "admin"]);
      if (!auth.ok) return auth.response;

      if (!isAllowedSheetUrl(body.url)) {
        return json({ error: "Only public Google Sheets CSV links are allowed" }, 400);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await deps.fetch(body.url, { redirect: "manual", signal: controller.signal });
      } catch (_e) {
        clearTimeout(timer);
        return json({ error: "Could not fetch the sheet" }, 502);
      }
      clearTimeout(timer);

      if (res.status >= 300 && res.status < 400) {
        return json({ error: "Redirects are not allowed" }, 400);
      }
      if (!res.ok) return json({ error: "The sheet was not reachable (is it published to the web?)" }, 502);

      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) return json({ error: "Sheet is too large" }, 502);
      const csv = new TextDecoder().decode(buf);
      return json({ csv }, 200);
    } catch (e) {
      console.error("fetch-remote-sheet error", e);
      return json({ error: (e as Error).message }, 500);
    }
  }

  if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
  ```
- [ ] Add the config block to `supabase/config.toml` (alpha-ordered near the other `[functions.*]` blocks):
  ```toml
  [functions.fetch-remote-sheet]
  verify_jwt = true
  ```
- [ ] Run: `deno test --allow-all --node-modules-dir=none supabase/functions/fetch-remote-sheet/` `# (runs locally)`. Expected: PASS (all 6 cases).
- [ ] Run the whole edge suite (catches shared-module regressions): `deno test --allow-all --node-modules-dir=none supabase/functions/` `# (runs locally)`. Expected: PASS.
- [ ] Commit: `feat: add fetch-remote-sheet ssrf-guarded proxy`.

---

### Task 7: Data-access — `bulkImportArtists` + `fetchPublicSheetCsv`

**Files:**
- Create: `src/data/artistImport.ts`, `src/data/remoteSheet.ts`
- Test: `src/data/artistImport.test.ts`, `src/data/remoteSheet.test.ts`

**Interfaces:**
- Consumes: `ImportValues` from `@/lib/artistImport/buildImportRows`; `SupabaseClient<Database>`.
- Produces:
  ```ts
  // src/data/artistImport.ts
  export interface BulkImportRowInput { index: number; name: string; email: string | null; phone: string | null; bio: string | null; }
  export interface BulkImportResult { index: number; status: 'created' | 'skipped_existing' | 'error'; artist_id?: string; error?: string; }
  export async function bulkImportArtists(
    client: SupabaseClient<Database>,
    args: { orgId: string; rows: BulkImportRowInput[] },
  ): Promise<BulkImportResult[]>;   // rpc('bulk_import_artists', { p_org, p_rows })

  // src/data/remoteSheet.ts
  export async function fetchPublicSheetCsv(
    client: SupabaseClient<Database>,
    url: string,
    orgId: string,
  ): Promise<string>;   // functions.invoke('fetch-remote-sheet', { body:{ org_id, url } }) → { csv }
  ```

- [ ] Write failing `artistImport.test.ts` (mirror `account.test.ts`): seed `{ 'rpc:bulk_import_artists': { data: [{index:0,status:'created',artist_id:'a1'}], error:null } }`; assert `bulkImportArtists(fake, {orgId:'org-1', rows:[...]})` returns that array and `fake.calls` contains `{ table:'rpc:bulk_import_artists', method:'rpc', args:[{ p_org:'org-1', p_rows:[...] }] }`. Add an error case (`error` set → throws).
- [ ] Write failing `remoteSheet.test.ts`: seed `{ 'fn:fetch-remote-sheet': { data:{ csv:'name,email\nAda,ada@x.com' }, error:null } }`; assert `fetchPublicSheetCsv(fake, url, 'org-1')` returns the csv string and records `{ table:'fn:fetch-remote-sheet', method:'invoke', args:[{ org_id:'org-1', url }] }`. Add an error-payload case (`{ error:'...' }` in data → throws).
- [ ] Run: `npx vitest run src/data/artistImport.test.ts src/data/remoteSheet.test.ts` `# (CI — not run locally)`. Expected: FAIL (modules missing).
- [ ] Implement `src/data/artistImport.ts`:
  ```ts
  import type { SupabaseClient } from "@supabase/supabase-js";
  import type { Database } from "@/integrations/supabase/types";

  export interface BulkImportRowInput { index: number; name: string; email: string | null; phone: string | null; bio: string | null; }
  export interface BulkImportResult { index: number; status: 'created' | 'skipped_existing' | 'error'; artist_id?: string; error?: string; }

  export async function bulkImportArtists(
    client: SupabaseClient<Database>,
    args: { orgId: string; rows: BulkImportRowInput[] },
  ): Promise<BulkImportResult[]> {
    const { data, error } = await client.rpc("bulk_import_artists", { p_org: args.orgId, p_rows: args.rows });
    if (error) throw error;
    return (data ?? []) as unknown as BulkImportResult[];
  }
  ```
- [ ] Implement `src/data/remoteSheet.ts`:
  ```ts
  import type { SupabaseClient } from "@supabase/supabase-js";
  import type { Database } from "@/integrations/supabase/types";

  export async function fetchPublicSheetCsv(
    client: SupabaseClient<Database>,
    url: string,
    orgId: string,
  ): Promise<string> {
    const { data, error } = await client.functions.invoke("fetch-remote-sheet", { body: { org_id: orgId, url } });
    if (error) throw error;
    const payload = data as { error?: string; csv?: string };
    if (payload?.error) throw new Error(payload.error);
    if (typeof payload?.csv !== "string") throw new Error("The sheet could not be read");
    return payload.csv;
  }
  ```
- [ ] Run: `npx vitest run src/data/artistImport.test.ts src/data/remoteSheet.test.ts` `# (CI — not run locally)`. Expected: PASS.
- [ ] Commit: `feat: add bulkImportArtists + fetchPublicSheetCsv data access`.

---

### Task 8: `ArtistImportDialog` — the 4-step wizard shell

**Files:**
- Create: `src/components/artists/ArtistImportDialog.tsx`
- Test: `src/components/artists/ArtistImportDialog.test.tsx`
- (Reference only) shadcn primitives: `Dialog`, `Command`, `Table`, `Badge`, `Progress`, `Checkbox`, `Button`, `Input`.

**Interfaces:**
- Consumes: `parseSheet`/`MAX_IMPORT_ROWS`, `guessMapping`/`FieldMapping`, `buildImportRows`/`ImportRow` (pure libs); `bulkImportArtists` (`@/data/artistImport`), `fetchPublicSheetCsv` (`@/data/remoteSheet`); Spec-A `inviteArtistToApp` (`@/data/invitations`) + query key `['artists','pending-invites', orgId]`; `useAuth().currentOrg`; `@tanstack/react-query` `useQueryClient`; `@/hooks/use-toast`.
- Produces:
  ```ts
  export interface ArtistImportDialogProps { open: boolean; onOpenChange: (open: boolean) => void; orgId: string; existingEmails: string[]; }
  export function ArtistImportDialog(props: ArtistImportDialogProps): JSX.Element;
  ```
  Internal `step: 'source' | 'map' | 'review' | 'done'` state machine; parsed sheet + mapping + rows in component state (no side effects until commit). All parse/map/dedup logic is delegated to the pure libs — the component only orchestrates.

**Sub-steps (implement + test incrementally; write each failing test first, then the minimal shell for it):**

- [ ] **8A Source step — file parse.** Test: render with `open`; simulate a `.csv` File drop/select → after parse, the dialog shows the detected filename + row count and a "Continue" enabled. Implement a dropzone + hidden `<input type=file>`; on `.csv` read `text()` → `parseSheet(text,'csv')`; on `.xlsx` read `arrayBuffer()` → `parseSheet(buf,'xlsx')` (dynamic xlsx via `parseSheet`); store `{ headers, rows }`; over `MAX_IMPORT_ROWS` → toast error, stay on step.
- [ ] Run: `npx vitest run src/components/artists/ArtistImportDialog.test.tsx` `# (CI — not run locally)`. Expected: FAIL → then PASS for 8A before moving on.
- [ ] **8B Source step — paste link + template.** Test: type a Google Sheets URL + click "Fetch" → calls `fetchPublicSheetCsv` (inject a fake/mocked data fn or seed via a passed client) → parses returned CSV → advances readiness. Add a "Download template" button that triggers a CSV blob download with headers `name,email,phone,bio` (assert the anchor `download` attribute / that a Blob URL is created). Implement paste field + fetch handler + template generator.
- [ ] **8C Map step — auto-match + searchable pickers + samples + Name gate.** Test: given headers `['Full Name','E-Mail','Tel','Notes']`, entering the Map step pre-selects via `guessMapping` (Name←Full Name etc.); each target field renders a `Command` search select of source columns + an "Ignore" option + first-3 sample values; the "Continue" button is disabled until `mapping.name` is set (clear Name → disabled). Implement the mapping UI as a thin controller over `guessMapping` + local `FieldMapping` state; compute samples from `rows.slice(0,3)`.
- [ ] **8D Review step — build rows + summary + filters + search + select.** Test: with a mapping + `existingEmails`, entering Review calls `buildImportRows` and renders summary cards (to import / duplicate / needs attention counts), filter chips (All/New/Skipped/Errors), a search box, and a `Table` with per-row checkboxes; `new` rows checked by default, `skipped_existing`/`error` unchecked + de-emphasized with the reason; select-all toggles only selectable (`new`) rows; searching filters the visible rows. Implement Review as a pure render over `buildImportRows(rows, mapping, existingEmails)` + local `Set<number>` selection.
- [ ] **8E Review step — optional invite checkbox (Spec A).** Test: an "Also send login invites" `Checkbox` renders; it is disabled/hidden when Spec A is unavailable (guard behind a `canInvite` prop or a feature check) and, when enabled, only affects selected rows that carry an email. Implement the checkbox + `inviteSelected` state; the label clarifies "only rows with an email".
- [ ] **8F Commit → Done.** Test: clicking "Import N artists" calls `bulkImportArtists(client, { orgId, rows: selectedNewRows })` (assert args = the selected `new` rows mapped to `BulkImportRowInput`), then renders the Done step with a result summary (created / skipped / errors from the RPC result) + "View artists" / "Send invites" actions; on success it invalidates `['artists']`. Use a `useMutation`; show a `Progress`/spinner while pending.
- [ ] **8G Stale-preview reconciliation.** Test: RPC result marks a row `skipped_existing` that the preview showed as `new` → the Done summary counts it under skipped (server is authoritative). Implement: derive Done counts from the **RPC result**, not the preview.
- [ ] **8H Invite-on-import loop (Spec A, optional).** Test: with the invite checkbox on, after the RPC returns `created` `artist_id`s that have emails, the component loops `inviteArtistToApp(client, { orgId, artistId, email })` for each (assert call count + args) with a progress toast, then invalidates `['artists','pending-invites', orgId]`. Per-invite failure → per-row toast, imported artists unaffected. Implement the sequential loop guarded by the checkbox; skip rows without email.
- [ ] Run the full component suite: `npx vitest run src/components/artists/ArtistImportDialog.test.tsx` `# (CI — not run locally)`. Expected: PASS (8A–8H).
- [ ] Commit: `feat: add ArtistImportDialog 4-step import wizard`.

---

### Task 9: Wire "Import from sheet" into ArtistsPage

**Files:**
- Modify: `src/pages/ArtistsPage.tsx`
- Test: extend `src/pages/ArtistsPage.test.tsx` (create if absent) or add to the component test.

**Interfaces:**
- Consumes: `ArtistImportDialog` (Task 8); `useAuth().hasRole` (`'producer' | 'admin'`), `currentOrg`; the existing `['artists']` query (source of `existingEmails`).

- [ ] Write the failing test: rendering `ArtistsPage` as a **producer** shows an "Import from sheet" button (but NOT "Add Artist", which stays admin-only); as an **artist** it shows neither; clicking "Import from sheet" opens `ArtistImportDialog`. (Use `renderWithProviders` + a mocked `useAuth`, following existing page-test conventions.)
- [ ] Run: `npx vitest run src/pages/ArtistsPage.test.tsx` `# (CI — not run locally)`. Expected: FAIL.
- [ ] Implement in `ArtistsPage.tsx`: add `const [importOpen, setImportOpen] = useState(false);`; in the header actions render, when `hasRole('producer') || hasRole('admin')`, a secondary `Button` "Import from sheet" beside the admin-only "Add Artist"; derive `existingEmails = (artists ?? []).map(a => a.email).filter(Boolean)`; render `<ArtistImportDialog open={importOpen} onOpenChange={setImportOpen} orgId={currentOrg!.id} existingEmails={existingEmails} />`. Keep semantic tokens; do not alter the admin-only gate on "Add Artist".
- [ ] Run: `npx vitest run src/pages/ArtistsPage.test.tsx` `# (CI — not run locally)`. Expected: PASS.
- [ ] Commit: `feat: add import-from-sheet entry to artists page`.

---

### Task 10: Docs — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none (documentation).

- [ ] In the edge-functions list (the "Airtable sync" / categories block), add `fetch-remote-sheet` under a suitable category (e.g. "Import: `fetch-remote-sheet` — SSRF-guarded proxy that fetches a public Google Sheets CSV for the bulk artist import; `requireOrgRole(org_id, ['producer','admin'])`").
- [ ] In the RPC references, add `bulk_import_artists(p_org, p_rows)` — "producer/admin-guarded `SECURITY DEFINER` bulk artist insert with server-side dedup on `lower(email)`".
- [ ] Commit: `docs: note fetch-remote-sheet fn + bulk_import_artists rpc`.

---

### Task 11: Versioning + changelog

**Files:**
- Modify: `package.json`, `src/config/app.config.ts`, `public/changelog.md`, `public/changelog.json` (regenerated)

**Interfaces:** none.

- [ ] Decide the version. Current is `1.6.0`. This is a user-facing feature → **MINOR** bump to `1.7.0`. **If Spec A is landing in the same release, use ONE combined `v1.7.0`** covering both specs (do not double-bump). Set `version` in `package.json` and `APP_META.VERSION` in `src/config/app.config.ts` to `1.7.0`.
- [ ] Add a newest-first block to `public/changelog.md`:
  ```
  ## 1.7.0 — Jul 1, 2026
  *Faster artist onboarding*

  ### New
  - **Bulk import artists** — Import your roster from a CSV or Excel file, or paste a public Google Sheets link. Map columns, review and dedupe, then add everyone at once. Optionally send login invites to imported artists in the same step.
  ```
  (If combined with Spec A, merge A's bullets into the same block rather than adding a second one.)
- [ ] Regenerate the JSON: `deno run --allow-read --allow-write scripts/changelog-to-json.ts` `# (runs locally — Deno)`. Never hand-edit `public/changelog.json`.
- [ ] Commit: `chore: bump to 1.7.0 + changelog for artist bulk import`.

---

## Self-Review

**Spec coverage (design §A–J):**
- §A entry point & producer+admin gating → Task 9 (UI) + Tasks 5/6 (server-side gate). ✅
- §B ingestion (file + paste link + template + caps) → Task 2 (`parseSheet`, `MAX_IMPORT_ROWS`) + Task 8A/8B. ✅
- §C `fetch-remote-sheet` SSRF proxy (allowlist, no redirects, size/timeout, role gate) → Task 6 (+ config.toml block). ✅
- §D wizard state machine (no side effects until commit) → Task 8 (`step` machine; commit only in 8F). ✅
- §E map step (auto-match, searchable, samples, Name-required gate) → Task 3 (`guessMapping`) + Task 8C. ✅
- §F review step (status, summary cards, filter chips, search, multi-select, partial import) → Task 4 (`buildImportRows`) + Task 8D. ✅
- §G commit RPC (`SECURITY DEFINER`, role guard, server dedup, `status='active'`+`org_id`, per-row jsonb, grants) → Task 5. ✅
- §H invite-on-import (Spec A) → Task 8E/8H. ✅
- §I module decomposition (pure libs + data access + proxy + migration + thin dialog) → Tasks 2–8 map 1:1 to the listed files. ✅
- §J testing (unit/pgTAP/Deno, whole-suite run) → tests co-located in every task; whole `supabase/functions/` run in Task 6. ✅
- Versioning (§Versioning) → Task 11. ✅

**No placeholders:** every code step contains complete, runnable code — `parseSheet`, `guessMapping`, `buildImportRows`, the `bulk_import_artists` SQL body, the `fetch-remote-sheet` handler, both data-access functions, and the ArtistsPage wiring are all fully written. The wizard component (Task 8) is decomposed into concrete sub-steps with named props/state; each sub-step is a bite-sized test-then-implement pair. ✅

**Type/signature consistency:**
- `ImportRow.values: ImportValues` (Task 4) → mapped to `BulkImportRowInput` (Task 7) → serialized to `p_rows` jsonb whose element keys (`index,name,email,phone,bio`) exactly match what the RPC reads via `v_row->>'...'` (Task 5). ✅
- `BulkImportResult` (`created|skipped_existing|error`, optional `artist_id`/`error`) matches the RPC's `jsonb_build_object` output keys and the wizard's Done-summary consumer (Task 8F/8G). ✅
- `fetchPublicSheetCsv` returns `{ csv }`, which is exactly the proxy's 200 body (Task 6 ↔ Task 7). ✅
- **Consumed Spec-A interfaces referenced verbatim, not redefined:** `inviteArtistToApp(client, { orgId, artistId, email })`, `fetchPendingInvitedArtistIds(client, orgId)`, key `['artists','pending-invites', orgId]`, and `create-invitation`'s optional `artist_id`. B only calls them in Task 8H (invalidate the pending-invites key) — no shadow definitions. ✅
- **House-pattern correction applied:** `has_org_role` has no array overload; the RPC guard is written as an explicit `producer OR admin` OR-expression (see the note under Global Constraints and the Task 5 body). ✅

**Fixes applied inline:** (1) role guard rewritten to two `has_org_role` calls after verifying the SQL helper signature; (2) `existingEmails` typed as `Iterable<string>` in `buildImportRows` and normalized internally, so the page can pass a raw `string[]` from the `['artists']` query; (3) XLSX fixture stored as base64 to keep the repo binary-free and the test deterministic.
