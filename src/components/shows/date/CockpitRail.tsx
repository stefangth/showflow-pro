import { Clock, MapPin, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActivityItem, UpNextItem } from "@/lib/bookingCockpit";

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
  /** Read-only org custom fields (Airtable-synced or manually configured)
   *  for this show_date, already formatted for display. Omitted/empty hides
   *  the section entirely. */
  customFields?: Array<{ key: string; label: string; value: string }>;
  /** Lower-priority engine signals (digest-send, auto-escalate). The time-
   *  critical offers-expiry lives in the header status line, not here. */
  upNext?: UpNextItem[];
  activity: ActivityItem[]; // pre-derived (buildActivity); rail formats iso
  chatUnread: number;
  chatPreview: string | null;
  /** Jump to the Chat tab. When there is no live preview yet, the teaser is a
   *  neutral affordance rather than a (possibly false) "No messages yet". */
  onOpenChat?: () => void;
  onEditSetup: () => void; // jump to Setup tab
  /** Hidden for roles without a Setup tab (e.g. artists). Defaults to shown. */
  showEditSetup?: boolean;
}

// The booking clock is Berlin-anchored (digest hours, expiry windows), so the
// activity column buckets and formats in Europe/Berlin — not the viewer's local
// timezone, which would flip the day/time near midnight for non-Berlin viewers.
const BERLIN_TZ = "Europe/Berlin";
const berlinDayKey = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BERLIN_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const berlinClock = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: BERLIN_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const berlinDayMonth = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: BERLIN_TZ, day: "2-digit", month: "short" }).format(d);

/** ISO timestamp -> compact mono stamp for the activity column: a Berlin clock
 *  time ("11:04") when the entry falls on the same Berlin day as the newest one,
 *  else a Berlin date ("09 Mar"). Failures fall back to the raw string. */
function shortStamp(iso: string, newestIso?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (newestIso) {
    const newest = new Date(newestIso);
    if (!Number.isNaN(newest.getTime()) && berlinDayKey(d) === berlinDayKey(newest)) {
      return berlinClock(d);
    }
  }
  return berlinDayMonth(d);
}

/** Swap straight quotes for typographic ones so chat previews read like the
 *  designed reference ("..." -> "..."). Purely presentational. */
