import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/renderWithProviders";
import { CancelledUntoldCard } from "./CancelledUntoldCard";
import type { CancelledUntoldDate } from "@/lib/autopilot/today";

function aCancelled(overrides: Partial<CancelledUntoldDate> = {}): CancelledUntoldDate {
  return {
    kind: "cancelled_untold",
    showDateId: "date-2",
    date: "2026-08-28",
    title: "Hamlet, Matinee",
    where: "Thalia Theater, Hamburg",
    daysOut: 11,
    artistNames: ["Marek Kowal", "Tomás Ruiz"],
    ...overrides,
  };
}

// Bug 3 regression guard: `cancelled.body` used to carry a `{{when}}` slot
// with no backing data, rendering as an empty gap mid-sentence ("this date
// . Marek..."). The sentence was rewritten in both languages instead of
// sourcing a value, since `show_dates` has no cancellation timestamp column.
// Assert the fixed sentence reads cleanly: no leftover placeholder, no
// doubled space, no stray space before the period.
describe("CancelledUntoldCard", () => {
  it("renders the cancelled-date sentence with no unfilled placeholder or stray gap", () => {
    render(
      <CancelledUntoldCard item={aCancelled()} onTellCast={vi.fn()} onReadFirst={vi.fn()} />,
    );

    const body = screen.getByText(/The house cancelled this date\./);
    expect(body.textContent).toBe(
      "The house cancelled this date. Marek Kowal and Tomás Ruiz still have it in their calendar. " +
        "Autopilot does not send bad news on its own.",
    );
    expect(body.textContent).not.toContain("{{when}}");
    expect(body.textContent).not.toMatch(/ {2,}/);
    expect(body.textContent).not.toMatch(/ \./);
  });
});
