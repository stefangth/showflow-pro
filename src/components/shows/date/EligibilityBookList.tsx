import { useState } from "react";
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
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * The direct-book list's requirement-as-fact sentence (design 1h). Direct mode never offers
 * anything, so the list's old "Only offer to artists with" framing was actively wrong here;
 * this states what the date requires and how the roster measures up, as a fact rather than
 * an instruction. `qualifying` is the caller's already-filtered `artists` count (this list
 * IS the qualifying, unblocked set) against `total`, the full artist pool.
 */
function requirementFactSentence(requiredSkillNames: string[], qualifying: number, total: number): string {
  const requirement = requiredSkillNames.length > 0
    ? `This date requires ${joinNames(requiredSkillNames)}`
    : "This date has no skill requirements";
  return `${requirement} · ${qualifying} of ${total} artists qualify and are not blocked.`;
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
  requiredSkillNames, totalArtistCount,
}: {
  /** `skillIds` is optional and only needed to compute each narrowing chip's per-skill
   *  count; omit it and chips still render, just without live counts. */
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
}) {
  const [understudy, setUnderstudy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the eligible artists. Reload the page to try again.</AlertDescription>
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
        Book as understudy
      </label>
      {typeof totalArtistCount === "number" && (
        <p className="text-xs text-muted-foreground">
          {requirementFactSentence(requiredSkillNames ?? [], artists.length, totalArtistCount)}
        </p>
      )}
      {skills && skills.length > 0 && onSkillFilterChange && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Narrow the list further</p>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s) => {
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
                  <span className="font-mono text-[11px] opacity-75">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {unrestricted && orgName && (
        <p className="text-xs text-muted-foreground">{unrestrictedEligibilityNote(orgName)}</p>
      )}
      {artists.length === 0 && (
        <p className="text-sm text-muted-foreground">No eligible artists for this date. Check casts and city in Settings.</p>
      )}
      {artists.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-lg border border-border p-3">
          <p className="text-sm font-medium">{a.name}</p>
          {bookedArtistIds.has(a.id) ? (
            <Badge variant="secondary" className="bg-muted text-muted-foreground">Booked</Badge>
          ) : (
            <Button size="sm" variant="outline" disabled={booking} onClick={() => setConfirmTarget(a)}>
              Book
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
                    ? `Book ${confirmTarget.name} as understudy for this date?`
                    : `Book ${confirmTarget.name} for this date?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {understudy
                    ? `This books and confirms ${confirmTarget.name} as understudy immediately. There is no offer step in direct booking mode.`
                    : `This books and confirms ${confirmTarget.name} immediately. There is no offer step in direct booking mode.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={booking}
                  onClick={() => {
                    onBook(confirmTarget.id, understudy);
                    setConfirmTarget(null);
                  }}
                >
                  Book and confirm
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
