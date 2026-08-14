import type { SyncLogSummary, UnresolvedRecord } from "@/data/airtableSync";
import type { AirtableSettings } from "@/data/airtableSettings";
import type { AirtableFieldMap } from "@/data/airtableMapping";
import { nextSyncAt, formatInterval } from "@/lib/airtablePoll";

export type ConsoleMode = "setup" | "healthy" | "live" | "error";
export type HeldCategory = "missing_date" | "unlinked_program" | "unlinked_city" | "unrecognized";
/** The concrete causes the poll's held reasons encode (excludes the UI-only "unrecognized" bucket). */
export type KnownHeldCategory = Exclude<HeldCategory, "unrecognized">;
export type StatusTone = "green" | "amber" | "red";

export interface StatusView {
  tone: StatusTone;
  headline: string;
  line: string;
}

export interface Kpi {
  label: string;
  value: string;
  sub: string;
  tone: "default" | StatusTone;
}

export interface HeldCause {
  category: HeldCategory;
  icon: string;
  title: string;
  detail: string;
  optionCount: number;
  recordCount: number;
  records: UnresolvedRecord[];
}

/** Local wall-clock time for an ISO string, or "not yet" when there is none. */
export function runClock(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "not yet";
}

/** Map a raw sync-log status to a display badge. */
export function statusBadge(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case "success":
      return { label: "ok", tone: "green" };
    case "partial":
      return { label: "partial", tone: "amber" };
    case "error":
      return { label: "failed", tone: "red" };
    default:
      return { label: status, tone: "amber" };
  }
}

/** Which top-level state the console renders. */
export function deriveMode(a: {
  keyPresent: boolean;
  hasBaseTable: boolean;
  latest: SyncLogSummary | null;
}): ConsoleMode {
  if (!a.keyPresent || !a.hasBaseTable) return "setup";
  if (a.latest?.status === "error") return "error";
  if (a.latest == null || (a.latest.status === "success" && (a.latest.held_count ?? 0) === 0))
    return "healthy";
  return "live";
}

/** The headline status card copy for a given mode. */
export function deriveStatus(latest: SyncLogSummary | null, mode: ConsoleMode): StatusView {
  if (mode === "error") {
    return {
      tone: "red",
      headline: "Sync is failing",
      line: latest?.error_details
        ? `The last run failed. ${latest.error_details}`
        : "The last run failed. Airtable rejected the request.",
    };
  }
  if (mode === "healthy") {
    return {
      tone: "green",
      headline: "Syncing normally",
      line: latest
        ? `Last run ${runClock(latest.synced_at)} brought in ${latest.imported_count ?? 0} dates: ${latest.new_count ?? 0} new, ${latest.updated_count ?? 0} updated. Every record resolved.`
        : "Not synced yet. The next run will bring in dates.",
    };
  }
  const held = latest?.held_count ?? 0;
  return {
    tone: "amber",
    headline: `Syncing, ${held} ${held === 1 ? "record" : "records"} held`,
    line: `Last run ${runClock(latest?.synced_at ?? null)} brought in ${latest?.imported_count ?? 0} dates: ${latest?.new_count ?? 0} new, ${latest?.updated_count ?? 0} updated. ${held} ${held === 1 ? "record" : "records"} could not resolve and are waiting on a catalog link.`,
  };
}

/** The four KPI tiles, always length 4. */
export function deriveKpis(
  latest: SyncLogSummary | null,
  settings: AirtableSettings,
  recent: SyncLogSummary[] = [],
): Kpi[] {
  if (latest?.status === "error") {
    return [
      { label: "Last run", value: runClock(latest.synced_at), sub: "failed", tone: "red" },
      {
        label: "Last clean run",
        value: runClock(recent.find((r) => r.status === "success")?.synced_at ?? null),
        sub: "",
        tone: "default",
      },
      { label: "Dates in", value: "0", sub: "since last run", tone: "default" },
      { label: "Held", value: String(latest.held_count ?? 0), sub: "", tone: "default" },
    ];
  }

  const held = latest?.held_count ?? 0;
  return [
    { label: "Last run", value: runClock(latest?.synced_at ?? null), sub: "today", tone: "default" },
    {
      label: "Next run",
      value: runClock(
        latest?.synced_at
          ? (nextSyncAt(latest.synced_at, settings.airtable_poll_interval_minutes)?.toISOString() ?? null)
          : null,
      ),
      sub: `every ${formatInterval(settings.airtable_poll_interval_minutes)}`,
      tone: "default",
    },
    {
      label: "Dates in",
      value: String(latest?.imported_count ?? 0),
      sub: `${latest?.new_count ?? 0} new · ${latest?.updated_count ?? 0} updated`,
      tone: "default",
    },
    {
      label: "Held",
      value: String(held),
      sub: held > 0 ? "waiting on a link" : "all resolved",
      tone: held > 0 ? "amber" : "green",
    },
  ];
}

