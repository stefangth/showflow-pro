import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const order = {
  id: "ho1", org_id: "o1", status: "issued", artist_id: "a1", order_no: "HO-1",
  data: {}, pdf_path: "o1/HO-1.pdf", fee_amount: null, fee_currency: "EUR",
  created_at: "2026-01-01", issued_at: "2026-01-02", countersigned_at: null, artists: { name: "Ann" },
};
vi.mock("@/hooks/useHireOrders", () => ({
  useHireOrder: () => ({ data: order, isLoading: false, isError: false }),
  useHireOrderAction: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkCountersigned: () => ({ mutate: vi.fn(), isPending: false }),
  useHireOrderCountersignMode: () => ({ data: { mode: "electronic" } }),
  // The rendered SignHireOrderDialog (Task 8) also pulls from this module.
  useSignHireOrder: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: () => ({ data: { id: "a1" } }) }));
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig<object>()), useQuery: () => ({ data: null, isLoading: false, isError: false }) }));

const auth = { currentOrg: { id: "o1" }, hasRole: (_r: string) => false };
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => auth }));

import HireOrderDetailPage from "./HireOrderDetailPage";

describe("HireOrderDetailPage signing", () => {
  it("shows Review & sign for the linked artist on an issued electronic order", () => {
    render(<MemoryRouter initialEntries={["/hire-orders/ho1"]}>{<HireOrderDetailPage />}</MemoryRouter>);
    expect(screen.getByRole("button", { name: /review & sign/i })).toBeInTheDocument();
  });
});
