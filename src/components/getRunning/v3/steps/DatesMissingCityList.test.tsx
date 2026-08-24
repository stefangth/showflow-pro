import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

// Data-access layer only: the REAL useDatesMissingCity / useCities / useUpdateShowDate hooks
// run, so this exercises the real query keys and the real mutation wiring.
vi.mock("@/data/showDates", () => ({
  fetchUpcomingDatesWithoutCity: vi.fn(() => Promise.resolve([])),
  createShowDate: vi.fn(),
  updateShowDate: vi.fn(() => Promise.resolve()),
  cancelShowDate: vi.fn(),
  deleteShowDate: vi.fn(),
}));
vi.mock("@/data/cities", () => ({
  fetchCitiesForLinking: vi.fn(() => Promise.resolve([])),
}));

import { fetchUpcomingDatesWithoutCity, updateShowDate } from "@/data/showDates";
import { fetchCitiesForLinking } from "@/data/cities";
import { DatesMissingCityList } from "./DatesMissingCityList";

type Fn = ReturnType<typeof vi.fn>;
const mock = (f: unknown) => f as Fn;

const TEST_ORG = { id: "org-1", name: "Org", suspended_at: null } as never;

function seedDates(rows: { id: string; date: string; venue: string | null; program: string }[]) {
  mock(fetchUpcomingDatesWithoutCity).mockResolvedValue(
    rows.map((r) => ({ id: r.id, date: r.date, venue: r.venue, show: { program: r.program, sub_program: null } })),
  );
}

function renderList(canEdit = true) {
  return renderWithProviders(
    <MemoryRouter>
      <DatesMissingCityList orgId="org-1" canEdit={canEdit} />
    </MemoryRouter>,
    { authOverrides: { currentOrg: TEST_ORG } },
  );
}

describe("DatesMissingCityList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedDates([{ id: "d1", date: "2026-09-04", venue: "Stadthalle", program: "Hamlet" }]);
    mock(fetchCitiesForLinking).mockResolvedValue([
      { id: "c1", name: "Berlin", airtable_city_key: null },
      { id: "c2", name: "Munich", airtable_city_key: null },
    ]);
  });

  it("lists each date without a city with its production, date and venue", async () => {
    seedDates([
      { id: "d1", date: "2026-09-04", venue: "Stadthalle", program: "Hamlet" },
      { id: "d2", date: "2026-09-11", venue: null, program: "Macbeth" },
    ]);
    renderList();

    expect(await screen.findByText("Hamlet")).toBeInTheDocument();
    expect(screen.getByText(/04\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Stadthalle/)).toBeInTheDocument();
    expect(screen.getByText("Macbeth")).toBeInTheDocument();
  });

  it("writes the picked city through updateShowDate", async () => {
    renderList();

    await screen.findByText("Hamlet");
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Munich" }));

    await waitFor(() => expect(mock(updateShowDate)).toHaveBeenCalled());
    const [, id, patch] = mock(updateShowDate).mock.calls[0];
    expect(id).toBe("d1");
    expect(patch).toEqual({ city_id: "c2" });
  });

  it("disables the city picker for a viewer who cannot edit", async () => {
    renderList(false);

    await screen.findByText("Hamlet");
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("links out to Settings for a city that does not exist yet", async () => {
    renderList();

    const link = await screen.findByRole("link", { name: /settings/i });
    expect(link.getAttribute("href")).toMatch(/\/settings/);
  });
});
