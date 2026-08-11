/**
 * Extracts a human-readable message from an unknown thrown value: an `Error`'s
 * `message`, else a duck-typed `.message` string (e.g. a supabase-js error object,
 * which is a plain object, not an `Error`), else the given fallback.
 */
export function toErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return fallback;
}
