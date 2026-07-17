import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// The page reads the shared supabase client through its Task-11 hooks
// (useHireOrder / useMarkCountersigned) and the download-url edge action, plus
// useAuth for the current org + role. Same harness as HireOrdersCard.test.tsx:
// a call-recording fake swapped into a hoisted holder (never a hand-rolled
// vi.mock chain), and useAuth as a vi.fn() so each test picks the role.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import HireOrderDetailPage from "./HireOrderDetailPage";

type Role = "producer" | "admin" | "artist";
function authAs(role: Role, orgId = "org-1") {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: { id: orgId, name: "Aurora Productions", slug: "aurora" },
    hasRole: (r: string) => r === role,
    roles: [role],
  } as never);
}

const SIGNED_URL = "https://signed.example/orders/ho-1.pdf?token=abc";

/** A hire_orders detail row shaped like fetchHireOrder returns it (artist joined). */
function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "ho-1",
    order_no: "HO-2026-0201-1",
    status: "issued",
    booking_id: "bk-1",
    artist_id: "ar-1",
    show_date_id: "sd-1",
    org_id: "org-1",
    fee_amount: 4500,
    fee_currency: "EUR",
    terms_variant: "standard",
    pdf_path: "orgs/org-1/ho-1.pdf",
    created_at: "2026-01-10T09:00:00Z",
    issued_at: "2026-01-12T10:00:00Z",
    countersigned_at: null,
    data: {
      artist_name: { value: "Ada Lovelace", source: "showflow" },
      recipient_email: { value: "ada@example.com", source: "showflow" },
      date: { value: "2026-02-01", source: "showflow" },
      venue: { value: "Main Hall", source: "showflow" },
      duration_min: { value: "90", source: "showflow" },
      sessions: { value: "Doors 20:00 · Set 21:00 to 22:30", source: "manual" },
      fee: { value: 4500, source: "manual" },
    },
    artists: { name: "Ada Lovelace" },
    ...overrides,
  };
}

function seedFor(orderRow: Record<string, unknown> | null, error: unknown = null) {
  seedClient({
    hire_orders: { data: orderRow, error },
    "fn:generate-hire-orders": { data: { url: SIGNED_URL }, error: null },
  });
}

function renderPage(id = "ho-1") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/hire-orders/${id}`]}>
      <Routes>
        <Route path="/hire-orders/:id" element={<HireOrderDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HireOrderDetailPage", () => {
  beforeEach(() => seedFor(order()));

  it("renders the header with the mono order number and an Awaiting-countersign badge", async () => {
    authAs("producer");
    renderPage();
    expect(await screen.findByText("Performance hire order")).toBeInTheDocument();
    expect(screen.getByText("HO-2026-0201-1")).toBeInTheDocument();
    // Issued reads as "Awaiting countersign" on both the status badge and the
    // timeline step, so at least one match is expected here.
    expect(screen.getAllByText(/awaiting countersign/i).length).toBeGreaterThanOrEqual(1);
    // No em/en dashes anywhere in the page copy.
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("embeds the PDF via the signed URL from the download-url action", async () => {
    authAs("producer");
    renderPage();
    const frame = await screen.findByTitle(/hire order document/i);
    expect(frame).toHaveAttribute("src", SIGNED_URL);
    // The signed URL is fetched via the generate-hire-orders download-url action.
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      const body = invoke?.args[0] as { action?: string; order_id?: string } | undefined;
      expect(body?.action).toBe("download-url");
      expect(body?.order_id).toBe("ho-1");
    });
  });

  it("renders the four-step timeline", async () => {
    authAs("producer");
    renderPage();
    await screen.findByText("Performance hire order");
    const timeline = screen.getByRole("list", { name: /order status timeline/i });
    expect(within(timeline).getByText("Created")).toBeInTheDocument();
    expect(within(timeline).getByText("Issued to artist")).toBeInTheDocument();
    expect(within(timeline).getByText("Awaiting countersign")).toBeInTheDocument();
    expect(within(timeline).getByText("Countersigned")).toBeInTheDocument();
    // Exactly four steps, no more (the mock's fifth "Filed to settlement" is dropped).
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(4);
  });

  it("renders the recipient card with the artist name and email", async () => {
    authAs("producer");
    renderPage();
    expect(await screen.findByText("Recipient")).toBeInTheDocument();
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("renders the at-a-glance facts (fee + duration), fee-only with no deposit", async () => {
    authAs("producer");
    renderPage();
    expect(await screen.findByText(/at a glance/i)).toBeInTheDocument();
    expect(screen.getByText("€4,500.00")).toBeInTheDocument();
    expect(screen.getByText(/90 min/i)).toBeInTheDocument();
    expect(screen.queryByText(/deposit/i)).not.toBeInTheDocument();
  });

  it("lets a producer mark an issued order countersigned", async () => {
    authAs("producer");
    renderPage();
    const btn = await screen.findByRole("button", { name: /mark countersigned/i });
    fireEvent.click(btn);
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
      expect(update).toBeDefined();
      expect((update!.args[0] as { status?: string }).status).toBe("countersigned");
    });
  });

  it("shows a countersigned confirmation chip (no action) once countersigned", async () => {
    authAs("producer");
    seedFor(order({ status: "countersigned", countersigned_at: "2026-01-14T08:00:00Z" }));
    renderPage();
    expect(await screen.findByText(/countersigned by artist/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark countersigned/i })).not.toBeInTheDocument();
  });

  it("shows an artist only a Download control, never Mark countersigned", async () => {
    authAs("artist");
    renderPage();
    expect(await screen.findByRole("button", { name: /download pdf/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark countersigned/i })).not.toBeInTheDocument();
  });

  it("renders a not-issued-yet state instead of an embed for a draft order", async () => {
    authAs("producer");
    seedFor(order({ status: "draft", pdf_path: null, issued_at: null }));
    renderPage();
    expect(await screen.findByText(/not issued yet/i)).toBeInTheDocument();
    expect(screen.queryByTitle(/hire order document/i)).not.toBeInTheDocument();
  });

  it("surfaces a destructive alert when the order cannot be loaded (RLS-denied)", async () => {
    authAs("artist");
    seedFor(null, new Error("permission denied for table hire_orders"));
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
  });
});
