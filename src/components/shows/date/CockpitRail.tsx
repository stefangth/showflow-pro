import { format } from "date-fns";
import { Clock, MapPin, Database, PenLine, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActivityItem, UpNextItem } from "@/lib/bookingCockpit";
import { UpNextStrip } from "./UpNextStrip";

export interface CockpitRailProps {
  times: string | null; // "14:00 / 19:30"
  venue: string | null;
  city: string | null;
  source: "airtable" | "manual";
  /** Free-text date notes, shown read-only to every role (artists have no other
   *  way to see them — there is no Setup tab / edit dialog for them). */
  notes?: string | null;
  castChips: Array<{ label: string; kind: "inherited" | "override" }>;
  skillChips: string[];
  activity: ActivityItem[]; // pre-derived (buildActivity); rail formats iso
  /** Engine "up next" pills (digest send, expiring offers, auto-escalate). */
  upNext?: UpNextItem[];
  chatUnread: number;
  chatPreview: string | null;
  /** Jump to the Chat tab. When there is no live preview yet, the teaser is a
   *  neutral affordance rather than a (possibly false) "No messages yet". */
  onOpenChat?: () => void;
  onEditSetup: () => void; // jump to Setup tab
  /** Hidden for roles without a Setup tab (e.g. artists). Defaults to shown. */
  showEditSetup?: boolean;
}

/** ISO timestamp -> short "d MMM, HH:mm" for the activity feed. Failures (a
 *  malformed iso) fall back to the raw string rather than throwing. */
function shortStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, "d MMM, HH:mm");
}

const RailSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{title}</p>
    {children}
  </div>
);

/** The cockpit's left rail: date facts, eligibility chips, a derived activity
 *  feed, and a chat teaser. Purely presentational. */
export function CockpitRail({
  times, venue, city, source, notes, castChips, skillChips, activity, upNext = [],
  chatUnread, chatPreview, onOpenChat, onEditSetup, showEditSetup = true,
}: CockpitRailProps) {
  return (
    <aside className="w-full shrink-0 space-y-5 border-b border-border bg-[var(--surface-2)] p-5 lg:w-72 lg:border-b-0 lg:border-r">
      <RailSection title="Date">
        <div className="space-y-1.5 text-sm">
          {times && (
            <p className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {times}
            </p>
          )}
          {venue && (
            <p className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              {venue}
            </p>
          )}
          {city && (
            <p className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              {city}
            </p>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            {source === "airtable" ? "Airtable · locked" : "Manual entry"}
          </p>
          {notes && <p className="pt-0.5 text-xs italic text-muted-foreground">{notes}</p>}
        </div>
      </RailSection>

      <RailSection title="Eligibility">
        {castChips.length === 0 && skillChips.length === 0 ? (
          <p className="text-xs text-muted-foreground">No eligibility restrictions.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {castChips.map((c) => (
              <Badge
                key={`${c.kind}-${c.label}`}
                variant={c.kind === "inherited" ? "outline" : "secondary"}
                className="text-xs"
              >
                {c.label}
              </Badge>
            ))}
            {skillChips.map((s) => (
              <Badge key={s} variant="outline" className="text-xs border-accent-300 text-accent-700">
                {s}
              </Badge>
            ))}
          </div>
        )}
      </RailSection>

      <UpNextStrip items={upNext} />

      {activity.length > 0 && (
        <RailSection title="Activity">
          <ul data-testid="cockpit-activity" className="space-y-1.5">
            {activity.map((a, i) => (
              <li key={`${a.iso}-${i}`} className="text-sm">
                <span className="text-foreground">{a.text}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{shortStamp(a.iso)}</span>
              </li>
            ))}
          </ul>
        </RailSection>
      )}

      <RailSection title="Chat">
        <div className="flex items-start gap-1.5 text-sm">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            {chatUnread > 0 && (
              <Badge data-testid="chat-unread" className="mb-1 h-5 px-1.5 text-[11px]">
                {chatUnread} unread
              </Badge>
            )}
            {chatPreview ? (
              <p className="truncate text-muted-foreground">{chatPreview}</p>
            ) : onOpenChat ? (
              <button
                type="button"
                onClick={onOpenChat}
                className="text-left text-muted-foreground hover:text-foreground"
              >
                Open the Chat tab to message the cast
              </button>
            ) : (
              <p className="text-muted-foreground">Message the cast in the Chat tab</p>
            )}
          </div>
        </div>
      </RailSection>

      {showEditSetup && (
        <Button variant="outline" size="sm" className="w-full" onClick={onEditSetup}>
          <PenLine className="mr-1.5 h-3.5 w-3.5" />
          Edit date setup
        </Button>
      )}
    </aside>
  );
}
