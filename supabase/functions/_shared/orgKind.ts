// Workspace type (org_kind) for the edge runtime. The block between the sentinels is
// GENERATED from src/lib/orgKind.ts by `npm run sync:mirrors`; edit the source and
// regenerate, never hand-edit the block. `resolveOrgKind` below is edge-only.
import type { TypedClient } from "./deps.ts";

// >>> ORG KIND REGISTRY MIRROR (keep byte-identical with the twin file) >>>
export type OrgKind = "production" | "staffing";
export type OrgKindLang = "en" | "de";

export const ORG_KINDS: readonly OrgKind[] = ["production", "staffing"];
export const DEFAULT_ORG_KIND: OrgKind = "production";

export function isOrgKind(v: unknown): v is OrgKind {
  return v === "production" || v === "staffing";
}

/** Narrow any stored value to an OrgKind; anything unknown is production. */
export function coerceOrgKind(v: unknown): OrgKind {
  return isOrgKind(v) ? v : DEFAULT_ORG_KIND;
}

/** Picker labels. Neutral, plain language; the noun tables below carry the vocabulary. */
export const ORG_KIND_LABELS: Record<OrgKind, Record<OrgKindLang, { title: string; desc: string }>> = {
  production: {
    en: { title: "Live production", desc: "Shows, dates, artists and casts." },
    de: { title: "Live-Produktion", desc: "Shows, Termine, Artists und Besetzungen." },
  },
  staffing: {
    en: { title: "Staffing agency", desc: "Clients, shifts, staff and teams." },
    de: { title: "Personalagentur", desc: "Kunden, Schichten, Teammitglieder und Teams." },
  },
};

/**
 * Vocabulary variables. Four forms per noun because i18next interpolation is plain
 * substitution and sentences start with capitals: lower singular, lower plural,
 * Capital singular, Capital plural. Every (kind, lang) table has the same keys
 * (orgKind.test.ts). PR 2 extends this list during the copy audit.
 */
export type VocabKey =
  | "show" | "shows" | "Show" | "Shows"
  | "showDate" | "showDates" | "ShowDate" | "ShowDates"
  | "artist" | "artists" | "Artist" | "Artists"
  | "production" | "productions" | "Production" | "Productions"
  | "cast" | "casts" | "Cast" | "Casts"
  | "understudy" | "understudies" | "Understudy" | "Understudies"
  | "skill" | "skills" | "Skill" | "Skills"
  | "hireOrder" | "hireOrders" | "HireOrder" | "HireOrders";

export type Vocabulary = Record<VocabKey, string>;

export const VOCABULARY: Record<OrgKind, Record<OrgKindLang, Vocabulary>> = {
  production: {
    en: {
      show: "show", shows: "shows", Show: "Show", Shows: "Shows",
      showDate: "date", showDates: "dates", ShowDate: "Date", ShowDates: "Dates",
      artist: "artist", artists: "artists", Artist: "Artist", Artists: "Artists",
      production: "production", productions: "productions", Production: "Production", Productions: "Productions",
      cast: "cast", casts: "casts", Cast: "Cast", Casts: "Casts",
      understudy: "understudy", understudies: "understudies", Understudy: "Understudy", Understudies: "Understudies",
      skill: "skill", skills: "skills", Skill: "Skill", Skills: "Skills",
      hireOrder: "contract", hireOrders: "contracts", HireOrder: "Contract", HireOrders: "Contracts",
    },
    de: {
      show: "Show", shows: "Shows", Show: "Show", Shows: "Shows",
      showDate: "Termin", showDates: "Termine", ShowDate: "Termin", ShowDates: "Termine",
      artist: "Artist", artists: "Artists", Artist: "Artist", Artists: "Artists",
      production: "Produktion", productions: "Produktionen", Production: "Produktion", Productions: "Produktionen",
      cast: "Besetzung", casts: "Besetzungen", Cast: "Besetzung", Casts: "Besetzungen",
      understudy: "Zweitbesetzung", understudies: "Zweitbesetzungen", Understudy: "Zweitbesetzung", Understudies: "Zweitbesetzungen",
      skill: "Skill", skills: "Skills", Skill: "Skill", Skills: "Skills",
      hireOrder: "Engagementvertrag", hireOrders: "Engagementverträge", HireOrder: "Engagementvertrag", HireOrders: "Engagementverträge",
    },
  },
  staffing: {
    en: {
      show: "project", shows: "projects", Show: "Project", Shows: "Projects",
      showDate: "shift", showDates: "shifts", ShowDate: "Shift", ShowDates: "Shifts",
      artist: "staff member", artists: "people", Artist: "Staff member", Artists: "People",
      production: "client", productions: "clients", Production: "Client", Productions: "Clients",
      cast: "team", casts: "teams", Cast: "Team", Casts: "Teams",
      understudy: "standby", understudies: "standbys", Understudy: "Standby", Understudies: "Standbys",
      skill: "qualification", skills: "qualifications", Skill: "Qualification", Skills: "Qualifications",
      hireOrder: "work order", hireOrders: "work orders", HireOrder: "Work order", HireOrders: "Work orders",
    },
    de: {
      show: "Projekt", shows: "Projekte", Show: "Projekt", Shows: "Projekte",
      showDate: "Schicht", showDates: "Schichten", ShowDate: "Schicht", ShowDates: "Schichten",
      artist: "Teammitglied", artists: "Personen", Artist: "Teammitglied", Artists: "Personen",
      production: "Kunde", productions: "Kunden", Production: "Kunde", Productions: "Kunden",
      cast: "Team", casts: "Teams", Cast: "Team", Casts: "Teams",
      understudy: "Ersatz", understudies: "Ersatzkräfte", Understudy: "Ersatz", Understudies: "Ersatzkräfte",
      skill: "Qualifikation", skills: "Qualifikationen", Skill: "Qualifikation", Skills: "Qualifikationen",
      hireOrder: "Arbeitsauftrag", hireOrders: "Arbeitsaufträge", HireOrder: "Arbeitsauftrag", HireOrders: "Arbeitsaufträge",
    },
  },
};
// <<< ORG KIND REGISTRY MIRROR <<<

interface OrgKindRow { org_kind: string | null }

/**
 * The org's workspace type, read from organizations.org_kind. A null org (auth or
 * platform emails with no org context), a missing row, an unknown value, or any read
 * error all resolve to production, so a broken read can never leak the wrong words.
 */
export async function resolveOrgKind(admin: TypedClient, orgId: string | null): Promise<OrgKind> {
  if (!orgId) return DEFAULT_ORG_KIND;
  try {
    const { data, error } = await admin
      .from("organizations")
      .select("org_kind")
      .eq("id", orgId)
      .maybeSingle();
    if (error) return DEFAULT_ORG_KIND;
    return coerceOrgKind((data as OrgKindRow | null)?.org_kind);
  } catch {
    return DEFAULT_ORG_KIND;
  }
}
