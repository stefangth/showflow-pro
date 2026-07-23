import type { Deps, EmailMessage, InvokeResult, TypedClient } from "./deps.ts";

/** The single sanctioned cast from a fake client to the typed client. */
export function asTypedClient(fake: unknown): TypedClient {
  return fake as TypedClient;
}

/** Bind the fake client's untyped `from` so tests can wrap/instrument it.
 *  The typed client's `from` only accepts known table-name literals; the fake
 *  underneath takes any string, which is what instrumentation needs. */
export function bindFakeFrom(client: unknown): (table: string) => FakeChain {
  const c = client as { from: (table: string) => FakeChain };
  return c.from.bind(c);
}

/** Install a replacement `from` on a fake client sitting behind the typed
 *  facade — the write-side counterpart to `bindFakeFrom`. Tests use it to wrap
 *  the original `from` and instrument specific tables; the single sanctioned
 *  cast lives here, never at the call site. */
export function setFakeFrom(client: unknown, from: (table: string) => unknown): void {
  (client as { from: (table: string) => unknown }).from = from;
}

export interface RecordedCall { table: string; method: string; args: unknown[]; }

/** A single seed: the result returned for every query to a table (backward-compatible form).
 *  `count` is optional and models the `{ count: N }` shape returned by Supabase for
 *  `select("*", { count: "exact", head: true })` queries. Without it, handlers that
 *  destructure `{ count }` would receive `undefined` (BUG-001 fix). */
export type SingleSeed = { data?: unknown; error?: unknown; count?: number };

/** One entry in an array seed — `when` is matched against recorded eq() args. */
export type ArraySeedEntry = { when?: Record<string, unknown>; data?: unknown; error?: unknown };

/** Per-table seed: either a single result object or a match-based array. */
export type TableSeed = SingleSeed | ArraySeedEntry[];

export interface FakeClientOptions {
  tables?: Record<string, TableSeed>;
  rpcs?: Record<string, { data?: unknown; error?: unknown }>;
  authUser?: { id: string } | null;
  claims?: { sub: string } | null;
  usersById?: Record<string, { email?: string }>;
  /** Seeded result for auth.admin.inviteUserByEmail (default: a new user). */
  inviteResult?: { data?: unknown; error?: unknown };
  /** Seeded result for auth.admin.generateLink (default: an invite action link). */
  generateLinkResult?: { data?: unknown; error?: unknown };
  /** Seeded result for auth.admin.deleteUser (default: success). */
  deleteUserResult?: { data?: unknown; error?: unknown };
  /** Seeded result for storage.from(bucket).upload(...) (default: success). */
  storageUploadResult?: { data?: unknown; error?: unknown };
  /** Seeded result for storage.from(bucket).createSignedUrl(...) (default: a signed URL). */
  storageSignedUrlResult?: { data?: unknown; error?: unknown };
  /**
   * Seeded auth-user roster for admin.auth.admin.listUsers() (default: derived from
   * usersById, unchanged). When provided, listUsers() returns exactly this roster —
   * each entry defaulted with sane fields for any key left unset — instead of the
   * usersById-derived shape. Used by cross-org roster handlers (e.g. platform-list-users)
   * that need created_at/last_sign_in_at/banned_until on the fake auth user, which
   * usersById (keyed by id, `{ email? }`-shaped) does not model.
   */
  authUsers?: Array<{
    id: string;
    email?: string | null;
    created_at?: string;
    last_sign_in_at?: string | null;
    banned_until?: string | null;
  }>;
  /**
   * Seeded lookup backing `admin.rpc('get_user_id_by_email', { p_email })` — maps a
   * (lowercased) email to the auth user id that owns it. Used by platform-manage-user's
   * duplicate-email check. An explicit `rpcs.get_user_id_by_email` seed still wins if a
   * test provides both (checked first in `rpc()` below).
   */
  authUsersByEmail?: Record<string, { id: string }>;
  /** Seeded result for auth.admin.updateUserById (default: success). */
  updateUserByIdResult?: { data?: unknown; error?: unknown };
}

const CHAIN = [
  "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "or", "not", "match",
  "order", "limit", "range", "filter",
];

/** Result shape every fake query resolves to. */
export type FakeResult = { data: unknown; error: unknown; count?: number };
type ChainFn = (...args: unknown[]) => FakeChain;
/** Chainable query builder: every chain method returns the same builder, the
 *  terminals (`single`/`maybeSingle`) and `await` resolve the seeded result.
 *  Built on a plain `Record<string, unknown>` and cast out once (same pattern
 *  as `src/test/supabaseFake.ts`). */
