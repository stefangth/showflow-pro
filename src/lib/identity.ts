// Single source of truth for identity/contact resolution (ADR-0011). The edge
// functions import the same module from _shared; the frontend re-exports it so
// the digest path and the UI never diverge.
export { resolveContactEmail, resolveAccountDisplayName, redactEmail } from
  "../../supabase/functions/_shared/identity.ts";
