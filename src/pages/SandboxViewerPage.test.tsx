import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import SandboxViewerPage from "./SandboxViewerPage";
import type { SandboxSnapshot } from "@/data/demo";

const fetchSandboxSnapshotMock = vi.fn();
vi.mock("@/data/demo", () => ({
  fetchSandboxSnapshot: (...args: unknown[]) => fetchSandboxSnapshotMock(...args),
}));

const SNAPSHOT: SandboxSnapshot = {
  org: { label: "Aurora Live", volume: "full" },
  generatedAt: "2026-08-17T10:00:00.000Z",
  kpis: { upcomingDates: 12, confirmedBookings: 34, fillRate: 82, hireOrdersIssued: 5 },
  shows: [{ label: "Winter Cabaret" }, { label: "Spring Revue" }],
  dates: [
    {
      id: "d1",
      date: "2026-08-20",
      showLabel: "Winter Cabaret",
      city: "Berlin",
      status: "fully_filled",
      filled: 4,
      needed: 4,
    },
  ],
  bookingsByStatus: { confirmed: 34, soft_booked: 6, suggested: 2 },
  hireOrders: [{ status: "issued", showLabel: "Winter Cabaret", dateOn: "2026-08-20" }],
};

const renderAt = (token: string) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[`/sandbox/${token}`]}>
      <Routes>
        <Route path="/sandbox/:token" element={<SandboxViewerPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  fetchSandboxSnapshotMock.mockReset();
});

describe("SandboxViewerPage", () => {
  it("renders skeletons while loading", () => {
    fetchSandboxSnapshotMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderAt("tok-loading");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders the org label, read only banner, KPIs and a date row for a valid snapshot", async () => {
    fetchSandboxSnapshotMock.mockResolvedValue({ ok: true, snapshot: SNAPSHOT });
    renderAt("tok-valid");

    await waitFor(() => expect(screen.getByText("Aurora Live")).toBeInTheDocument());
    expect(screen.getByText(/demo, read only/i)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    // fillRate is already a 0-100 percentage from the edge; render as-is (not *100).
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getAllByText("Winter Cabaret").length).toBeGreaterThan(0);
    expect(screen.getByText("Berlin")).toBeInTheDocument();
    expect(screen.getByText(/read only demo/i)).toBeInTheDocument();
  });

  it("renders an expired message and no KPIs when the link expired", async () => {
    fetchSandboxSnapshotMock.mockResolvedValue({ ok: false, reason: "expired" });
    renderAt("tok-expired");

    await waitFor(() => expect(screen.getByText(/expired/i)).toBeInTheDocument());
    expect(screen.queryByText("12")).not.toBeInTheDocument();
  });

  it("renders a revoked message when the link was revoked", async () => {
    fetchSandboxSnapshotMock.mockResolvedValue({ ok: false, reason: "revoked" });
    renderAt("tok-revoked");

    await waitFor(() => expect(screen.getByText(/no longer available/i)).toBeInTheDocument());
  });

  it("renders a not found message for an unknown token", async () => {
    fetchSandboxSnapshotMock.mockResolvedValue({ ok: false, reason: "not_found" });
    renderAt("tok-missing");

    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });
});