export interface FakeChain extends PromiseLike<FakeResult> {
  select: ChainFn; insert: ChainFn; update: ChainFn; upsert: ChainFn; delete: ChainFn;
  eq: ChainFn; neq: ChainFn; gt: ChainFn; gte: ChainFn; lt: ChainFn; lte: ChainFn;
  in: ChainFn; is: ChainFn; or: ChainFn; not: ChainFn; match: ChainFn;
  order: ChainFn; limit: ChainFn; range: ChainFn; filter: ChainFn;
  single: () => Promise<FakeResult>;
  maybeSingle: () => Promise<FakeResult>;
}

/** Resolve the result for a table seed given a local eq map and in-filter map. */
function resolveSeed(
  seed: TableSeed,
  localEq: Record<string, unknown>,
  localIn: Record<string, unknown[]> = {},
): { data: unknown; error: unknown; count?: number } {
  if (Array.isArray(seed)) {
    // Find first entry whose every `when` key/value matches localEq
    const matched = seed.find((entry) =>
      entry.when !== undefined &&
      Object.entries(entry.when).every(([k, v]) => localEq[k] === v)
    );
    if (matched) {
      return { data: "data" in matched ? matched.data : [], error: matched.error ?? null };
    }
    // Fall back to first entry with no `when`
    const fallback = seed.find((entry) => entry.when === undefined);
    if (fallback) {
      return { data: "data" in fallback ? fallback.data : [], error: fallback.error ?? null };
    }
    return { data: [], error: null };
  }
  // Single-object seed (backward-compatible).
  // Apply in() filtering so that .in("role", ["admin"]) correctly excludes rows
  // where the field value is not in the allowed set.
  const { data, error, count } = seed as { data: unknown; error: unknown; count?: number };
  // Only include `count` in the result when explicitly set in the seed (omit the key
  // entirely when undefined so backward-compatible deep-equality checks stay green).
  const countField = count !== undefined ? { count } : {};
  if (data !== null && data !== undefined && Object.keys(localIn).length > 0) {
    const applyInFilter = (row: Record<string, unknown>): boolean =>
      Object.entries(localIn).every(([col, allowed]) => allowed.includes(row[col]));

    if (Array.isArray(data)) {
      // Filter the array and return only matching rows
      const filtered = (data as Record<string, unknown>[]).filter(applyInFilter);
      return { data: filtered.length > 0 ? filtered : null, error, ...countField };
    } else if (typeof data === "object") {
      // Single object: return null if it doesn't satisfy the in() constraint
      if (!applyInFilter(data as Record<string, unknown>)) {
        return { data: null, error, ...countField };
      }
    }
  }
  return { data, error, ...countField };
}

/**
 * Resolve the cron secret value a test seeded into the app_settings table, so the
 * Vault-backed `get_cron_secret` RPC can default to it when a test hasn't seeded the
 * RPC explicitly. Post-C1 the secret lives in Vault and is read via the RPC (not
 * app_settings), but the RPC returns the same value that used to live in app_settings —
 * so mirroring the seeded app_settings.cron_secret keeps existing cron-auth tests green
 * without touching every seed site. Tests that seed `rpcs.get_cron_secret` win over this.
 */
function seededCronSecret(tables: Record<string, TableSeed>): string | null {
  const seed = tables["app_settings"];
  if (!seed) return null;
  const readValue = (v: unknown): string | null => {
    if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
      const val = (v as { value?: unknown }).value;
      return typeof val === "string" ? val : null;
    }
    return null;
  };
  if (Array.isArray(seed)) {
    const entry = seed.find((e) => e.when?.key === "cron_secret");
    return entry ? readValue(entry.data) : null;
  }
  return readValue((seed as SingleSeed).data);
}

