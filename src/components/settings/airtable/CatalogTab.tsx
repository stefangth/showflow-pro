import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, ChevronsUpDown, Copy, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface CatalogRow {
  key: string;
  display: string;
  linkedId: string | null;
  linkedLabel: string | null;
  holdCount?: number;
}

type Kind = "program" | "city";
type Filter = "All" | "Blocking" | "Linked";

export interface CatalogTabProps {
  programSource: string;                 // e.g. "Program · Sub-program"
  citySource: string;                    // e.g. "City"
  programRows: CatalogRow[];
  cityRows: CatalogRow[];
  programExisting: { id: string; label: string }[];  // unlinked catalog shows to link against
  cityExisting: { id: string; label: string }[];
  onLink: (kind: Kind, row: CatalogRow, existingId: string) => void;
  onCreate: (kind: Kind, row: CatalogRow) => void;
  onUnlink: (kind: Kind, linkedId: string) => void;
  onBulkCreate: (kind: Kind, rows: CatalogRow[]) => void;   // the checked, unlinked rows
  merge: { title: string; description: string; actionLabel: string; onMerge: () => void } | null;
  canWrite: boolean;
  busy?: boolean;
}

const FILTERS: Filter[] = ["All", "Blocking", "Linked"];

/** Per-row "smart" combobox: search existing catalog rows to link, or create a new catalog
 *  entry for this Airtable option. Copied from AirtableSyncTab so this tab is self-contained. */