function smartQuotes(text: string): string {
  return text
    .replace(/(^|[\s([{<])"/g, "$1“")
    .replace(/"/g, "”")
    .replace(/(^|[\s([{<])'/g, "$1‘")
    .replace(/'/g, "’");
}

const Divider = () => <div className="h-px bg-[var(--line)]" />;

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-semibold uppercase leading-[14px] tracking-[1.6px] text-muted-foreground">{children}</p>
);

/** The cockpit's left rail: date facts, eligibility chips, a derived activity
 *  feed, and a chat teaser, separated by hairline dividers. Purely presentational. */
const UP_NEXT_DOT: Record<UpNextItem["tone"], string> = {
  violet: "bg-accent-500",
  amber: "bg-[var(--amber-600)]",
  neutral: "bg-[var(--text-faint)]",
};

export function CockpitRail({
  times, venue, city, source, notes, castChips, skillChips, customFields = [], upNext = [], activity,
  chatUnread, chatPreview, onOpenChat, onEditSetup, showEditSetup = true,
}: CockpitRailProps) {
  const { t } = useTranslation("showsDetail");
  return (
    <aside className="w-full shrink-0 space-y-4 border-b border-[var(--line)] bg-[var(--surface-2)] p-[18px] lg:w-72 lg:border-b-0 lg:border-r">
      {/* Date facts */}
      <div className="space-y-2">
        <SectionLabel>{t("cockpitRail.date")}</SectionLabel>
        <div className="space-y-[7px] text-[13px] text-muted-foreground">
          {times && (
            <p className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono text-xs">{times}</span>
            </p>
          )}
          {(venue || city) && (
            <p className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {[venue, city].filter(Boolean).join(", ")}
            </p>
          )}
          <p className="flex items-center gap-2">
            <Ticket className="h-3.5 w-3.5 shrink-0" />
            {source === "airtable" ? t("cockpitRail.airtableLocked") : t("cockpitRail.manualEntry")}
          </p>
          {notes && <p className="pt-0.5 text-xs italic text-muted-foreground">{notes}</p>}
        </div>
      </div>

      <Divider />

      {customFields.length > 0 && (
        <>
          <div className="space-y-2">
            <SectionLabel>{t("cockpitRail.details")}</SectionLabel>
            <dl className="space-y-1.5 text-xs">
              {customFields.map((f) => (
                <div key={f.key} className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="text-right font-medium text-foreground">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <Divider />
        </>
      )}

      {/* Eligibility */}
      <div className="space-y-2">
        <SectionLabel>{t("cockpitRail.eligibility")}</SectionLabel>
        {castChips.length === 0 && skillChips.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("cockpitRail.noRestrictions")}</p>
        ) : (
          <div className="flex flex-wrap gap-[5px]">
            {castChips.map((c) =>
              c.kind === "inherited" ? (
                <span
                  key={`inherited-${c.label}`}
                  className="rounded-[var(--radius-xs)] border-[0.5px] border-[var(--line-strong)] px-[7px] py-[3px] text-xs text-muted-foreground"
                >
                  {c.label} <span className="opacity-60">{t("cockpitRail.inherited")}</span>
                </span>
              ) : (
                <span
                  key={`override-${c.label}`}
                  className="rounded-[var(--radius-xs)] bg-[var(--surface-3)] px-[7px] py-[3px] text-xs font-medium text-foreground"
                >
                  {c.label}
                </span>
              ),
            )}
            {skillChips.map((s) => (
              <span
                key={s}
                className="rounded-[var(--radius-xs)] bg-accent-100 px-[7px] py-[3px] text-xs font-medium text-accent-700"
              >
                {s}
              </span>
            ))}
          </div>
        )}
        {showEditSetup && (
          <Button
            variant="outline"
            size="sm"
            className="mt-1 h-[30px] w-full rounded-[var(--radius-m)] border-[0.5px] border-[var(--line-strong)] bg-[var(--surface)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
            onClick={onEditSetup}
          >
            {t("cockpitRail.editDateSetup")}
          </Button>
        )}
      </div>

      {upNext.length > 0 && (
        <>
          <Divider />
          <div className="space-y-2">
            <SectionLabel>{t("cockpitRail.upNext")}</SectionLabel>
            <div className="flex flex-col items-start gap-1.5">
              {upNext.map((it, i) => (
                <span
                  key={`${it.tone}-${i}`}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border-[0.5px] border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-1 text-xs text-muted-foreground"
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", UP_NEXT_DOT[it.tone])} />
                  {it.text}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {activity.length > 0 && (
        <>
          <Divider />
          <div className="space-y-2.5">
            <SectionLabel>{t("cockpitRail.activity")}</SectionLabel>
            <ul data-testid="cockpit-activity" className="space-y-[11px]">
              {activity.map((a, i) => (
                <li key={`${a.iso}-${i}`} className="grid grid-cols-[46px_1fr] gap-2">
                  <span className="font-mono text-[11px] font-medium leading-4 text-[var(--text-faint)]">{shortStamp(a.iso, activity[0]?.iso)}</span>
                  <span className="text-xs leading-4 text-muted-foreground">{a.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <Divider />

      {/* Chat teaser */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>{t("cockpitRail.chat")}</SectionLabel>
          {chatUnread > 0 && (
            <span
              data-testid="chat-unread"
              className="rounded-[var(--radius-xs)] bg-accent-500 px-1.5 py-px font-mono text-[10px] font-semibold leading-[15px] text-white"
            >
              {chatUnread}
            </span>
          )}
        </div>
        {chatPreview ? (
          <p className="text-xs leading-[17px] text-muted-foreground">{smartQuotes(chatPreview)}</p>
        ) : onOpenChat ? (
          <button
            type="button"
            onClick={onOpenChat}
            className="text-left text-[13px] font-medium text-accent-text hover:underline"
          >
            {t("cockpitRail.openChat")}
          </button>
        ) : (
          <p className="text-xs leading-[17px] text-muted-foreground">{t("cockpitRail.messageCast")}</p>
        )}
      </div>
    </aside>
  );
}