/** A call-recording stand-in for a Supabase client (admin or user). */
export function createFakeClient(opts: FakeClientOptions = {}) {
  const calls: RecordedCall[] = [];
  const tables = opts.tables ?? {};
  const rpcs = opts.rpcs ?? {};
  const fallbackCronSecret = seededCronSecret(tables);

  // Methods that make a chain a write — used only to populate the reserved `__write`
  // match key below, so a test CAN (opt-in, via `when: { ..., __write: true/false }`)
  // distinguish "the update-then-select on this table" from "the plain select on this
  // same table with the same eq filter" within a single handler invocation — e.g. a
  // blind `.update(...).eq('resend_id', x).select('id')` immediately followed by an
  // existence check `.select('id').eq('resend_id', x).maybeSingle()`. Existing seeds
  // never reference `__write` in their `when`, so this is fully backward-compatible.
  const WRITE_METHODS = new Set(["update", "insert", "upsert", "delete"]);

  function builder(table: string): FakeChain {
    const seed: TableSeed = tables[table] ?? { data: [], error: null };
    // Local eq map — populated as .eq() calls are chained, used for array-seed matching
    const localEq: Record<string, unknown> = {};
    // Local in map — populated as .in() calls are chained, used for membership filtering
    const localIn: Record<string, unknown[]> = {};
    let sawWrite = false;
    const chain: Record<string, unknown> = {};
    for (const m of CHAIN) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        // Track eq() args locally for match-based seed resolution
        if (m === "eq" && args.length >= 2) {
          localEq[String(args[0])] = args[1];
        }
        // Track in() args locally for membership filtering
        if (m === "in" && args.length >= 2 && Array.isArray(args[1])) {
          localIn[String(args[0])] = args[1] as unknown[];
        }
        if (WRITE_METHODS.has(m)) sawWrite = true;
        return chain;
      };
    }
    // Reserved `__in:<col>` match keys, opt-in, mirrors `__write` above. Some
    // handlers query the SAME table twice with different .in() filters and no
    // .eq() at all (e.g. cast_members: once for the tier's eligible casts, once
    // inside the eligibility gate for the gate's own cast set), with no .eq()
    // calls, localEq is identical for both reads, so `when` could not otherwise
    // tell them apart. A test can opt in with `when: { "__in:cast_id": JSON.stringify([...]) }`.
    // Existing seeds never reference an `__in:` key, so this is backward-compatible.
    const matchEq = () => {
      const inKeys: Record<string, string> = {};
      for (const [col, vals] of Object.entries(localIn)) {
        inKeys[`__in:${col}`] = JSON.stringify(vals);
      }
      return { ...localEq, ...inKeys, __write: sawWrite };
    };
    chain["single"] = () => {
      calls.push({ table, method: "single", args: [] });
      return Promise.resolve(resolveSeed(seed, matchEq(), localIn));
    };
    chain["maybeSingle"] = () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      const result = resolveSeed(seed, matchEq(), localIn);
      // Real Supabase .maybeSingle() returns null (never []) when there are no rows.
      // Normalise an empty-array result so that `if (row)` guards work correctly.
      const normalised = Array.isArray(result.data) && (result.data as unknown[]).length === 0
        ? { ...result, data: null }
        : result;
      return Promise.resolve(normalised);
    };
    // List queries resolved via .then() do NOT apply in() filtering — the seed data
    // is intentionally simplified and may omit the filtered column entirely.
    chain.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
      Promise.resolve(resolveSeed(seed, matchEq())).then(f, r);
    return chain as unknown as FakeChain;
  }

  const client = {
    from(table: string) { calls.push({ table, method: "from", args: [] }); return builder(table); },
    rpc(name: string, params?: unknown) {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [params] });
      if (name in rpcs) return Promise.resolve(rpcs[name]);
      // Default get_user_id_by_email to the seeded authUsersByEmail map (see
      // authUsersByEmail doc comment on FakeClientOptions above). An explicit `rpcs`
      // seed for this name already returned above, so this only fires when a test
      // relies on the dedicated option instead.
      if (name === "get_user_id_by_email" && opts.authUsersByEmail) {
        const email = (params as { p_email?: string } | undefined)?.p_email;
        const match = email ? opts.authUsersByEmail[email] : undefined;
        return Promise.resolve({ data: match?.id ?? null, error: null });
      }
      // Default get_cron_secret to the seeded app_settings.cron_secret (see seededCronSecret).
      if (name === "get_cron_secret" && fallbackCronSecret !== null) {
        return Promise.resolve({ data: fallbackCronSecret, error: null });
      }
      // Default every org to entitled for is_feature_enabled so the many existing
      // DI tests (booking-flow consumers etc.) that never seed this RPC keep their
      // pre-entitlements behavior. Tests exercising the gate itself override via
      // `rpcs: { is_feature_enabled: {...} }`.
      if (name === "is_feature_enabled") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: opts.authUser ?? null }, error: null }),
      getClaims: (_token?: string) => Promise.resolve({ data: opts.claims ? { claims: opts.claims } : null, error: null }),
      admin: {
        getUserById: (id: string) => {
          // Prefer the `authUsers` roster (carries created_at/last_sign_in_at/banned_until,
          // the shape platform-manage-user needs for its oldEmail lookup) when a test seeds
          // it; fall back to the pre-existing `usersById` shape unchanged otherwise.
          const found = opts.authUsers?.find((u) => u.id === id);
          if (found) {
            return Promise.resolve({
              data: {
                user: {
                  id: found.id,
                  email: found.email ?? null,
                  created_at: found.created_at ?? "2026-01-01T00:00:00.000Z",
                  last_sign_in_at: found.last_sign_in_at ?? null,
                  banned_until: found.banned_until ?? null,
                },
              },
              error: null,
            });
          }
          return Promise.resolve({ data: { user: opts.usersById?.[id] ? { id, ...opts.usersById[id] } : null }, error: null });
        },
        updateUserById: (id: string, attrs?: unknown) => {
          calls.push({ table: "auth.admin.updateUserById", method: "update", args: [id, attrs] });
          return Promise.resolve(opts.updateUserByIdResult ?? { data: { user: null }, error: null });
        },
        listUsers: (_params?: unknown) =>
          Promise.resolve({
            data: {
              users: opts.authUsers
                ? opts.authUsers.map((u) => ({
                  id: u.id,
                  email: u.email ?? null,
                  created_at: u.created_at ?? "2026-01-01T00:00:00.000Z",
                  last_sign_in_at: u.last_sign_in_at ?? null,
                  banned_until: u.banned_until ?? null,
                }))
                : Object.entries(opts.usersById ?? {}).map(([id, u]) => ({ id, ...u })),
            },
            error: null,
          }),
        inviteUserByEmail: (email: string, _opts?: unknown) =>
          Promise.resolve(opts.inviteResult ?? { data: { user: { id: "invited", email } }, error: null }),
        generateLink: (_params: unknown) =>
          Promise.resolve(opts.generateLinkResult ?? { data: { properties: { action_link: "https://link.test/invite" } }, error: null }),
        deleteUser: (_id: string) =>
          Promise.resolve(opts.deleteUserResult ?? { data: { user: null }, error: null }),
      },
    },
    functions: { invoke: (_n: string, _o: unknown) => Promise.resolve({ data: null, error: null }) },
    storage: {
      // Records upload/createSignedUrl into `calls` (table `storage:<bucket>`) so tests
      // can assert the object path a handler writes to / signs. Additive: pre-storage
      // callers never touch it.
      from(bucket: string) {
        return {
          upload: (path: string, body: unknown, uploadOpts?: unknown) => {
            calls.push({ table: `storage:${bucket}`, method: "upload", args: [path, body, uploadOpts] });
            return Promise.resolve(opts.storageUploadResult ?? { data: { path }, error: null });
          },
          createSignedUrl: (path: string, expiresIn: number) => {
            calls.push({ table: `storage:${bucket}`, method: "createSignedUrl", args: [path, expiresIn] });
            return Promise.resolve(
              opts.storageSignedUrlResult ??
                { data: { signedUrl: `https://signed.test/${bucket}/${path}` }, error: null },
            );
          },
        };
      },
    },
  };
  return { client, calls };
}

