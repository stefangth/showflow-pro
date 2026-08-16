import type { ProducerDateEntry } from './types';
import { sessionLabel } from './time';

export type AgendaGrouping = 'per-date' | 'per-show';

export interface AgendaRow {
  key: string; // unique per rendered row
  entry: ProducerDateEntry; // booking state lives on the entry (per show_date)
  time: string; // HH:MM (or '')
  extraSessions: number; // per-date: folded extra sessions; per-show: always 0
  showAction: boolean; // render the row's action button? (first row of an entry only)
}

/**
 * Expands one `ProducerDateEntry` (a `show_date`, which can carry up to 3
 * performances via `session_1/2/3`) into the row(s) the Agenda lens renders.
 *
 * `per-date`: always exactly one row — `session1`'s time plus a folded count
 * of any additional non-null sessions (`extraSessions`), rendered as the
 * inline purple `+N` badge. The production keeps its own single row with its
 * status badge + action.
 *
 * `per-show`: one row per non-null session (mirrors the Week lens), each with
 * its own time and `extraSessions: 0` — the `+N` badge only makes sense when
 * sessions are folded together. Only the first row shows the action button
 * (`showAction`), so follow-on performance rows don't duplicate it. An entry
 * with no sessions at all still renders a single `-s0` row so it isn't lost.
 */
export function buildAgendaRows(entry: ProducerDateEntry, mode: AgendaGrouping): AgendaRow[] {
  if (mode === 'per-date') {
    const extra = [entry.session2, entry.session3].filter(Boolean).length;
    return [{ key: entry.id, entry, time: sessionLabel(entry.session1), extraSessions: extra, showAction: true }];
  }
  const sessions: { n: 1 | 2 | 3; v: string | null }[] = [
    { n: 1, v: entry.session1 },
    { n: 2, v: entry.session2 },
    { n: 3, v: entry.session3 },
  ].filter((s): s is { n: 1 | 2 | 3; v: string } => s.v != null);
  if (sessions.length === 0) {
    return [{ key: `${entry.id}-s0`, entry, time: '', extraSessions: 0, showAction: true }];
  }
  return sessions.map((s, i) => ({
    key: `${entry.id}-s${s.n}`,
    entry,
    time: sessionLabel(s.v),
    extraSessions: 0,
    showAction: i === 0,
  }));
}
