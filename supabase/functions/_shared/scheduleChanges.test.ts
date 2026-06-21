import { assertEquals } from "./test-asserts.ts";
import {
  classifySessionChange,
  coalesceChangeRows,
  describeDateChanges,
  digestEmailSubject,
  fmtTime,
  type ChangeLogRow,
} from "./scheduleChanges.ts";

const row = (o: Partial<ChangeLogRow>): ChangeLogRow => ({
  id: o.id ?? "r", show_date_id: o.show_date_id ?? "d1",
  change_type: o.change_type ?? "session_retimed", session_slot: o.session_slot ?? 1,
  old_value: o.old_value ?? null, new_value: o.new_value ?? null,
  created_at: o.created_at ?? "2026-06-01T10:00:00Z",
});

Deno.test("classifySessionChange covers add / remove / retime / no-op", () => {
  assertEquals(classifySessionChange(null, "19:00:00"), "session_added");
  assertEquals(classifySessionChange("19:00:00", null), "session_removed");
  assertEquals(classifySessionChange("19:00:00", "20:00:00"), "session_retimed");
  assertEquals(classifySessionChange("19:00:00", "19:00:00"), null);
  assertEquals(classifySessionChange(null, null), null);
});

Deno.test("fmtTime trims seconds and handles null", () => {
  assertEquals(fmtTime("19:00:00"), "19:00");
  assertEquals(fmtTime(null), "—");
});

Deno.test("coalesce: a cancelled row wins and drops session noise", () => {
  const out = coalesceChangeRows([
    row({ show_date_id: "d1", change_type: "session_retimed", session_slot: 1, old_value: "19:00:00", new_value: "20:00:00" }),
    row({ show_date_id: "d1", change_type: "cancelled", session_slot: null }),
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].cancelled, true);
  assertEquals(out[0].sessions, []);
});

Deno.test("coalesce: per-slot net = earliest old + latest new", () => {
  const out = coalesceChangeRows([
    row({ show_date_id: "d1", session_slot: 2, old_value: "15:00:00", new_value: "16:00:00", created_at: "2026-06-01T10:00:00Z" }),
    row({ show_date_id: "d1", session_slot: 2, old_value: "16:00:00", new_value: "17:00:00", created_at: "2026-06-01T14:00:00Z" }),
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].sessions, [{ slot: 2, kind: "session_retimed", old: "15:00:00", new: "17:00:00" }]);
});

Deno.test("coalesce: a reverted slot self-cancels (net no-op dropped)", () => {
  const out = coalesceChangeRows([
    row({ show_date_id: "d1", session_slot: 3, change_type: "session_added", old_value: null, new_value: "19:00:00", created_at: "2026-06-01T10:00:00Z" }),
    row({ show_date_id: "d1", session_slot: 3, change_type: "session_removed", old_value: "19:00:00", new_value: null, created_at: "2026-06-01T14:00:00Z" }),
  ]);
  assertEquals(out, []);
});

Deno.test("describeDateChanges renders a human summary", () => {
  assertEquals(
    describeDateChanges({ showDateId: "d1", cancelled: false, sessions: [
      { slot: 2, kind: "session_retimed", old: "15:00:00", new: "17:00:00" },
      { slot: 3, kind: "session_added", old: null, new: "19:00:00" },
    ] }),
    "Session 2 now 17:00 (was 15:00); Session 3 added (19:00)",
  );
  assertEquals(describeDateChanges({ showDateId: "d1", cancelled: true, sessions: [] }), "Date cancelled");
});

Deno.test("digestEmailSubject is neutral when changes/cancellations are present", () => {
  assertEquals(digestEmailSubject({ bookings: [{}], scheduleChanges: [], cancellations: [] }),
    "Your bookings are confirmed — Showflow Pro");
  assertEquals(digestEmailSubject({ scheduleChanges: [{}] }), "Your booking updates — Showflow Pro");
  assertEquals(digestEmailSubject({ cancellations: [{}] }), "Your booking updates — Showflow Pro");
});
