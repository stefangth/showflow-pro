// documenso-webhook — flips a hire order to countersigned when Documenso reports
// the document (envelope) completed.
//
// Payload shape verified against Documenso's own source (packages/lib/types/
// webhook-payload.ts + the WebhookTriggerEvents enum in packages/prisma/
// schema.prisma, github.com/documenso/documenso, July 2026 revision):
//
//   { event: WebhookTriggerEvents, payload: TWebhookDocument, createdAt, webhookEndpoint }
//
// The event enum is SCREAMING_SNAKE_CASE -- the completed event is
// "DOCUMENT_COMPLETED", NOT the dotted "document.completed" the plan sketched.
// `payload.envelopeId` is the string envelope id this app stores as
// `hire_orders.documenso_envelope_id` -- it is the SAME id `_shared/documenso.ts`'s
// `createAndSendEnvelope` captured from the `POST /api/v2/envelope/create`
// response (`envelope.envelopeId`). `payload.id` is a legacy NUMERIC document id
// (mapped from a secondaryId) and is not what we key on.
//
// DI: exports handle(req, deps); Deno.serve wiring at the bottom. See index.di.test.ts.
import { preflight, json } from "../_shared/http.ts";
import { constantTimeEqual } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

const DOCUMENT_COMPLETED_EVENT = "DOCUMENT_COMPLETED";

// deno-lint-ignore no-explicit-any
type Any = any;

interface DocumensoWebhookPayload {
  event?: string;
  payload?: {
    envelopeId?: string;
    id?: number;
    [key: string]: unknown;
  };
  createdAt?: string;
  webhookEndpoint?: string;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  // Secret check FIRST, before any database access. A missing or wrong secret
  // must 401 with zero db reads -- mirrors isServiceRole's fail-closed
  // constant-time compare (`_shared/auth.ts`), just against the Vault-backed
  // DOCUMENSO_WEBHOOK_SECRET edge secret instead of the service-role key.
  const provided = req.headers.get("X-Documenso-Secret") ?? "";
  const expected = deps.env("DOCUMENSO_WEBHOOK_SECRET") ?? "";
  if (expected === "" || !constantTimeEqual(provided, expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = (await req.json().catch(() => null)) as DocumensoWebhookPayload | null;

  // Any event we don't act on (including a malformed body) is acknowledged and
  // ignored -- webhooks must not retry-storm on something we'll never process.
  if (body?.event !== DOCUMENT_COMPLETED_EVENT) return json({ ignored: true });

  const envelopeId = body.payload?.envelopeId;
  if (!envelopeId || typeof envelopeId !== "string") return json({ ignored: true });

  return handleDocumentCompleted(deps, envelopeId);
}

// ── document.completed -> countersigned ─────────────────────────────────────

async function handleDocumentCompleted(deps: Deps, envelopeId: string): Promise<Response> {
  const admin = deps.admin;

  const { data: order } = await admin
    .from("hire_orders")
    .select("id, org_id, status, order_no, show_date_id, show_dates(city_id, shows(program, sub_program))")
    .eq("documenso_envelope_id", envelopeId)
    .maybeSingle();

  // Unknown envelope id: never retry-storm an id Documenso holds that we don't
  // (or no longer) recognise.
  if (!order) return json({ ignored: true });
  const o = order as Any;

  // Idempotent no-op: a duplicate delivery must not re-stamp or re-notify.
  if (o.status === "countersigned") return json({ countersigned: true, idempotent: true });

  // Only an issued order can move to countersigned (enforce_hire_order_transition
  // mirrors this DB-side). Anything else (draft/ready/void) is unexpected for an
  // order that ever received a Documenso envelope, but this stays defensive
  // rather than attempting a write the trigger would reject.
  if (o.status !== "issued") {
    console.warn("documenso-webhook: document.completed for a non-issued order", {
      orderId: o.id,
      status: o.status,
    });
    return json({ ignored: true });
  }

  const countersignedAt = deps.now().toISOString();
  const { error: updateErr } = await admin
    .from("hire_orders")
    .update({ status: "countersigned", countersigned_at: countersignedAt })
    .eq("id", o.id);
  if (updateErr) {
    console.error("documenso-webhook: countersign stamp failed", { orderId: o.id, error: updateErr.message });
    return json({ error: "update_failed" }, 500);
  }

  await notifyProducers(deps, o).catch((e) =>
    console.error("documenso-webhook: producer notification failed", { orderId: o.id, error: (e as Error).message }),
  );

  return json({ countersigned: true });
}

/**
 * Notify the order's producers that it has been countersigned. Resolution
 * mirrors generate-hire-orders' notifyProducers: resolve via
 * `resolve_show_assignments` for the order's show_date (program/sub_program/
 * city), falling back to the org's admins when nothing resolves or the order
 * has no linked show_date (a manual/wizard order). Recipients are deduped.
 */
async function notifyProducers(deps: Deps, order: Any): Promise<void> {
  const admin = deps.admin;
  const org = order.org_id as string;
  const showDate = order.show_dates as Any | null;

  let recipientIds: string[] = [];
  if (showDate) {
    const { data: producers } = await admin.rpc("resolve_show_assignments", {
      p_program: showDate.shows?.program ?? "",
      p_sub_program: showDate.shows?.sub_program ?? null,
      p_city_id: showDate.city_id,
      p_org: org,
    });
    recipientIds = (producers ?? []).map((p: Any) => p.producer_user_id);
  }

  if (recipientIds.length === 0) {
    const { data: admins } = await admin
      .from("org_memberships").select("user_id").eq("org_id", org).eq("role", "admin");
    recipientIds = (admins ?? []).map((a: Any) => a.user_id);
  }

  recipientIds = [...new Set(recipientIds)] as string[];
  if (recipientIds.length === 0) return;

  const rows = recipientIds.map((uid: string) => ({
    org_id: org,
    user_id: uid,
    type: "hire_order_countersigned",
    title: "Hire order countersigned",
    message: `Hire order ${order.order_no} has been countersigned.`,
    related_entity_type: "hire_order",
    related_entity_id: order.id,
  }));
  const { error } = await admin.from("notifications").insert(rows);
  if (error) {
    console.error("documenso-webhook: producer notification insert failed", { org, orderId: order.id, error: error.message });
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
