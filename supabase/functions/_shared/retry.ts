/**
 * One-retry wrappers for transient Supabase API failures.
 *
 * Supabase's API gateway cuts off a small share of REST calls with a 504 after exactly
 * 5 s (about 0.5% of cron traffic in Sep 2026) even when the SQL itself runs in
 * milliseconds. That limit is on Supabase's side and not configurable from here, and
 * the failures are isolated single calls, so one short retry covers them.
 *
 * Only wrap calls that are safe to run twice: reads and idempotent RPCs.
 */
export const RETRY_DELAY_MS = 250;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Run a supabase-style call (`{ data, error }`); on `error`, wait and run it once more. */
export async function retryOnError<T extends { error: unknown }>(
  call: () => PromiseLike<T>,
  delayMs = RETRY_DELAY_MS,
): Promise<T> {
  const first = await call();
  if (!first.error) return first;
  await sleep(delayMs);
  return await call();
}

/** Run a call that throws on failure; on a throw, wait and run it once more. */
export async function retryOnThrow<T>(call: () => PromiseLike<T>, delayMs = RETRY_DELAY_MS): Promise<T> {
  try {
    return await call();
  } catch {
    await sleep(delayMs);
    return await call();
  }
}
