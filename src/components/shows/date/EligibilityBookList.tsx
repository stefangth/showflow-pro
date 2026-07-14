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

/**
 * Direct-mode booking list: shows every eligible artist for a show date with a
 * single Book action (+ an optional "book as understudy" toggle). Replaces the
 * tiered-offer flow for orgs that book directly instead of running open offers.
 * Booking is consequential (books AND confirms in one step), so the action sits
 * behind a confirmation dialog like the surface's other destructive/committing
 * actions. Pure presentational — the caller (ShowDateDetailSheet) owns the
 * booking mutation and passes the current booked-artist set + pending state.
 */
export function EligibilityBookList({ artists, bookedArtistIds, onBook, booking, loading = false, error = false }: {
  artists: { id: string; name: string }[];
  bookedArtistIds: Set<string>;
  onBook: (artistId: string, isUnderstudy: boolean) => void;
  booking: boolean;
  loading?: boolean;
  error?: boolean;
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