function CatalogLinkCombobox({
  optionLabel, existing, onCreate, onLink, disabled, ariaLabel, searchPlaceholder,
}: {
  optionLabel: string;
  existing: { id: string; label: string }[];
  onCreate: () => void;
  onLink: (id: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  searchPlaceholder: string;
}) {
  const { t } = useTranslation('settingsAirtable');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const matches = existing.filter((e) => e.label.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-[30px] flex-1 justify-between bg-muted font-normal" aria-label={ariaLabel} disabled={disabled}>
          <span className="truncate text-muted-foreground">{t('catalogTab.linkToExisting')}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="end">
        {/* Manual filtering (shouldFilter=false) so the Create row is always offered. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandGroup>
              {/* Radix doesn't fire onOpenChange for a programmatic close, so clear search here too. */}
              <CommandItem value="__create__" onSelect={() => { onCreate(); setOpen(false); setSearch(""); }}>
                <Plus className="h-4 w-4 mr-2" /> {t('catalogTab.createOption', { optionLabel })}
              </CommandItem>
            </CommandGroup>
            {matches.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t('catalogTab.linkToExistingHeading')}>
                  {matches.map((e) => (
                    <CommandItem key={e.id} value={e.id} onSelect={() => { onLink(e.id); setOpen(false); setSearch(""); }}>
                      {e.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {matches.length === 0 && search.trim() !== "" && (
              <p className="px-3 py-2 text-xs text-muted-foreground">{t('catalogTab.noMatches')}</p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Presentational Catalog-links tab of the Airtable Sync console: a toolbar (search +
 *  All/Blocking/Linked filter + bulk create), a Programs section and a Cities section of
 *  selectable rows (each linked to a target with Unlink, or unlinked with a link/create combobox),
 *  and an optional merge-suggestion footer. All data + callbacks arrive via props. */
export function CatalogTab(props: CatalogTabProps) {
  const { t } = useTranslation('settingsAirtable');
  const {
    programSource, citySource, programRows, cityRows, programExisting, cityExisting,
    onLink, onCreate, onUnlink, onBulkCreate, merge, canWrite, busy,
  } = props;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");

  const disabled = !canWrite || !!busy;

  const selKey = (kind: Kind, key: string) => `${kind}:${key}`;
  const isSelected = (kind: Kind, key: string) => selected.has(selKey(kind, key));
  const toggle = (kind: Kind, key: string) => {
    setSelected((prev) => {
      const id = selKey(kind, key);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const matchesFilters = (row: CatalogRow) => {
    const q = search.trim().toLowerCase();
    if (q && !row.display.toLowerCase().includes(q)) return false;
    if (filter === "Blocking") return (row.holdCount ?? 0) > 0;
    if (filter === "Linked") return row.linkedId !== null;
    return true;
  };

  const filteredPrograms = programRows.filter(matchesFilters);
  const filteredCities = cityRows.filter(matchesFilters);

  // Only selected UNLINKED rows can be created; the button count and gate track those, not the
  // raw selection (which may include linked rows that Create would skip).
  const progCreatable = programRows.filter((r) => isSelected("program", r.key) && r.linkedId === null);
  const cityCreatable = cityRows.filter((r) => isSelected("city", r.key) && r.linkedId === null);
  const creatableCount = progCreatable.length + cityCreatable.length;

  const handleBulkCreate = () => {
    if (progCreatable.length) onBulkCreate("program", progCreatable);
    if (cityCreatable.length) onBulkCreate("city", cityCreatable);
  };

  const renderRow = (kind: Kind, row: CatalogRow, existing: { id: string; label: string }[], entityNoun: "show" | "city") => {
    const sel = isSelected(kind, row.key);
    const holding = row.holdCount ?? 0;
    const translatedNoun = t(`catalogTab.entityNoun.${entityNoun}`);
    return (
      <div
        key={row.key}
        className={cn(
          "grid grid-cols-[20px_1fr_300px] gap-3 items-center px-4 py-2.5 border-b border-border last:border-b-0",
          sel && "bg-muted",
        )}
      >
        <button
          type="button"
          onClick={() => toggle(kind, row.key)}
          aria-label={t('catalogTab.selectRowAria', { display: row.display })}
          aria-pressed={sel}
          className={cn(
            "h-4 w-4 rounded-[4px] border flex items-center justify-center",
            sel ? "bg-primary border-primary" : "border-border bg-card",
          )}
        >
          {sel && <Check className="h-[11px] w-[11px] text-primary-foreground" aria-hidden />}
        </button>

        <div className="min-w-0 flex items-center gap-2">
          <span className="text-sm font-medium truncate">{row.display}</span>
          {holding > 0 && (
            <span className="h-[18px] shrink-0 inline-flex items-center rounded-[4px] bg-[var(--amber-100)] px-1.5 text-[11px] font-medium text-[color:var(--amber-600)]">
              {t('catalogTab.holding', { count: holding })}
            </span>
          )}
        </div>

        {row.linkedId ? (
          <div className="flex items-center gap-2 justify-end min-w-0">
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
            <span className="text-[13px] text-foreground truncate">{row.linkedLabel}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-[26px] shrink-0 px-2 text-muted-foreground"
              disabled={disabled}
              onClick={() => onUnlink(kind, row.linkedId!)}
            >
              {t('catalogTab.unlink')}
            </Button>
          </div>
        ) : !row.key ? (
          // A blank source value has no usable link key: offer no link/create, since an empty
          // key would match every unresolved record on the next poll.
          <span className="justify-self-end text-[13px] text-muted-foreground">{t('catalogTab.blankKeyPlaceholder')}</span>
        ) : (
          <div className="flex items-center gap-2 justify-end min-w-0">
            <CatalogLinkCombobox
              optionLabel={row.display}
              existing={existing}
              onCreate={() => onCreate(kind, row)}
              onLink={(id) => onLink(kind, row, id)}
              disabled={disabled}
              ariaLabel={t('catalogTab.linkAriaLabel', { noun: translatedNoun, display: row.display })}
              searchPlaceholder={t('catalogTab.linkSearchPlaceholder', { noun: translatedNoun })}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-[30px] shrink-0 gap-1.5"
              disabled={disabled}
              onClick={() => onCreate(kind, row)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> {t('catalogTab.create')}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-border">
        <h3 className="text-[17px] font-semibold tracking-tight">{t('catalogTab.title')}</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {t('catalogTab.description')}
        </p>
      </div>

      {/* Toolbar: search + filter + bulk create */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
        <div className="relative w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('catalogTab.searchPlaceholder')}
            aria-label={t('catalogTab.searchAriaLabel')}
            className="h-8 pl-8 bg-muted text-sm"
          />
        </div>
        <div className="inline-flex gap-0.5 p-0.5 rounded-md bg-muted">
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={active}
                className={cn(
                  "h-[26px] px-2.5 rounded text-xs font-medium",
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {t(`catalogTab.filters.${f}`)}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        {creatableCount > 0 && (
          <>
            <span className="text-xs text-muted-foreground">{t('catalogTab.selectedCount', { count: creatableCount })}</span>
            <Button size="sm" className="h-[26px]" disabled={disabled} onClick={handleBulkCreate}>
              {t('catalogTab.createCount', { count: creatableCount })}
            </Button>
          </>
        )}
      </div>

      {/* Programs section */}
      <p className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground bg-muted border-b border-border">
        {t('catalogTab.programsSection', { source: programSource })}
      </p>
      {filteredPrograms.map((row) => renderRow("program", row, programExisting, "show"))}

      {/* Cities section */}
      <p className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground bg-muted border-b border-border">
        {t('catalogTab.citiesSection', { source: citySource })}
      </p>
      {filteredCities.map((row) => renderRow("city", row, cityExisting, "city"))}

      {/* Merge-suggestion footer */}
      {merge && (
        <div className="flex items-center gap-3 px-4 py-3 bg-muted">
          <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium">{merge.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{merge.description}</p>
          </div>
          <Button variant="outline" size="sm" className="h-[26px] shrink-0" disabled={disabled} onClick={merge.onMerge}>
            {merge.actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
