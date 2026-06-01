export interface FakeResult {
  data?: unknown;
  error?: unknown;
}
export interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Chainable query-builder methods that return `this` and record their call. */
const CHAIN_METHODS = [
  "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "or", "not", "match",
  "order", "limit", "range", "filter", "contains", "overlaps",
] as const;

/** Terminal methods that resolve to the seeded result. */
const TERMINAL_METHODS = ["single", "maybeSingle"] as const;

/**
 * A minimal, call-recording stand-in for the supabase-js client.
 * Seed is keyed by table name (or `rpc:<name>`) -> { data, error }.
 */
export function createFakeSupabase(seed: Record<string, FakeResult> = {}) {
  const calls: RecordedCall[] = [];

  function builder(table: string) {
    const result: FakeResult = seed[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};

    for (const m of CHAIN_METHODS) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return chain;
      };
    }
    for (const m of TERMINAL_METHODS) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return Promise.resolve(result);
      };
    }
    // Make the builder awaitable (thenable) so `await fake.from(t).select()...` resolves.
    chain.then = (onFulfilled: (v: FakeResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected);

    return chain;
  }

  return {
    calls,
    from(table: string) {
      calls.push({ table, method: "from", args: [] });
      return builder(table);
    },
    rpc(name: string, params?: unknown) {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [params] });
      return Promise.resolve(seed[`rpc:${name}`] ?? { data: null, error: null });
    },
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
