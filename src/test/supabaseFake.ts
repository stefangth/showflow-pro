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

/** Chainable query builder: every chain method returns the same builder, the
 *  terminal methods resolve to a result, and the builder itself is awaitable. */
type ChainFn = (...args: unknown[]) => FakeChain;
type TerminalFn = (...args: unknown[]) => Promise<FakeResult>;
export interface FakeChain extends PromiseLike<FakeResult> {
  select: ChainFn; insert: ChainFn; update: ChainFn; upsert: ChainFn; delete: ChainFn;
  eq: ChainFn; neq: ChainFn; gt: ChainFn; gte: ChainFn; lt: ChainFn; lte: ChainFn;
  in: ChainFn; is: ChainFn; or: ChainFn; not: ChainFn; match: ChainFn;
  order: ChainFn; limit: ChainFn; range: ChainFn; filter: ChainFn; contains: ChainFn; overlaps: ChainFn;
  single: TerminalFn; maybeSingle: TerminalFn;
}

/** Chainable query-builder methods that return `this` and record their call. */
const CHAIN_METHODS = [
  "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "or", "not", "match",
  "order", "limit", "range", "filter", "contains", "overlaps",
] as const;

/** Terminal methods that resolve to the seeded result. */
const TERMINAL_METHODS = ["single", "maybeSingle"] as const;

/** Resolve the result for a table seed given a local eq map and in-filter map. */
function resolveSeed(
  seed: TableSeed,
  localEq: Record<string, unknown>,
  localIn: Record<string, unknown[]> = {},
): { data: unknown; error: unknown } {
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
  // where the field value is not in the allowed set. Mirrors the Deno fake.
  const { data, error } = seed as { data: unknown; error: unknown };
  if (data !== null && data !== undefined && Object.keys(localIn).length > 0) {
    const applyInFilter = (row: Record<string, unknown>): boolean =>
      Object.entries(localIn).every(([col, allowed]) => allowed.includes(row[col]));

    if (Array.isArray(data)) {
      // Filter the array and return only matching rows
      const filtered = (data as Record<string, unknown>[]).filter(applyInFilter);
      return { data: filtered.length > 0 ? filtered : null, error };
    } else if (typeof data === "object") {
      // Single object: return null if it doesn't satisfy the in() constraint
      if (!applyInFilter(data as Record<string, unknown>)) {
        return { data: null, error };
      }
    }
  }
  return { data, error };
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

  function builder(table: string): FakeChain {
    const tableSeed: TableSeed = seed[table] ?? { data: [], error: null };
    // Local eq map — populated as .eq() calls are chained, used for array-seed matching
    const localEq: Record<string, unknown> = {};
    // Local in map — populated as .in() calls are chained, used for membership filtering
    const localIn: Record<string, unknown[]> = {};
    const chain: Record<string, unknown> = {};

    for (const m of CHAIN_METHODS) {
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
    for (const m of TERMINAL_METHODS) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return Promise.resolve(resolveSeed(tableSeed, localEq, localIn));
      };
    }
    // Make the builder awaitable (thenable) so `await fake.from(t).select()...` resolves.
    chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolveSeed(tableSeed, localEq, localIn)).then(onFulfilled, onRejected);

    return chain as unknown as FakeChain;
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
    functions: {
      // Seed an edge-function result under `fn:<name>` (e.g. `fn:create-invitation`).
      invoke(name: string, opts?: { body?: unknown }) {
        calls.push({ table: `fn:${name}`, method: "invoke", args: [opts?.body] });
        return Promise.resolve(seed[`fn:${name}`] ?? { data: null, error: null });
      },
    },
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