interface CauseAccumulator {
  category: HeldCategory;
  records: UnresolvedRecord[];
  options: Set<string>;
}

/** Parse a poll held reason into its category + the option name it names (for program/city).
 *  Returns null when the reason isn't one of the recognized formats. Single source of truth
 *  for held-reason parsing on the frontend (used by both groupHeldCauses and the tab's
 *  per-option hold-count attribution), mirroring categorizeHeldReason in airtable-poll. */
export function parseHeldReason(
  reason: string | null,
): { category: KnownHeldCategory; option: string | null } | null {
  if (!reason) return null;
  if (reason === "missing date") return { category: "missing_date", option: null };
  const prog = /^program '(.*)' not linked$/.exec(reason);
  if (prog) return { category: "unlinked_program", option: prog[1] };
  const city = /^city '(.*)' not linked$/.exec(reason);
  if (city) return { category: "unlinked_city", option: city[1] };
  return null;
}

/** Group held records into per-cause buckets, ordered program, city, date, then a catch-all
 *  "unrecognized" bucket so a reason string the poll adds later still surfaces (never silently
 *  dropped, which would leave a nonzero Held KPI with no visible explanation). */
export function groupHeldCauses(held: UnresolvedRecord[]): HeldCause[] {
  const buckets = new Map<HeldCategory, CauseAccumulator>();

  for (const rec of held) {
    if (rec.action !== "held_unresolved") continue;
    const parsed = parseHeldReason(rec.reason);
    const category: HeldCategory = parsed ? parsed.category : "unrecognized";

    let acc = buckets.get(category);
    if (!acc) {
      acc = { category, records: [], options: new Set<string>() };
      buckets.set(category, acc);
    }
    acc.records.push(rec);
    if (parsed?.option && category !== "missing_date") {
      acc.options.add(parsed.option);
    }
  }

  const order: HeldCategory[] = ["unlinked_program", "unlinked_city", "missing_date", "unrecognized"];
  const icons: Record<HeldCategory, string> = {
    unlinked_program: "theater",
    unlinked_city: "map-pin",
    missing_date: "calendar",
    unrecognized: "alert-triangle",
  };

  const causes: HeldCause[] = [];
  for (const category of order) {
    const acc = buckets.get(category);
    if (!acc) continue;
    const recordCount = acc.records.length;
    const optionCount = category === "unlinked_program" || category === "unlinked_city" ? acc.options.size : 0;
    let title: string;
    if (category === "unlinked_program") {
      title = `${optionCount} program ${optionCount === 1 ? "option has" : "options have"} no catalog show`;
    } else if (category === "unlinked_city") {
      title = `${optionCount} city ${optionCount === 1 ? "option has" : "options have"} no catalog city`;
    } else if (category === "missing_date") {
      title = `${recordCount} ${recordCount === 1 ? "record has" : "records have"} an empty date cell`;
    } else {
      title = `${recordCount} ${recordCount === 1 ? "record is" : "records are"} held for an unrecognized reason`;
    }
    causes.push({
      category,
      icon: icons[category],
      title,
      detail: `holding ${recordCount} ${recordCount === 1 ? "record" : "records"}`,
      optionCount,
      recordCount,
      records: acc.records,
    });
  }
  return causes;
}

/** How many of the required mapping slots are filled. */
export function requiredMappedCount(fieldMap: AirtableFieldMap): { mapped: number; total: number } {
  const slots = [
    "date",
    "program",
    "sub_program",
    "city",
    "venue",
    "session_1",
    "session_2",
    "session_3",
    "status_field",
  ];
  const map = fieldMap as Record<string, unknown>;
  const mapped = slots.filter((k) => !!map[k]).length;
  return { mapped, total: slots.length };
}
