import { describe, expect, it, vi } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { VISIBILITY_MATRIX } from "@/lib/trust/facts";

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Berlin Ensemble" } }),
}));

// The counts themselves are covered against the recording fake in
// src/data/trustStats.test.ts; here they only need to resolve so the claim
// tables render.
vi.mock("@/hooks/useTrustStats", () => ({
  useOrgDataStats: () => ({
    data: { bookings: 1284, artists: 96, productions: 14 },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/useOrgMembers", () => ({
  useOrgMembers: () => ({
    data: [
      { user_id: "u1", roles: ["admin"] },
      { user_id: "u2", roles: ["producer"] },
    ],
    isLoading: false,
    isError: false,
  }),
}));

const { TrustDataTab } = await import("./TrustDataTab");

function renderTab() {
  return renderWithProviders(
    <MemoryRouter>
      <TrustDataTab />
    </MemoryRouter>,
  );
}

/** Read the row for a data object out of the visibility table. */
function matrixRow(label: string) {
  const row = screen
    .getAllByRole("row")
    .find((r) => within(r).queryByRole("rowheader", { name: label }));
  if (!row) throw new Error(`No matrix row for "${label}"`);
  return row;
}

describe("TrustDataTab", () => {
  it("offers exactly the three roles that exist inside an organisation", () => {
    renderTab();

    const tabs = screen.getAllByRole("radio");
    expect(tabs.map((t) => t.textContent)).toEqual(["Administrator", "Production team", "Artist"]);
  });

  it("does not offer a ShowFlow staff view", () => {
    renderTab();

    // Platform support access is out of scope for this page; offering it as a
    // column would mean describing behaviour we cannot evidence.
    expect(screen.queryByRole("radio", { name: /staff/i })).toBeNull();
    expect(screen.queryByText(/ShowFlow staff/i)).toBeNull();
  });

  it("publishes no open-items or attestation section", () => {
    renderTab();

    expect(screen.queryByText(/what we have not done yet/i)).toBeNull();
    expect(screen.queryByText(/SOC 2/i)).toBeNull();
    expect(screen.queryByText(/ISO 27001/i)).toBeNull();
    expect(screen.queryByText(/penetration test/i)).toBeNull();
  });

  it("defaults to the artist view, the one people ask about", () => {
    renderTab();

    expect(screen.getByRole("radio", { name: "Artist" })).toHaveAttribute("aria-checked", "true");
    expect(within(matrixRow("Artist contact details")).getByText("Own record")).toBeInTheDocument();
  });

  it("switches every row when a different role is picked", () => {
    renderTab();

    fireEvent.click(screen.getByRole("radio", { name: "Administrator" }));

    for (const row of VISIBILITY_MATRIX) {
      expect(within(matrixRow(row.object)).getByText(row.admin.value)).toBeInTheDocument();
    }
  });

  // The source design claimed the production team cannot read the audit log.
  // The RLS policy grants it SELECT, so the page says so. Locking this down
  // because it is exactly the sentence a reviewer would test against the API.
  it("tells the truth about the production team and the audit log", () => {
    renderTab();

    fireEvent.click(screen.getByRole("radio", { name: "Production team" }));

    const row = matrixRow("Booking audit log");
    expect(within(row).getByText("Read-only")).toBeInTheDocument();
    expect(within(row).queryByText("No access")).toBeNull();
    // It reads the log, but the append-only property still has to be stated.
    expect(row).toHaveTextContent(/no policy allows altering a row/i);
  });

  // Likewise: notes live on the artist's own booking row, so the own-row SELECT
  // policy returns them. Claiming "never exposed" would be false.
  it("does not claim booking notes are hidden from artists", () => {
    renderTab();

    const row = matrixRow("Booking notes and cancellation reasons");
    expect(within(row).getByText("Own booking")).toBeInTheDocument();
    expect(within(row).queryByText("No access")).toBeNull();
  });

  it("shows chat as unrestricted for both staff roles inside the org", () => {
    renderTab();

    fireEvent.click(screen.getByRole("radio", { name: "Production team" }));
    // is_chat_participant() returns true for any producer on any org chat, and
    // the same function gates INSERT, so this is neither read-only nor scoped.
    expect(within(matrixRow("Show-date chat")).getByText("Full")).toBeInTheDocument();
  });

  it("states cross-organisation access as none for every role", () => {
    renderTab();

    for (const role of ["Administrator", "Production team", "Artist"]) {
      fireEvent.click(screen.getByRole("radio", { name: role }));
      expect(within(matrixRow("Another organisation's data")).getByText("No access")).toBeInTheDocument();
    }
  });

  it("links out to the public trust center in a new tab", () => {
    renderTab();

    const link = screen.getByRole("link", { name: /public trust center/i });
    expect(link).toHaveAttribute("href", "https://showflow.pro/trust");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("offers the export that exists rather than one that would fail", () => {
    renderTab();

    // export-org-data requires a platform admin, so there is no org-wide
    // export button here — only the per-user one, plus a request path.
    expect(screen.getByRole("link", { name: /export your data/i })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(screen.getByRole("link", { name: /request an organisation export/i })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:"),
    );
  });

  it("labels the request-only document as a request, not a download", () => {
    renderTab();

    const dpa = screen.getByRole("link", { name: "Request" });
    expect(dpa).toHaveAttribute("href", expect.stringContaining("mailto:"));
    // A mailto opened in a new tab leaves a blank window behind.
    expect(dpa).not.toHaveAttribute("target");
  });
});
