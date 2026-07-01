import type { Deps, EmailMessage, InvokeResult } from "./deps.ts";

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
}

const CHAIN = [
  "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "or", "not", "match",
  "order", "limit", "range", "filter",
];

// deno-lint-ignore no-explicit-any
type AnyChain = Record<string, any>;

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

  function builder(table: string): AnyChain {
    const seed: TableSeed = tables[table] ?? { data: [], error: null };
    // Local eq map — populated as .eq() calls are chained, used for array-seed matching
    const localEq: Record<string, unknown> = {};
    // Local in map — populated as .in() calls are chained, used for membership filtering
    const localIn: Record<string, unknown[]> = {};
    const chain: AnyChain = {};
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
        return chain;
      };
    }
    chain["single"] = () => {
      calls.push({ table, method: "single", args: [] });
      return Promise.resolve(resolveSeed(seed, localEq, localIn));
    };
    chain["maybeSingle"] = () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      const result = resolveSeed(seed, localEq, localIn);
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
      Promise.resolve(resolveSeed(seed, localEq)).then(f, r);
    return chain;
  }

  const client = {
    from(table: string) { calls.push({ table, method: "from", args: [] }); return builder(table); },
    rpc(name: string, params?: unknown) {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [params] });
      if (name in rpcs) return Promise.resolve(rpcs[name]);
      // Default get_cron_secret to the seeded app_settings.cron_secret (see seededCronSecret).
      if (name === "get_cron_secret" && fallbackCronSecret !== null) {
        return Promise.resolve({ data: fallbackCronSecret, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: opts.authUser ?? null }, error: null }),
      getClaims: (_token?: string) => Promise.resolve({ data: opts.claims ? { claims: opts.claims } : null, error: null }),
      admin: {
        getUserById: (id: string) =>
          Promise.resolve({ data: { user: opts.usersById?.[id] ? { id, ...opts.usersById[id] } : null }, error: null }),
        listUsers: () =>
          Promise.resolve({ data: { users: Object.entries(opts.usersById ?? {}).map(([id, u]) => ({ id, ...u })) }, error: null }),
        inviteUserByEmail: (email: string, _opts?: unknown) =>
          Promise.resolve(opts.inviteResult ?? { data: { user: { id: "invited", email } }, error: null }),
        generateLink: (_params: unknown) =>
          Promise.resolve(opts.generateLinkResult ?? { data: { properties: { action_link: "https://link.test/invite" } }, error: null }),
        deleteUser: (_id: string) =>
          Promise.resolve(opts.deleteUserResult ?? { data: { user: null }, error: null }),
      },
    },
    functions: { invoke: (_n: string, _o: unknown) => Promise.resolve({ data: null, error: null }) },
  };
  return { client, calls };
}

export interface FakeDepsOptions extends FakeClientOptions {
  envVars?: Record<string, string>;
  now?: Date;
  fetchImpl?: typeof fetch;
}

/** Build a fake Deps for handler tests. Records invokeFunction/sendEmail calls. */
export function makeFakeDeps(opts: FakeDepsOptions = {}) {
  const { client, calls } = createFakeClient(opts);
  const invokeCalls: Array<{ name: string; body: unknown }> = [];
  const env = opts.envVars ?? {};
  const fixedNow = opts.now ?? new Date("2026-06-01T12:00:00.000Z");

  const invokeFunction = (name: string, body: unknown): Promise<InvokeResult> => {
    invokeCalls.push({ name, body });
    return Promise.resolve({ data: null, error: null });
  };

  const deps: Deps = {
    admin: client as unknown as Deps["admin"],
    userClient: () => client as unknown as Deps["admin"],
    env: (k) => env[k],
    now: () => fixedNow,
    invokeFunction,
    sendEmail: (msg: EmailMessage) => invokeFunction("send-transactional-email", msg),
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
