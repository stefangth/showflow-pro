import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "./database.types.ts";
import type { RenderHireOrderPdf } from "./hireOrders.ts";

/** The Supabase client typed against the mirrored generated Database schema. */
export type TypedClient = SupabaseClient<Database>;

/** A file attached to a transactional email (Task 10 wires the actual Resend send). */
export interface EmailAttachment {
  filename: string;
  content_base64: string;
}

export interface EmailMessage {
  template_name: string;
  recipient_email: string;
  org_id?: string;
  templateData?: Record<string, unknown>;
  idempotency_key?: string;
  /** Binary attachments (e.g. the issued hire-order PDF). Task 10 implements delivery. */
  attachments?: EmailAttachment[];
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
  admin: TypedClient;
  userClient: (authHeader: string) => TypedClient;
  env: (key: string) => string | undefined;
  now: () => Date;
  invokeFunction: (name: string, body: unknown) => Promise<InvokeResult>;
  sendEmail: (msg: EmailMessage) => Promise<InvokeResult>;
  /** Render a hire-order PDF (Task 7 concrete impl, injected so tests can fake it). */
  renderHireOrderPdf: RenderHireOrderPdf;
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
  const admin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const invokeFunction = async (name: string, body: unknown): Promise<InvokeResult> => {
    // FunctionInvokeOptions.body does not accept `unknown`; every caller passes a
    // JSON object payload, so narrow to the Record member of its union.
    const { data, error } = await admin.functions.invoke(name, {
      body: body as Record<string, unknown>,
    });
    return { data, error };
  };

  return {
    admin,
    userClient: (authHeader: string) =>
      createClient<Database>(url, anonKey, { global: { headers: { Authorization: authHeader } } }),
    env: getEnv,
    now: () => new Date(),
    invokeFunction,
    sendEmail: (msg: EmailMessage) => invokeFunction("send-transactional-email", msg),
    // Lazily import the concrete renderer: it pulls in react-pdf and ~707KB of
    // embedded fonts, so a static import would load that heavy module into every
    // edge-function test that imports deps.ts. Deferring it to first render keeps
    // the test graph light and the module cost out of cold-start until a PDF is
    // actually generated.
    renderHireOrderPdf: async (input) => {
      const { renderHireOrderPdf } = await import("./hire-order-pdf/render.tsx");
      return renderHireOrderPdf(input);
    },
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  };
}
