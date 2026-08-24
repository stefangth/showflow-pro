import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchActiveArtistOptions } from "@/data/artists";
import { useSkills, useSkillGaps, useSetArtistSkills } from "@/hooks/useSkills";
import { SkillPicker } from "@/components/skills/SkillPicker";
import { StatusPill } from "@/components/ui/status-pill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/app.config";

/**
 * The skills step's real body ("Get running truthful completion", Task 5): every ACTIVE
 * artist with a picker over the org skill catalog, above the catalog manager itself.
 *
 * This exists for the same reason `DatesMissingCityList` does. Task 3 made the step go red
 * when a part requires a skill that no active artist holds, but the step only mounted
 * `SkillsTab`, which manages the skill CATALOG. Creating the skill again cannot clear a gap
 * that is about who HOLDS it, so the step reported a block it had no way to lift. Here it
 * can: toggle the skill onto an artist and the gap drops.
 *
 * The gap read is the shared `useSkillGaps` hook, the same cache entry the board's step
 * state reads, so the callout above and the board's red dot can never disagree.
 *
 * All THREE reads fail CLOSED. A failed gap read renders an error, never a quiet "no gaps";
 * a failed artist read renders an error, never an empty roster that reads as "nobody left
 * to set up"; a failed catalog read renders an error rather than letting every row's
 * `SkillPicker` fall to its empty branch and print "No skills in the catalog yet", which
 * would be a false statement pointing the admin at the wrong fix while the assign path
 * quietly vanished. Writes go through the single `setArtistSkills` data function (shared
 * with `ArtistProfileSheet`), whose mutation busts the skills domain, so the callout
 * refreshes from the same query it was rendered from.
 *
 * The roster is filterable by name and bounded to `VISIBLE_ARTIST_LIMIT` rows until the
 * viewer asks for the rest, so the panel stays usable at the product's 200+ artist scale
 * target.
 */

/** Rows rendered before the viewer asks for the rest. The product targets 200+ active
 *  artists; 200 rows of skill chips inside a wizard step, all re-rendering on every toggle,
 *  is not a usable surface, and the step's job is to fix a handful of artists rather than
 *  to browse the roster. */
const VISIBLE_ARTIST_LIMIT = 25;

export function ArtistSkillAssignList({ orgId, canEdit }: { orgId: string | null; canEdit: boolean }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const gaps = useSkillGaps(orgId);
  const catalog = useSkills();
  const setSkills = useSetArtistSkills();
  const artists = useQuery({
    queryKey: ["artists", "active-options", orgId],
    enabled: !!orgId,
    queryFn: () => fetchActiveArtistOptions(supabase, orgId),
  });

  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);

  const rows = artists.data ?? [];
  const skills = catalog.data ?? [];
  const needle = filter.trim().toLowerCase();
  const matched = needle ? rows.filter((a) => a.name.toLowerCase().includes(needle)) : rows;
  const visible = showAll ? matched : matched.slice(0, VISIBLE_ARTIST_LIMIT);
  // All three reads fail CLOSED. The catalog is the third: without this, an errored
  // useSkills() leaves every row's SkillPicker on its own empty branch, which prints
  // "No skills in the catalog yet" — a false statement that sends an admin to add skills
  // that already exist, while the assign path silently disappears with no error on screen.
  const readFailed = artists.isError || catalog.isError;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-control font-semibold text-foreground">{t("body.skills.assignHeading")}</div>
        <p className="text-xs text-muted-foreground">{t("body.skills.assignSub")}</p>
      </div>

      {gaps.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("body.skills.gapReadError")}</AlertDescription>
        </Alert>
      ) : (gaps.data ?? []).length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription className="space-y-2">
            {(gaps.data ?? []).map((gap) => (
              <div key={gap.skillId} className="flex flex-wrap items-center gap-2">
                <StatusPill tone="risk">{gap.name}</StatusPill>
                <span>
                  {gap.productions.length > 0
                    ? t("body.skills.gapLine", { productions: gap.productions.join(", ") })
                    : t("body.skills.gapLineUnknown")}
                </span>
              </div>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      {readFailed ? (
        <Alert variant="destructive">
          <AlertDescription>
            {artists.isError ? t("body.skills.artistReadError") : t("body.skills.catalogReadError")}
          </AlertDescription>
        </Alert>
      ) : artists.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="space-y-2 rounded-l border border-border bg-well-tint px-3.5 py-6 text-center">
          <p className="text-sm text-muted-foreground">{t("body.skills.noArtists")}</p>
          <Link
            to={`${ROUTES.GET_RUNNING}?step=artists`}
            className="inline-block text-control font-medium text-accent-600 underline-offset-2 hover:underline"
          >
            {t("body.skills.noArtistsLink")}
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {/* A roster at this product's scale target (50+ shows, 200+ artists) must not
              render 200 rows of chips inside a wizard step. Filter by name, and render at
              most VISIBLE_ARTIST_LIMIT until the viewer asks for the rest. */}
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("body.skills.filterPlaceholder")}
            aria-label={t("body.skills.filterPlaceholder")}
            className="h-9 max-w-xs"
          />

          {matched.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("body.skills.filterNoMatch")}</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-l border border-border">
              {visible.map((artist) => (
                <li key={artist.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 truncate text-control font-medium text-foreground">{artist.name}</div>
                  <div className="min-w-0">
                    <SkillPicker
                      skills={skills}
                      selectedIds={artist.skillIds}
                      disabled={!canEdit || setSkills.isPending}
                      emptyHint={t("body.skills.noCatalog")}
                      onToggle={(skillId) => {
                        if (!orgId) return;
                        const held = artist.skillIds.includes(skillId);
                        setSkills.mutate({
                          artistId: artist.id,
                          orgId,
                          add: held ? [] : [skillId],
                          remove: held ? [skillId] : [],
                        });
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {matched.length > visible.length && (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAll(true)}>
              {t("body.skills.showAll", { count: matched.length })}
            </Button>
          )}
        </div>
      )}

      {setSkills.isError && <p className="text-xs text-destructive">{t("body.skills.assignError")}</p>}
    </div>
  );
}
