/** A single seed: the result returned for every query to a table (backward-compatible form). */
export type SingleSeed = { data?: unknown; error?: unknown };

/** One entry in an array seed — `when` is matched against recorded eq() args. */
export type ArraySeedEntry = { when?: Record<string, unknown>; data?: unknown; error?: unknown };

/** Per-table seed: either a single result object or a match-based array. */
export type TableSeed = SingleSeed | ArraySeedEntry[];

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

/** Resolve the result for a table seed given a local eq map. */
function resolveSeed(seed: TableSeed, localEq: Record<string, unknown>): { data: unknown; error: unknown } {
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
  // Single-object seed (backward-compatible)
  return seed as { data: unknown; error: unknown };
}

/**
 * A minimal, call-recording stand-in for the supabase-js client.
 * Seed is keyed by table name (or `rpc:<name>`) -> TableSeed.
 *
 * TableSeed may be EITHER a single `{ data, error }` (original form) OR an
 * array of `{ when?, data?, error? }` entries for match-based per-query results.
 * At resolve time the first entry whose every `when` pair matches recorded eq()
 * args is returned; if none match, the first entry without `when` is used as a
 * fallback; otherwise `{ data: [], error: null }`.
 */
export function createFakeSupabase(seed: Record<string, TableSeed> = {}) {
  const calls: RecordedCall[] = [];

  function builder(table: string) {
    const tableSeed: TableSeed = seed[table] ?? { data: [], error: null };
    // Local eq map — populated as .eq() calls are chained, used for array-seed matching
    const localEq: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};

    for (const m of CHAIN_METHODS) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        // Track eq() args locally for match-based seed resolution
        if (m === "eq" && args.length >= 2) {
          localEq[String(args[0])] = args[1];
        }
        return chain;
      };
    }
    for (const m of TERMINAL_METHODS) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return Promise.resolve(resolveSeed(tableSeed, localEq));
      };
    }
    // Make the builder awaitable (thenable) so `await fake.from(t).select()...` resolves.
    chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolveSeed(tableSeed, localEq)).then(onFulfilled, onRejected);

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
