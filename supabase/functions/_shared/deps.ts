import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface EmailMessage {
  template_name: string;
  recipient_email: string;
  org_id?: string;
  templateData?: Record<string, unknown>;
  idempotency_key?: string;
}

export interface InvokeResult {
  data: unknown;
  error: unknown;
}

/**
 * Did a `deps.sendEmail(...)` call actually deliver an email?
 *
 * `sendEmail`/`invokeFunction` never throw — they return `{ data, error }`. And
 * `send-transactional-email` returns HTTP 200 `{ success: false, reason }` for a
 * legitimately-skipped send (suppressed address / preference-disabled / already-used
 * token), reserving a thrown/`error`-populated result for hard failures (missing config,
 * Resend outage). So a real delivery is ONLY `error == null && data.success === true`.
 *
 * Callers use this to avoid side effects (stamping digest_sent_at / starting the expiry
 * clock) on a failed OR skipped send. See C4 in the code-review fixes.
 */
export function emailWasSent(result: InvokeResult): boolean {
  if (result.error != null) return false;
  const data = result.data as { success?: unknown } | null | undefined;
  return !!data && data.success === true;
}

/** Everything a handler touches that is environment- or time-dependent. Injected so tests can fake it. */
export interface Deps {
  admin: SupabaseClient;
  userClient: (authHeader: string) => SupabaseClient;
  env: (key: string) => string | undefined;
  now: () => Date;
  invokeFunction: (name: string, body: unknown) => Promise<InvokeResult>;
  sendEmail: (msg: EmailMessage) => Promise<InvokeResult>;
  fetch: typeof fetch;
}

/**
 * Build the production Deps from the environment.
 * `getEnv` is injectable purely so this is unit-testable; production calls realDeps().
 */
export function realDeps(getEnv: (k: string) => string | undefined = (k) => Deno.env.get(k)): Deps {
  const url = getEnv("SUPABASE_URL") ?? "";
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = getEnv("SUPABASE_ANON_KEY") ?? "";
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const invokeFunction = async (name: string, body: unknown): Promise<InvokeResult> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await admin.functions.invoke(name, { body: body as any });
    return { data, error };
  };

  return {
    admin,
    userClient: (authHeader: string) =>
      createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } }),
    env: getEnv,
    now: () => new Date(),
    invokeFunction,
    sendEmail: (msg: EmailMessage) => invokeFunction("send-transactional-email", msg),
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  };
}
