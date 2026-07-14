import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Direct-mode booking list: shows every eligible artist for a show date with a
 * single Book action (+ an optional "book as understudy" toggle). Replaces the
 * tiered-offer flow for orgs that book directly instead of running open offers.
 * Pure presentational — the caller (ShowDateDetailSheet, wired in a later task)
 * owns the booking mutation and passes the current booked-artist set + pending state.
 */
export function EligibilityBookList({ artists, bookedArtistIds, onBook, booking }: {
  artists: { id: string; name: string }[];
  bookedArtistIds: Set<string>;
  onBook: (artistId: string, isUnderstudy: boolean) => void;
  booking: boolean;
}) {
  const [understudy, setUnderstudy] = useState(false);
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
            <Button size="sm" variant="outline" disabled={booking} onClick={() => onBook(a.id, understudy)}>
              Book
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
