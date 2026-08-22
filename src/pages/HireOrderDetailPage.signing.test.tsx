import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

// Issued ELECTRONIC (frozen in issue_snapshot). The signing surface must follow this
// frozen issue-time mode, not the org's current setting.
const order = {
  id: "ho1", org_id: "o1", status: "issued", artist_id: "a1", order_no: "HO-1",
  data: {}, pdf_path: "o1/HO-1.pdf", fee_amount: null, fee_currency: "EUR",
  created_at: "2026-01-01", issued_at: "2026-01-02", countersigned_at: null, artists: { name: "Ann" },
  issue_snapshot: { countersign_mode: "electronic" },
};
vi.mock("@/hooks/useHireOrders", () => ({
  useHireOrder: () => ({ data: order, isLoading: false, isError: false }),
  useHireOrderAction: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkCountersigned: () => ({ mutate: vi.fn(), isPending: false }),
  // Task-P3: HireOrderDetailPage fires this once on mount for the linked artist.
  // A no-op mutation mock is enough -- the page only calls `.mutate(order.id)`.
  useMarkHireOrderSeen: () => ({ mutate: vi.fn(), isPending: false }),
  // A vi.fn so each test can pick the org's LIVE countersign mode; the order-mode
  // frozen in issue_snapshot should override it either way.
  useHireOrderCountersignMode: vi.fn(() => ({ data: { mode: "electronic" } })),
  // The rendered SignHireOrderDialog (Task 8) also pulls from this module.
  useSignHireOrder: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: () => ({ data: { id: "a1" } }) }));
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig<object>()), useQuery: () => ({ data: null, isLoading: false, isError: false }) }));

const auth = { currentOrg: { id: "o1" }, hasRole: (_r: string) => false };
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => auth }));

import HireOrderDetailPage from "./HireOrderDetailPage";
import { useHireOrderCountersignMode } from "@/hooks/useHireOrders";

describe("HireOrderDetailPage signing", () => {
  // The signing entry point moved from a "Review & sign" button in the status rail
  // onto a "This order needs your signature" strip directly under the document, with
  // a "Countersign" button (see HireOrderDetailPage.test.tsx's "artist signing strip"
  // suite). The frozen-issue-time-mode behaviour under test here is unchanged.
  it("shows the signing strip for the linked artist on an issued electronic order", () => {
    vi.mocked(useHireOrderCountersignMode).mockReturnValue({ data: { mode: "electronic" } } as never);
    render(<TooltipProvider><MemoryRouter initialEntries={["/contracts/ho1"]}>{<HireOrderDetailPage />}</MemoryRouter></TooltipProvider>);
    expect(screen.getByText(/needs your signature/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /countersign/i })).toBeInTheDocument();
  });

  it("keeps the signing strip for an electronic-issued order even after the org switched to manual (order-mode wins)", () => {
    // The order was ISSUED electronic (issue_snapshot.countersign_mode), but the org's
    // live setting is now manual. The frozen issue-time mode must win so the artist can
    // still complete the in-app signature the DB gate requires.
    vi.mocked(useHireOrderCountersignMode).mockReturnValue({ data: { mode: "manual" } } as never);
    render(<TooltipProvider><MemoryRouter initialEntries={["/contracts/ho1"]}>{<HireOrderDetailPage />}</MemoryRouter></TooltipProvider>);
    expect(screen.getByText(/needs your signature/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /countersign/i })).toBeInTheDocument();
  });
});
