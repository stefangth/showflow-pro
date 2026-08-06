import {
  defaultTemplateId,
  resolveTermsClauses,
  type HireOrderTemplate,
  type HireOrderTermsSetting,
} from "./terms";

/**
 * Append platform-library templates to an org's `hire_order_terms`.
 *
 * APPENDS, never replaces: an org that already authored its own templates must not
 * lose them by clicking Import. A template whose id the org already holds is skipped
 * entirely, so re-import is a no-op and never overwrites an org's edits to a template
 * it imported earlier.
 *
 * `default_id` is only moved when the org's current default resolves to no clauses,
 * that is, when the org is not yet issue-ready on terms. One import then makes it
 * ready; an org that already had usable terms keeps its own default.
 *
 * Lives here rather than in ./terms.ts, which is a hand-maintained mirror of
 * supabase/functions/_shared/hireOrders.ts. Nothing on the edge needs this.
 */
export function mergeTermsTemplates(
  current: HireOrderTermsSetting,
  incoming: HireOrderTemplate[],
): HireOrderTermsSetting {
  // An org with no stored `hire_order_terms` row resolves the HIRE_ORDER_DEFAULT_TERMS
  // fallback: three clause-less placeholders named Lean / Standard / Full. Carrying
  // those into the upsert would persist three templates the org never authored, each
  // selectable as a terms_variant that renders a blank back page and then fails at
  // issue with missing_terms. When EVERY current template is clause-less the whole set
  // is content-free by definition, so it is dropped. A single empty draft alongside a
  // real template is left alone: that one an admin actually authored.
  const base = current.templates.some((t) => t.clauses.length > 0) ? current.templates : [];

  const held = new Set(base.map((t) => t.id));
  const added = incoming.filter((t) => !held.has(t.id));
  const templates = [...base, ...added];

  // Only move the default when the org's own default carries no clauses, i.e. it is not
  // yet issue-ready on terms. The replacement must itself resolve to clauses, otherwise
  // an import reports success and leaves missing_terms firing: `added[0]` can be a
  // clause-less entry, and the `incoming[0]` fall-through can name a template the org
  // already holds with its clauses emptied out.
  const currentIsUsable = resolveTermsClauses(current, defaultTemplateId(current)).length > 0;
  const firstUsable =
    added.find((t) => t.clauses.length > 0) ?? incoming.find((t) => t.clauses.length > 0);
  const default_id = currentIsUsable
    ? defaultTemplateId(current)
    : firstUsable?.id ?? defaultTemplateId({ templates, default_id: current.default_id });

  return { templates, default_id };
}
