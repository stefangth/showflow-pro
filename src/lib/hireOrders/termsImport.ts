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
  const held = new Set(current.templates.map((t) => t.id));
  const added = incoming.filter((t) => !held.has(t.id));
  const templates = [...current.templates, ...added];

  const currentIsUsable = resolveTermsClauses(current, defaultTemplateId(current)).length > 0;
  const default_id = currentIsUsable
    ? defaultTemplateId(current)
    : added[0]?.id ?? incoming[0]?.id ?? current.default_id;

  return { templates, default_id };
}
