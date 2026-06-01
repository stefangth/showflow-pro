import type { Deps, EmailMessage, InvokeResult } from "./deps.ts";

export interface RecordedCall { table: string; method: string; args: unknown[]; }
export interface FakeClientOptions {
  tables?: Record<string, { data?: unknown; error?: unknown }>;
  rpcs?: Record<string, { data?: unknown; error?: unknown }>;
  authUser?: { id: string } | null;
  claims?: { sub: string } | null;
  usersById?: Record<string, { email?: string }>;
}

const CHAIN = [
  "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "or", "not", "match",
  "order", "limit", "range", "filter",
];

// deno-lint-ignore no-explicit-any
type AnyChain = Record<string, any>;

/** A call-recording stand-in for a Supabase client (admin or user). */
export function createFakeClient(opts: FakeClientOptions = {}) {
  const calls: RecordedCall[] = [];
  const tables = opts.tables ?? {};
  const rpcs = opts.rpcs ?? {};

  function builder(table: string): AnyChain {
    const result = tables[table] ?? { data: [], error: null };
    const chain: AnyChain = {};
    for (const m of CHAIN) {
      chain[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return chain; };
    }
    for (const m of ["single", "maybeSingle"]) {
      chain[m] = () => { calls.push({ table, method: m, args: [] }); return Promise.resolve(result); };
    }
    chain.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(f, r);
    return chain;
  }

  const client = {
    from(table: string) { calls.push({ table, method: "from", args: [] }); return builder(table); },
    rpc(name: string, params?: unknown) {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [params] });
      return Promise.resolve(rpcs[name] ?? { data: null, error: null });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: opts.authUser ?? null }, error: null }),
      getClaims: (_token?: string) => Promise.resolve({ data: opts.claims ? { claims: opts.claims } : null, error: null }),
      admin: {
        getUserById: (id: string) =>
          Promise.resolve({ data: { user: opts.usersById?.[id] ? { id, ...opts.usersById[id] } : null }, error: null }),
        listUsers: () =>
          Promise.resolve({ data: { users: Object.entries(opts.usersById ?? {}).map(([id, u]) => ({ id, ...u })) }, error: null }),
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
