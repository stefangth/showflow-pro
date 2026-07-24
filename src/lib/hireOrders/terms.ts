// Hire-order terms templates: the org's `hire_order_terms` app-setting.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries byte-identical
// copies of these types + helpers (the two runtimes cannot share an import).
// Change both files in the same commit.

export interface HireOrderClause {
  title: string;
  body: string;
}

export interface HireOrderTemplate {
  id: string;
  name: string;
  clauses: HireOrderClause[];
}

export interface HireOrderTermsSetting {
  templates: HireOrderTemplate[];
  default_id: string | null;
}

const LEGACY_KEYS = ["lean", "standard", "full"] as const;
const LEGACY_NAMES: Record<(typeof LEGACY_KEYS)[number], string> = {
  lean: "Lean",
  standard: "Standard",
  full: "Full",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceClauses(raw: unknown): HireOrderClause[] {
  if (!Array.isArray(raw)) return [];
  const out: HireOrderClause[] = [];
  for (const c of raw) {
    if (isRecord(c) && typeof c.title === "string" && typeof c.body === "string") {
      out.push({ title: c.title, body: c.body });
    }
  }
  return out;
}

/** Normalize any stored `hire_order_terms` value to the new shape, tolerating
 *  the legacy `{lean,standard,full}` shape and junk. */
export function normalizeTermsSetting(raw: unknown): HireOrderTermsSetting {
  if (!isRecord(raw)) return { templates: [], default_id: null };

  // Legacy shape: has at least one of lean/standard/full and no `templates`.
  if (!("templates" in raw) && LEGACY_KEYS.some((k) => k in raw)) {
    return {
      templates: LEGACY_KEYS.map((k) => ({
        id: k,
        name: LEGACY_NAMES[k],
        clauses: coerceClauses(raw[k]),
      })),
      default_id: "standard",
    };
  }

  if (!Array.isArray(raw.templates)) return { templates: [], default_id: null };
  const templates: HireOrderTemplate[] = [];
  for (const t of raw.templates) {
    if (isRecord(t) && typeof t.id === "string" && typeof t.name === "string") {
      templates.push({ id: t.id, name: t.name, clauses: coerceClauses(t.clauses) });
    }
  }
  const default_id = typeof raw.default_id === "string" ? raw.default_id : null;
  return { templates, default_id };
}

/** The effective default template id: `default_id` if it exists, else the first
 *  template, else null. */
export function defaultTemplateId(setting: HireOrderTermsSetting): string | null {
  if (setting.default_id && setting.templates.some((t) => t.id === setting.default_id)) {
    return setting.default_id;
  }
  return setting.templates[0]?.id ?? null;
}

/** Clauses to render for an order: the referenced template, else the default
 *  template (deleted-reference fallback), else []. */
export function resolveTermsClauses(
  setting: HireOrderTermsSetting,
  termsVariantId: string | null,
): HireOrderClause[] {
  const byId = termsVariantId
    ? setting.templates.find((t) => t.id === termsVariantId)
    : undefined;
  if (byId) return byId.clauses;
  const defId = defaultTemplateId(setting);
  return setting.templates.find((t) => t.id === defId)?.clauses ?? [];
}
