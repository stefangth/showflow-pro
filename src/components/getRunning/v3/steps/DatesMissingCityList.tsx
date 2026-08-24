import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCities } from "@/hooks/useCities";
import { useDatesMissingCity, useUpdateShowDate } from "@/hooks/useShowDates";
import { StatusDot } from "@/components/ui/status-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateDMY } from "@/lib/dates";
import { ROUTES } from "@/config/app.config";

/**
 * The cities step's manual/sheet body: every future, non-cancelled date in the org that
 * carries no city, each with a city picker (Wireflow v3, "Get running truthful completion",
 * Task 4).
 *
 * This exists because the step used to resolve only *imported Airtable* city strings. On the
 * by-hand and sheet paths that list is always empty, so a step flagged "Blocks your first ask"
 * rendered "No cities to resolve yet" while a real date genuinely had no city, and its
 * Continue collapsed the wizard without changing anything. Here the step can clear its own
 * block: pick a city, the row resolves, the blocking counter drops.
 *
 * The row list and the step's Continue gate read the SAME query (`useDatesMissingCity`, one
 * cache entry shared with the parent `CitiesStep`), so the list can never disagree with what
 * Continue is waiting on. Writes go through the existing `useUpdateShowDate` mutation, whose
 * `["show-dates"]` prefix invalidation refreshes this list.
 *
 * Cities are org-wide and are NOT created here: a city that does not exist yet is added in
 * Settings, which the footer link points at. A resolved row keeps a confirmed dot until the
 * refetch drops it, so a pick reads as landed rather than as a row vanishing.
 */
export function DatesMissingCityList({ orgId, canEdit }: { orgId: string | null; canEdit: boolean }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const dates = useDatesMissingCity(orgId);
  const cities = useCities();
  const update = useUpdateShowDate();
  // Rows picked in this session, kept until the refetch removes them, so the dot can flip to
  // confirmed instead of the row simply disappearing under the pointer.
  const [resolved, setResolved] = useState<Record<string, string>>({});

  if (dates.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const rows = dates.data ?? [];
  const cityOptions = cities.data ?? [];

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-control font-semibold text-foreground">{t("body.cities.missingHeading")}</div>
        <p className="text-xs text-muted-foreground">{t("body.cities.missingSub")}</p>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-l border border-border">
        {rows.map((row) => {
          const picked = resolved[row.id];
          return (
            <li key={row.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <StatusDot tone={picked ? "confirmed" : "risk"} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-control font-medium text-foreground">
                  {row.show?.program ?? t("body.cities.missingUnknownProduction")}
                </div>
                <div className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                  {formatDateDMY(row.date)}
                  {row.venue ? ` ${row.venue}` : ""}
                </div>
              </div>
              <Select
                value={picked ?? undefined}
                disabled={!canEdit || update.isPending}
                onValueChange={(cityId) => {
                  setResolved((prev) => ({ ...prev, [row.id]: cityId }));
                  update.mutate({ id: row.id, patch: { city_id: cityId } });
                }}
              >
                <SelectTrigger className="w-40" aria-label={t("body.cities.assignCity")}>
                  <SelectValue placeholder={t("body.cities.assignCity")} />
                </SelectTrigger>
                <SelectContent>
                  {cityOptions.map((city) => (
                    <SelectItem key={city.id} value={city.id}>
                      {city.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          );
        })}
      </ul>

      <Link
        to={`${ROUTES.SETTINGS}?tab=casts-coverage`}
        className="inline-block text-control font-medium text-accent-600 underline-offset-2 hover:underline"
      >
        {t("body.cities.manageLink")}
      </Link>
    </div>
  );
}