export interface FakeDepsOptions extends FakeClientOptions {
  envVars?: Record<string, string>;
  now?: Date;
  fetchImpl?: typeof fetch;
  /**
   * Result returned by `deps.sendEmail(...)` (and generic `invokeFunction`).
   * Defaults to a REAL send — `{ data: { success: true }, error: null }` — which is what
   * `send-transactional-email` returns on delivery, so digest handlers stamp as they would
   * in production. Override to model a failure (`{ error: {...} }`) or a legitimately-skipped
   * send (`{ data: { success: false, reason: 'email_suppressed' } }`) — in both cases the
   * digest handlers must NOT stamp (C4). See `emailWasSent` in deps.ts.
   */
  emailResult?: InvokeResult;
}

/** Build a fake Deps for handler tests. Records invokeFunction/sendEmail calls. */
export function makeFakeDeps(opts: FakeDepsOptions = {}) {
  const { client, calls } = createFakeClient(opts);
  const invokeCalls: Array<{ name: string; body: unknown }> = [];
  const env = opts.envVars ?? {};
  const fixedNow = opts.now ?? new Date("2026-06-01T12:00:00.000Z");
  const emailResult: InvokeResult = opts.emailResult ?? { data: { success: true }, error: null };

  const invokeFunction = (name: string, body: unknown): Promise<InvokeResult> => {
    invokeCalls.push({ name, body });
    return Promise.resolve(emailResult);
  };

  const deps: Deps = {
    admin: asTypedClient(client),
    userClient: () => asTypedClient(client),
    env: (k) => env[k],
    now: () => fixedNow,
    invokeFunction,
    sendEmail: (msg: EmailMessage) => invokeFunction("send-transactional-email", msg),
    // Stub the renderer as bytes starting with "%PDF" so handlers get a plausible
    // PDF without paying for a real react-pdf render (that is covered by render.test.ts).
    renderHireOrderPdf: () => Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    fetch: opts.fetchImpl ?? (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch,
  };
  return { deps, calls, invokeCalls, client };
}

/** Build a Request for handler tests. */
export function makeRequest(opts: { method?: string; headers?: Record<string, string>; body?: unknown; url?: string } = {}): Request {
  const { method = "POST", headers = {}, body, url = "http://localhost/fn" } = opts;
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
