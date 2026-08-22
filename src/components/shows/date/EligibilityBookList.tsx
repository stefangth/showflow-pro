import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { unrestrictedEligibilityNote } from "@/lib/bookings/actionCopy";

/** Joins strings for prose: "A", "A and B", "A, B, and C". No em dashes (house style). */
function joinNames(t: TFunction<"showsDetail">, names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return t("eligibilityBookList.joinTwo", { a: names[0], b: names[1] });
  return t("eligibilityBookList.joinMany", { list: names.slice(0, -1).join(", "), last: names[names.length - 1] });
}

/**
 * The direct-book list's requirement-as-fact sentence (design 1h). Direct mode never offers
 * anything, so the list's old "Only offer to artists with" framing was actively wrong here;
 * this states what the date requires and how the roster measures up, as a fact rather than
 * an instruction. `qualifying` is the caller's already-filtered `artists` count (this list
 * IS the qualifying, unblocked set) against `total`, the full artist pool.
 */
function requirementFactSentence(t: TFunction<"showsDetail">, requiredSkillNames: string[], qualifying: number, total: number): string {
  const requirement = requiredSkillNames.length > 0
    ? t("eligibilityBookList.reqHasSkills", { skills: joinNames(t, requiredSkillNames) })
    : t("eligibilityBookList.reqNoSkills");
  return t("eligibilityBookList.factSentence", { requirement, qualifying, total });
}

/**
 * Direct-mode booking list: shows every eligible artist for a show date with a
 * single Book action (+ an optional "book as understudy" toggle). Replaces the
 * tiered-offer flow for orgs that book directly instead of running open offers.
 * Booking is consequential (books AND confirms in one step), so the action sits
 * behind a confirmation dialog like the surface's other destructive/committing
 * actions. Pure presentational — the caller (ShowDateDetailSheet) owns the
 * booking mutation and passes the current booked-artist set + pending state.
 */
export function EligibilityBookList({
  artists, bookedArtistIds, onBook, booking, loading = false, error = false,
  skills, selectedSkillIds, onSkillFilterChange, unrestricted = false, orgName,
  requiredSkillNames, totalArtistCount, requiredSkillIds,
}: {
  /** `skillIds` is optional. When at least one listed artist carries it, each narrowing
   *  chip shows a live per-skill count computed from this list. When no artist carries it
   *  (the caller has not wired skill data through), the count is hidden rather than shown
   *  as a false "0". */
  artists: { id: string; name: string; skillIds?: string[] }[];
  bookedArtistIds: Set<string>;
  onBook: (artistId: string, isUnderstudy: boolean) => void;
  booking: boolean;
  loading?: boolean;
  error?: boolean;
  skills?: { id: string; name: string }[];
  selectedSkillIds?: string[];
  onSkillFilterChange?: (skillId: string) => void;
  /** True when the date's eligibility has no cast/city restriction — deriveDirectBookList
   *  (src/lib/bookings.ts) then opens `artists` to the whole active roster. */
  unrestricted?: boolean;
  /** Needed only to name the org in the unrestricted note; omit and the note stays silent. */
  orgName?: string | null;
  /** Names of the skills this date requires, for the requirement-as-fact sentence (design
   *  1h). Pass `[]` (not undefined) to state explicitly that the date requires none. */
  requiredSkillNames?: string[];
  /** Size of the full artist pool the qualifying count (`artists.length`) is measured
   *  against. Omit (along with requiredSkillNames) to skip the sentence entirely. */
  totalArtistCount?: number;
  /** Ids of the skills this date already requires. The narrowing chips (design 1h) are
   *  EXTRA skills only, so these are excluded from the chip list: a required skill is
   *  never a useful narrower (every qualifying artist already holds it). Omit to render
   *  every listed skill as a chip. */
  requiredSkillIds?: string[];
}) {
  const { t } = useTranslation("showsDetail");
  const { t: tAction } = useTranslation("bookingCopy");
  const [understudy, setUnderstudy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t("eligibilityBookList.error")}</AlertDescription>
      </Alert>
    );
  }
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={understudy} onCheckedChange={(v) => setUnderstudy(v === true)} />
        {t("eligibilityBookList.bookAsUnderstudy")}
      </label>
      {typeof totalArtistCount === "number" && (
        <p className="text-xs text-muted-foreground">
          {requirementFactSentence(t, requiredSkillNames ?? [], artists.length, totalArtistCount)}
        </p>
      )}
      {skills && onSkillFilterChange && (() => {
        // Design 1h: the narrowing chips are EXTRA (non-required) skills only. An
        // already-required skill is a no-op narrower (every qualifying artist already
        // holds it), so exclude it rather than render a chip whose count is the whole
        // list. When nothing extra remains, drop the whole section (no empty heading).
        const requiredSet = new Set(requiredSkillIds ?? []);
        const narrowSkills = skills.filter((s) => !requiredSet.has(s.id));
        if (narrowSkills.length === 0) return null;
        // Only claim a count when at least one listed artist actually carries skillIds —
        // otherwise every chip would read a hard-coded "0", which is a false claim rather
        // than an honest "we don't know" (a caller that hasn't wired skill data through
        // still gets working, just uncounted, chips).
        const hasSkillData = artists.some((a) => a.skillIds !== undefined);
        return (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("eligibilityBookList.narrowList")}</p>
            <div className="flex flex-wrap gap-1.5">
              {narrowSkills.map((s) => {
                const on = (selectedSkillIds ?? []).includes(s.id);
                const count = artists.filter((a) => (a.skillIds ?? []).includes(s.id)).length;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onSkillFilterChange(s.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                      on
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.name}
                    {hasSkillData && (
                      <span className="font-mono text-eyebrow opacity-75">{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}
      {unrestricted && orgName && (
        <p className="text-xs text-muted-foreground">{unrestrictedEligibilityNote(orgName, tAction)}</p>
      )}
      {artists.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("eligibilityBookList.noEligible")}</p>
      )}
      {artists.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-l border border-border p-3">
          <p className="text-sm font-medium">{a.name}</p>
          {bookedArtistIds.has(a.id) ? (
            <Badge variant="secondary" className="bg-well-tint text-muted-foreground">{t("eligibilityBookList.booked")}</Badge>
          ) : (
            <Button size="sm" variant="outline" disabled={booking} onClick={() => setConfirmTarget(a)}>
              {t("eligibilityBookList.book")}
            </Button>
          )}
        </div>
      ))}

      {/* Direct booking has no offer step: confirm before committing the artist. */}
      <AlertDialog open={confirmTarget !== null} onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}>
        <AlertDialogContent>
          {confirmTarget && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {understudy
                    ? t("eligibilityBookList.bookUnderstudyTitle", { name: confirmTarget.name })
                    : t("eligibilityBookList.bookTitle", { name: confirmTarget.name })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {understudy
                    ? t("eligibilityBookList.bookUnderstudyDesc", { name: confirmTarget.name })
                    : t("eligibilityBookList.bookDesc", { name: confirmTarget.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("eligibilityBookList.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={booking}
                  onClick={() => {
                    onBook(confirmTarget.id, understudy);
                    setConfirmTarget(null);
                  }}
                >
                  {t("eligibilityBookList.bookAndConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
