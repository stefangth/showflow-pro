// Per-org capability flags ("user rights"). This file is split at the
// sentinel markers below: the registry block between them is GENERATED
// from src/lib/capabilities.ts by `npm run sync:mirrors`; edit the source,
// then regenerate, and never hand-edit the block here. The imports below
// and the edge-only DB-backed helpers past the block ARE hand-maintained
// in this file and are runtime-specific (the edge runtime cannot import
// from src/). SQL twin: public.is_capability_enabled().
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Deps } from "./deps.ts";
import { json } from "./http.ts";

// >>> CAPABILITY REGISTRY MIRROR (keep byte-identical with the twin file) >>>
export type GrantableRole = "producer" | "artist";
export type CapabilityRisk = "standard" | "sensitive";

export interface CapabilityDef {
  key: string;
  action: string;
  role: GrantableRole;
  group: string;
  label: string;
  description: string;
  risk: CapabilityRisk;
  defaultEnabled: boolean;
  module?: string;
}

export const CAPABILITY_DEFS: CapabilityDef[] = [
  // A. Members & access
  { key: "producer_can_invite", action: "invite_artists", role: "producer", group: "Members & access", label: "Invite artists to the app", description: "Producers can send app-login invites to artists.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_manage_invitations", action: "manage_artist_invitations", role: "producer", group: "Members & access", label: "Revoke or resend artist invitations", description: "Producers can revoke or resend pending artist invitations.", risk: "standard", defaultEnabled: true },
  // B. Productions & show dates
  { key: "producer_can_manage_productions", action: "manage_productions", role: "producer", group: "Productions & show dates", label: "Create and edit productions", description: "Producers can create and edit productions.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_archive_productions", action: "archive_productions", role: "producer", group: "Productions & show dates", label: "Archive productions", description: "Producers can archive and unarchive productions.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_reorder_productions", action: "reorder_productions", role: "producer", group: "Productions & show dates", label: "Reorder productions", description: "Producers can drag to reorder the production list.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_hard_delete_productions", action: "hard_delete_productions", role: "producer", group: "Productions & show dates", label: "Delete productions", description: "Producers can permanently delete productions.", risk: "sensitive", defaultEnabled: false },
  { key: "producer_can_manage_show_dates", action: "manage_show_dates", role: "producer", group: "Productions & show dates", label: "Create and edit show dates", description: "Producers can create and edit show dates.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_hard_delete_show_dates", action: "hard_delete_show_dates", role: "producer", group: "Productions & show dates", label: "Delete show dates", description: "Producers can permanently delete show dates.", risk: "sensitive", defaultEnabled: false },
  // C. Bookings & engine
  { key: "producer_can_manage_casts", action: "manage_casts", role: "producer", group: "Bookings & engine", label: "Manage casts", description: "Producers can create, edit, and delete casts.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_run_offer_engine", action: "run_offer_engine", role: "producer", group: "Bookings & engine", label: "Open and close offer tiers", description: "Producers can open and close offer tiers.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_confirm_bookings", action: "confirm_bookings", role: "producer", group: "Bookings & engine", label: "Confirm bookings", description: "Producers can confirm soft-booked artists.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_edit_booking_settings", action: "edit_booking_settings", role: "producer", group: "Bookings & engine", label: "Edit booking-engine settings", description: "Producers can change booking-engine settings.", risk: "sensitive", defaultEnabled: false },
  // D. Artists
  { key: "producer_can_add_artists", action: "add_artists", role: "producer", group: "Artists", label: "Add and import artists", description: "Producers can add single artists and bulk-import.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_edit_artists", action: "edit_artists", role: "producer", group: "Artists", label: "Edit artist details, skills, and status", description: "Producers can edit artist records.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_view_linked_accounts", action: "resend_account_invite", role: "producer", group: "Artists", label: "Resend linked-account invites", description: "Producers can resend an artist's app-login invite.", risk: "standard", defaultEnabled: true },
  // E. Hire orders
  { key: "producer_can_generate_hire_orders", action: "generate_hire_orders", role: "producer", group: "Hire orders", label: "Generate and draft hire orders", description: "Producers can draft hire orders.", risk: "standard", defaultEnabled: true, module: "hire_orders" },
  { key: "producer_can_issue_hire_orders", action: "issue_hire_orders", role: "producer", group: "Hire orders", label: "Issue hire orders", description: "Producers can issue hire orders and email the PDF to artists.", risk: "sensitive", defaultEnabled: true, module: "hire_orders" },
  { key: "producer_can_void_hire_orders", action: "void_hire_orders", role: "producer", group: "Hire orders", label: "Void hire orders", description: "Producers can void issued hire orders.", risk: "sensitive", defaultEnabled: true, module: "hire_orders" },
  { key: "producer_can_manage_countersign", action: "manage_countersign", role: "producer", group: "Hire orders", label: "Manage countersign", description: "Producers can manage the countersign step.", risk: "standard", defaultEnabled: true, module: "hire_orders" },
  { key: "producer_can_edit_hire_order_settings", action: "edit_hire_order_settings", role: "producer", group: "Hire orders", label: "Edit hire-order settings", description: "Producers can change letterhead, numbering, and terms.", risk: "sensitive", defaultEnabled: false, module: "hire_orders" },
  // F. Settings & organization
  { key: "producer_can_rename_org", action: "rename_org", role: "producer", group: "Settings & organization", label: "Rename the organization", description: "Producers can rename the organization.", risk: "sensitive", defaultEnabled: false },
  { key: "producer_can_manage_ownership", action: "manage_ownership", role: "producer", group: "Settings & organization", label: "Manage production ownership", description: "Producers can assign production ownership.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_manage_cities", action: "manage_cities", role: "producer", group: "Settings & organization", label: "Manage casts and cities", description: "Producers can manage the casts and cities lists.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_edit_filter_settings", action: "edit_filter_settings", role: "producer", group: "Settings & organization", label: "Edit filter and notification defaults", description: "Producers can change org filter and notification defaults.", risk: "standard", defaultEnabled: false },
  { key: "producer_can_edit_scheduling", action: "edit_scheduling", role: "producer", group: "Settings & organization", label: "Edit scheduling settings", description: "Producers can change scheduling settings.", risk: "standard", defaultEnabled: true },
  // G. Integrations
  { key: "producer_can_configure_airtable", action: "configure_airtable", role: "producer", group: "Integrations", label: "Configure Airtable sync", description: "Producers can edit the Airtable mapping and keys.", risk: "sensitive", defaultEnabled: false },
  { key: "producer_can_trigger_sync", action: "trigger_sync", role: "producer", group: "Integrations", label: "Trigger a manual sync", description: "Producers can run an on-demand Airtable sync.", risk: "standard", defaultEnabled: false },
  // H. Email
  { key: "producer_can_edit_email_templates", action: "edit_email_templates", role: "producer", group: "Email", label: "Edit email templates", description: "Producers can change email copy and branding.", risk: "sensitive", defaultEnabled: false },
];

