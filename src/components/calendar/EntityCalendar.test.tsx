import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { EntityCalendar } from "./EntityCalendar";

/**
 * EntityCalendar wraps the shadcn `Calendar` (DayPicker) which is configured
 * with `weekStartsOn = 1` by default. These tests assert the rendered grid
 * exposes Mon..Sun weekday headers and places the first day of each month in
 * the correct Monday-based column (Risk 15).
 *
 * Tests stub `Date` only (not all timers) so react-query and other async
 * code keep working.
 */
describe("EntityCalendar — Monday-first week", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderAt(isoDate: string) {
    vi.setSystemTime(new Date(isoDate));
    return render(
      React.createElement(EntityCalendar, {
        items: [] as unknown[],
        getDate: () => null,
        renderItem: () => null,
      })
    );
  }

  it("renders weekday headers in Mon..Sun order", () => {
    const { container } = renderAt("2026-03-10T12:00:00Z");

    const headerCells = container.querySelectorAll('th[scope="col"]');
    expect(headerCells.length).toBe(7);

    const labels = Array.from(headerCells).map((th) =>
      th.getAttribute("aria-label")
    );
    expect(labels).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
  });

  // March 2026 starts Sunday → in Monday-first week it occupies column 6.
  // April 2026 starts Wednesday → column 2.
  // June 2026 starts Monday → column 0.
  // August 2026 starts Saturday → column 5.
  it.each([
    ["2026-03-15T12:00:00Z", "2026-03-01", 6],
    ["2026-04-15T12:00:00Z", "2026-04-01", 2],
    ["2026-06-15T12:00:00Z", "2026-06-01", 0],
    ["2026-08-15T12:00:00Z", "2026-08-01", 5],
  ])(
    "places the first day of the month in the right column for %s",
    (today, firstOfMonth, expectedColumnIndex) => {
      const { container } = renderAt(today);

      const firstCell = container.querySelector(
        `td[data-day="${firstOfMonth}"]:not([data-outside])`
      );
      expect(firstCell).toBeTruthy();

      const row = firstCell!.parentElement!; // <tr>
      const cellsInRow = row.querySelectorAll('td[role="gridcell"]');
      const indexOfFirst = Array.from(cellsInRow).indexOf(firstCell as Element);

      expect(indexOfFirst).toBe(expectedColumnIndex);
    }
  );
});

/**
 * Plan B Task 2: every calendar view shares this month grid, so tinting past
 * days here is what makes "past dates grayed" true everywhere at once. The
 * tint must stay opacity-only (PAST_DATE_TINT) — no `disabled`/pointer-events
 * change — so past days remain selectable.
 */
describe("EntityCalendar — past-day tint", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderAt(isoDate: string) {
    vi.setSystemTime(new Date(isoDate));
    return render(
      React.createElement(EntityCalendar, {
        items: [] as unknown[],
        getDate: () => null,
        renderItem: () => null,
      })
    );
  }

  it("tints a past day cell with the shared PAST_DATE_TINT class", () => {
    const { container } = renderAt("2026-03-15T12:00:00Z");
    const pastCell = container.querySelector('td[data-day="2026-03-10"]:not([data-outside])');
    expect(pastCell).toBeTruthy();
    expect(pastCell!.className).toMatch(/opacity-60/);
  });

  it("does not tint today or a future day cell", () => {
    const { container } = renderAt("2026-03-15T12:00:00Z");
    const today = container.querySelector('td[data-day="2026-03-15"]:not([data-outside])');
    const future = container.querySelector('td[data-day="2026-03-20"]:not([data-outside])');
    expect(today).toBeTruthy();
    expect(future).toBeTruthy();
    expect(today!.className).not.toMatch(/opacity-60/);
    expect(future!.className).not.toMatch(/opacity-60/);
  });

  it("keeps a past day cell selectable (button not disabled)", () => {
    const { container } = renderAt("2026-03-15T12:00:00Z");
    const pastCell = container.querySelector('td[data-day="2026-03-10"]:not([data-outside])');
    const button = pastCell!.querySelector("button");
    expect(button).toBeTruthy();
    expect(button).not.toBeDisabled();
  });
});
