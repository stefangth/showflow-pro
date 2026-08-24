import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CITY_NAME_REQUIRED, createCity } from "@/data/cities";
import { useCities } from "@/hooks/useCities";
import { useCan } from "@/hooks/useCapabilities";
import { useDatesSource } from "@/hooks/useDatesSource";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { toErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Postgres unique-violation, however supabase-js hands it back (a plain object with a
 *  `code`, or an Error whose message carries the constraint text). Mirrors
 *  `useInlineSkillCreate`'s own check rather than sharing one: the two live in different
 *  domains and neither owns the other. */
function isNameTaken(e: unknown): boolean {
  if (e && typeof e === "object" && (e as { code?: unknown }).code === "23505") return true;
  return /duplicate key|already exists|unique constraint/i.test(toErrorMessage(e, ""));
}

/**
 * The "Cities you play" section of the production dialog.
 *
 * Cities are ONE org-wide catalog: nothing here is stored against the production. This
 * section exists only because the producer is already thinking about where the production
 * goes while setting it up, so it is a convenient second door onto the same catalog that
 * Settings > Casts & coverage owns. The copy says so, and the existing cities are rendered
 * as plain, non-interactive chips precisely so they cannot read as a per-production
 * selection: no aria-pressed, no check mark, no hover affordance.
 */
export function CityCatalogField({ orgId }: { orgId: string | null }) {
  const { t } = useTranslation("productions");
  const qc = useQueryClient();
  // Growing the city catalog is `manage_cities` (the capability Settings gates its own
  // add-city control on), NOT the `edit_scheduling` behind the rest of this dialog.
  const canManageCities = useCan("manage_cities");
  const citiesQ = useCities();
  const cities = citiesQ.data ?? [];
  const showCreate = canManageCities && !!orgId;
  // `useAirtableConsole` is heavyweight (roughly ten queries), so it is mounted only for
  // an org whose dates actually come from Airtable, and only for someone allowed to write
  // the link. A manual or sheet org pays nothing: the sub-component is not rendered, so
  // the hook is never called. `useDatesSource` itself is one cached read.
  const canConfigureAirtable = useCan("configure_airtable");
  const { source } = useDatesSource(orgId);
  const showAirtable = !!orgId && source === "airtable" && canConfigureAirtable;

  const add = useMutation({
    mutationFn: (name: string) => {
      if (!orgId) throw new Error(t("form.cities.noOrg"));
      return createCity(supabase, { name, orgId });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); },
    onError: (e: unknown, name: string) => {
      // A duplicate is the LIKELY failure here: the chip row above literally shows the
      // producer which names already exist, so say which name clashed rather than
      // leaking `duplicate key value violates unique constraint "cities_org_name_uniq"`.
      if (isNameTaken(e)) { toast.error(t("form.cities.duplicate", { name })); return; }
      if (e instanceof Error && e.message === CITY_NAME_REQUIRED) { toast.error(t("form.cities.nameRequired")); return; }
      toast.error(toErrorMessage(e, t("form.cities.addFailed")));
    },
  });

  return (
    <div className="space-y-2.5">
      <p className="text-sm font-medium">{t("form.cities.heading")}</p>
      <p className="text-xs text-muted-foreground">{t("form.cities.sub")}</p>

      {/* A read that FAILED must never render as a reassuring "no cities yet": the catalog
          may be full and simply unreadable right now. */}
      {citiesQ.isError ? (
        <p className="text-xs text-destructive">{t("form.cities.loadFailed")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* The empty hint has to match the state the producer is actually in: it may only
              point at the inline chip when the chip is there to point at. */}
          {!citiesQ.isLoading && cities.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {showCreate ? t("form.cities.empty") : t("form.cities.emptyLocked")}
            </p>
          )}
          {cities.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground"
            >
              {c.name}
            </span>
          ))}
          {showCreate && <CreateCityChip onCreate={(name) => add.mutateAsync(name)} />}
        </div>
      )}

      {showAirtable && <AirtableUnlinkedCities orgId={orgId} />}
    </div>
  );
}

/** City names Airtable has already sent over that have no city in this org's catalog yet.
 *  Each chip creates the city AND links it to its Airtable option key in one go (that is
 *  what `onCreate("city", row)` composes), which is why these are a separate affordance
 *  from the plain "New city" chip: a bare create would leave the imported dates still
 *  unresolved. Mounted only by a caller that has already checked the org is on Airtable
 *  and the producer holds `configure_airtable`, so the console's cost lands nowhere else. */
function AirtableUnlinkedCities({ orgId }: { orgId: string }) {
  const { t } = useTranslation("productions");
  // readOnly false: the only caller gates on `configure_airtable`, which is exactly what
  // readOnly expresses. `canWrite` below is the same fact, re-read from the hook.
  const airtable = useAirtableConsole(orgId, { readOnly: false, canTriggerSync: false });
  const rows = airtable.cityRows.filter((r) => !r.linkedId);
  // A 403 from airtable-schema degrades the console to an empty catalog, so this also
  // covers "the read did not come back": nothing is claimed, nothing is offered.
  if (!airtable.canWrite || rows.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{t("form.cities.airtableHint")}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {rows.map((row) => (
          <button
            key={row.key || row.display}
            type="button"
            onClick={() => airtable.onCreate("city", row)}
            aria-label={t("form.cities.linkLabel", { name: row.display })}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus aria-hidden="true" className="h-3 w-3" />
            {row.display}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The "New city" chip and the inline field it swaps into. Mirrors the skill picker's
 *  create chip; kept local because this one carries no selection at all, and two
 *  near-neighbours are not yet a pattern worth abstracting. */
function CreateCityChip({ onCreate }: { onCreate: (name: string) => Promise<{ id: string; name: string }> }) {
  const { t } = useTranslation("productions");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await onCreate(trimmed);
      setName("");
      setOpen(false);
    } catch {
      // A rejected create (a duplicate name, a lost connection) leaves the field open with
      // the typed name so it can be amended. The mutation's onError says why.
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus aria-hidden="true" className="h-3 w-3" />
        {t("form.cities.new")}
      </button>
    );
  }

  return (
    // Deliberately NOT a <form>: this renders inside ShowFormDialog's production <form>,
    // and a nested form both breaks HTML nesting and bubbles its submit into the outer
    // one, saving the production behind the producer's back. Enter and the check button
    // call submit() directly instead.
    <div
      role="group"
      aria-label={t("form.cities.new")}
      className={cn("inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background pl-2.5 pr-0.5 py-0.5")}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setName(""); }
          // Enter must not reach the enclosing form, which would submit the production.
          if (e.key === "Enter") { e.preventDefault(); void submit(); }
        }}
        aria-label={t("form.cities.nameLabel")}
        placeholder={t("form.cities.nameLabel")}
        className="w-28 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={pending || !name.trim()}
        aria-label={t("form.cities.create")}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
      >
        <Check aria-hidden="true" className="h-3 w-3" />
      </button>
    </div>
  );
}