export const CAPABILITY_REGISTRY: Record<string, CapabilityDef> = Object.fromEntries(
  CAPABILITY_DEFS.map((d) => [d.key, d]),
);

export const CAPABILITY_KEYS: string[] = CAPABILITY_DEFS.map((d) => d.key);

export function capabilityByKey(key: string): CapabilityDef | undefined {
  return CAPABILITY_REGISTRY[key];
}

export function capabilityFor(role: GrantableRole, action: string): CapabilityDef | undefined {
  return CAPABILITY_DEFS.find((d) => d.role === role && d.action === action);
}

export interface CapabilityRow {
  capability: string;
  enabled: boolean;
}

export function enabledCapabilities(rows: CapabilityRow[]): Set<string> {
  const byKey = new Map(rows.map((r) => [r.capability, r.enabled]));
  return new Set(CAPABILITY_KEYS.filter((k) => byKey.get(k) ?? CAPABILITY_REGISTRY[k].defaultEnabled));
}

export function isCapabilityEnabled(rows: CapabilityRow[], capability: string): boolean {
  return enabledCapabilities(rows).has(capability);
}
// <<< CAPABILITY REGISTRY MIRROR <<<

// ── Edge-only helpers (DB-backed via the is_capability_enabled RPC) ─────────
// Capabilities are permission grants; every helper here fails CLOSED (deny on
// error), unlike entitlements' booking_flow fail-open.

/** Ask the DB (via the `is_capability_enabled` RPC) whether `capability` is on for `orgId`. Fails closed. */
export async function checkCapability(
  admin: SupabaseClient,
  orgId: string,
  capability: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("is_capability_enabled", { _org: orgId, _capability: capability });
  if (error) return false;
  return data === true;
}

/** Edge gate: 403 `{ error: "capability_disabled" }` when `capability` is off for `orgId`, else null. */
export async function requireCapability(
  deps: Deps,
  orgId: string,
  capability: string,
): Promise<Response | null> {
  return (await checkCapability(deps.admin, orgId, capability)) ? null : json({ error: "capability_disabled" }, 403);
}
