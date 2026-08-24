import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsUpDown, Plus } from "lucide-react";
import type { ResolvedImportRow, ImportCatalogArtist } from "@/lib/hireOrderImport/buildOrderRows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";

/** Per-row smart combobox: search existing artists to link, or create a new one
 *  for this row. Replicates the Popover+Command "link or create" pattern from
 *  AirtableSyncTab's CatalogLinkCombobox (~lines 77-194), adapted to artist rows. */
function RowLinkCombobox({
  artists, onLink, onCreate, disabled, ariaLabel,
}: {
  artists: ImportCatalogArtist[];
  onLink: (id: string, name: string) => void;
  onCreate: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const { t } = useTranslation("hireOrdersPages");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const matches = needle ? artists.filter((a) => a.name.toLowerCase().includes(needle)) : artists;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="w-full justify-between sm:w-[240px]"
          disabled={disabled}
        >
          <span className="truncate text-muted-foreground">{t("resolveStep.linkOrCreate")}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        {/* Manual filtering (shouldFilter=false) so the Create row is always offered. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("resolveStep.searchArtists")} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandGroup>
              <CommandItem value="__create__" onSelect={() => { onCreate(); setOpen(false); setSearch(""); }}>
                <Plus className="mr-2 h-4 w-4" /> {t("resolveStep.createNewArtist")}
              </CommandItem>
            </CommandGroup>
            {matches.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t("resolveStep.linkToExisting")}>
                  {matches.map((a) => (
                    <CommandItem
                      key={a.id}
                      value={a.id}
                      onSelect={() => { onLink(a.id, a.name); setOpen(false); setSearch(""); }}
                    >
                      {a.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {matches.length === 0 && needle !== "" && <CommandEmpty>{t("resolveStep.noMatches")}</CommandEmpty>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A row's local link decision: id + name. Name is carried alongside the id so
 *  the "Linked" state can render immediately after a "Create artist" — the
 *  freshly created artist may not appear in `artists` yet (that list only
 *  refreshes once its own query is invalidated/refetched), so display can't
 *  depend on looking the id back up in that list. */
export interface RowLink {
  id: string;
  name: string;
}

interface Props {
  /** Rows flagged `unknown_artist` by buildOrderRows (never skipped rows). */
  rows: ResolvedImportRow[];
  artists: ImportCatalogArtist[];
  links: Record<number, RowLink>;
  onLink: (rowIndex: number, artistId: string, artistName: string) => void;
  onCreate: (rowIndex: number) => void;
  creatingRowIndex: number | null;
}

/**
 * Resolve step: every row that didn't match a catalog artist by email or name
 * gets a link-or-create combobox. Rows the user has already linked (locally, via
 * `links`) show a "Linked" state instead — the match itself is never re-derived
 * here, only displayed (buildOrderRows has no notion of a user's manual link;
 * that's folded in downstream when the final import rows are built).
 */
export function ResolveStep({ rows, artists, links, onLink, onCreate, creatingRowIndex }: Props) {
  const { t } = useTranslation("hireOrdersPages");
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("resolveStep.allMatched")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("resolveStep.intro", { count: rows.length })}
      </p>
      <div className="rounded-control border border-border">
        {rows.map((row) => {
          const artistName = (row.sheet.artist_name as string | undefined) || t("resolveStep.rowFallback", { index: row.rowIndex });
          const email = row.sheet.recipient_email as string | undefined;
          const link = links[row.rowIndex];
          return (
            <div
              key={row.rowIndex}
              className="flex flex-col gap-2 border-b border-border px-3 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{artistName}</p>
                {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
              </div>
              {link ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{t("resolveStep.linked")}</Badge>
                  <span className="truncate text-sm text-muted-foreground">→ {link.name}</span>
                </div>
              ) : (
                <RowLinkCombobox
                  artists={artists}
                  onLink={(id, name) => onLink(row.rowIndex, id, name)}
                  onCreate={() => onCreate(row.rowIndex)}
                  disabled={creatingRowIndex === row.rowIndex}
                  ariaLabel={t("resolveStep.linkOrCreateAria", { name: artistName })}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
