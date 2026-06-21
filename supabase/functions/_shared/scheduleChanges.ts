/** Pure helpers for schedule-change detection/coalescing, shared by the
 *  confirmation digest and the digest email template. No I/O. */

export type SessionChangeKind = "session_added" | "session_removed" | "session_retimed";

export interface ChangeLogRow {
  id: string;
  show_date_id: string;
  change_type: "cancelled" | SessionChangeKind;
  session_slot: number | null;
  old_value: string | null; // 'HH:MM[:SS]' or null
  new_value: string | null;
  created_at: string; // ISO; used only for ordering
}

export interface CoalescedSession {
  slot: number;
  kind: SessionChangeKind;
  old: string | null;
  new: string | null;
}

export interface CoalescedDateChange {
  showDateId: string;
  cancelled: boolean;
  sessions: CoalescedSession[];
}

/** Classify one slot's old→new transition; null when unchanged. */
export function classifySessionChange(oldVal: string | null, newVal: string | null): SessionChangeKind | null {
  if (oldVal === newVal) return null;
  if (oldVal === null) return "session_added";
  if (newVal === null) return "session_removed";
  return "session_retimed";
}

/** 'HH:MM:SS' | 'HH:MM' → 'HH:MM'; null → '—'. */
export function fmtTime(t: string | null): string {
  return t ? t.slice(0, 5) : "—";
}

/** Coalesce many change-log rows into one net summary per show_date:
 *  - any 'cancelled' row makes the date cancelled (session noise dropped);
 *  - otherwise, per slot, net = earliest old + latest new (a reverted slot drops). */
export function coalesceChangeRows(rows: ChangeLogRow[]): CoalescedDateChange[] {
  const byDate = new Map<string, ChangeLogRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.show_date_id);
    if (list) list.push(r); else byDate.set(r.show_date_id, [r]);
  }

  const out: CoalescedDateChange[] = [];
  for (const [showDateId, dateRows] of byDate) {
    if (dateRows.some((r) => r.change_type === "cancelled")) {
      out.push({ showDateId, cancelled: true, sessions: [] });
      continue;
    }
    const bySlot = new Map<number, ChangeLogRow[]>();
    for (const r of dateRows) {
      if (r.session_slot == null) continue;
      const list = bySlot.get(r.session_slot);
      if (list) list.push(r); else bySlot.set(r.session_slot, [r]);
    }
    const sessions: CoalescedSession[] = [];
    for (const [slot, slotRows] of bySlot) {
      const ordered = [...slotRows].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const oldVal = ordered[0].old_value;
      const newVal = ordered[ordered.length - 1].new_value;
      const kind = classifySessionChange(oldVal, newVal);
      if (kind === null) continue; // net no-op
      sessions.push({ slot, kind, old: oldVal, new: newVal });
    }
    if (sessions.length === 0) continue;
    sessions.sort((a, b) => a.slot - b.slot);
    out.push({ showDateId, cancelled: false, sessions });
  }
  return out;
}

/** Human one-liner for one slot change. */
export function describeSessionChange(s: CoalescedSession): string {
  const label = `Session ${s.slot}`;
  if (s.kind === "session_added") return `${label} added (${fmtTime(s.new)})`;
  if (s.kind === "session_removed") return `${label} removed`;
  return `${label} now ${fmtTime(s.new)} (was ${fmtTime(s.old)})`;
}

/** Human summary for a whole date's coalesced change. */
export function describeDateChanges(c: CoalescedDateChange): string {
  if (c.cancelled) return "Date cancelled";
  return c.sessions.map(describeSessionChange).join("; ");
}

/** Adaptive digest subject: neutral when the email carries more than confirmations. */
export function digestEmailSubject(data: { scheduleChanges?: unknown[]; cancellations?: unknown[]; [key: string]: unknown }): string {
  const hasUpdates = (data.scheduleChanges?.length ?? 0) > 0 || (data.cancellations?.length ?? 0) > 0;
  return hasUpdates ? "Your booking updates — Showflow Pro" : "Your bookings are confirmed — Showflow Pro";
}
