import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// Same harness as HireOrderDetailPage.test.tsx: a call-recording fake swapped
// into a hoisted holder (never a hand-rolled vi.mock chain), useAuth as a
// vi.fn() so each test picks the org/role, and a real MemoryRouter (the page
// reads useParams/useNavigate for real).
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import HireOrderEditPage from "./HireOrderEditPage";

function authAs(role: "admin" | "producer" = "producer", orgId = "org-1") {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: { id: orgId, name: "Aurora Productions", slug: "aurora" },
    hasRole: (r: string) => r === role,
    roles: [role],
  } as never);
}

/** Exercises all four FieldSource values across the twelve order fields. */
const DATA = {
  artist_name: { value: "Ada Lovelace", source: "showflow" },
  recipient_email: { value: "ada@example.com", source: "showflow" },
  role: { value: "Lead vocalist", source: "showflow" },
  cast: { value: "Berlin 1", source: "sheet" },
  date: { value: "2026-02-01", source: "showflow" },
  venue: { value: "Main Hall", source: "showflow" },
  city: { value: "Berlin", source: "showflow" },
  duration_min: { value: 90, source: "showflow" },
  sessions: { value: ["19:00", "21:00"], source: "showflow" },
  fee: { value: 4500, source: "manual" },
  currency: { value: "EUR", source: "default" },
  notes: { value: "Bring own mic", source: "manual" },
};

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "ho-1",
    order_no: "HO-2026-0201-1",
    status: "draft",
    booking_id: "bk-1",
    artist_id: "ar-1",
    show_date_id: "sd-1",
    org_id: "org-1",
    fee_amount: 4500,
    fee_currency: "EUR",
    terms_variant: "standard",
    pdf_path: null,
    created_at: "2026-01-10T09:00:00Z",
    issued_at: null,
    countersigned_at: null,
    data: DATA,
    artists: { name: "Ada Lovelace" },
    ...overrides,
  };
}

const LETTERHEAD_READY = { legal_name: "Aurora Productions GmbH", address_lines: [], registration_line: "" };
const PREVIEW_PDF_B64 = "QUJD";

function seedFor(orderRow: Record<string, unknown> | null, extra: Record<string, TableSeed> = {}) {
  seedClient({
    hire_orders: { data: orderRow, error: null },
    app_settings: { data: [{ key: "hire_order_letterhead", org_id: null, value: LETTERHEAD_READY }], error: null },
    "fn:generate-hire-orders": { data: { pdf_base64: PREVIEW_PDF_B64 }, error: null },
    ...extra,
  });
}

function renderPage(id = "ho-1", opts: { queryClient?: ReturnType<typeof createTestQueryClient> } = {}) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/hire-orders/${id}/edit`]}>
      <Routes>
        <Route path="/hire-orders/:id/edit" element={<HireOrderEditPage />} />
        <Route path="/hire-orders/:id" element={<div>DETAIL STUB</div>} />
      </Routes>
    </MemoryRouter>,
    opts,
  );
}

function invokeCalls() {
  return (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
}
function updateCalls() {
  return invokeCalls().filter((c) => c.table === "hire_orders" && c.method === "update");
}
function previewInvokeCalls() {
  return invokeCalls().filter(
    (c) => c.table === "fn:generate-hire-orders" && c.method === "invoke" && (c.args[0] as { action?: string })?.action === "preview",
  );
}

describe("HireOrderEditPage", () => {
  beforeEach(() => authAs("producer"));

  it("renders the header with the mono order number and status badge", async () => {
    seedFor(order());
    renderPage();
    expect(await screen.findByText("HO-2026-0201-1")).toBeInTheDocument();
    expect(screen.getByText("HO-2026-0201-1")).toHaveClass("font-mono");
    expect(screen.getByText("Draft", { selector: "div" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("renders every field row with the chip matching its resolved source", async () => {
    seedFor(order());
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    expect(within(screen.getByTestId("field-artist_name")).getByText("SF")).toBeInTheDocument();
    expect(within(screen.getByTestId("field-cast")).getByText("Sheet")).toBeInTheDocument();
    expect(within(screen.getByTestId("field-fee")).getByText("Manual")).toBeInTheDocument();
    expect(within(screen.getByTestId("field-currency")).getByText("Default")).toBeInTheDocument();
  });

  it("editing an input flips that field's chip to Manual and stages the patch", async () => {
    seedFor(order());
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    expect(within(screen.getByTestId("field-role")).getByText("SF")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Understudy" } });

    expect(within(screen.getByTestId("field-role")).getByText("Manual")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toHaveValue("Understudy");
    // Untouched fields keep their original source unaffected by the edit.
    expect(within(screen.getByTestId("field-artist_name")).getByText("SF")).toBeInTheDocument();
  });

  it.each(["issued", "countersigned", "void"])(
    "renders read-only with a notice for %s orders, no inputs, no Save/Issue",
    async (status) => {
      seedFor(order({ status }));
      renderPage();
      expect(await screen.findByText(/can no longer be edited/i)).toBeInTheDocument();
      expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^save draft$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /issue and send/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /view order/i })).toBeInTheDocument();
    },
  );

  it("Refresh from ShowFlow re-resolves non-manual fields from a fresh layer while preserving manual edits", async () => {
    seedFor(order(), {
      artists: { data: { name: "Ada Lovelace", email: "ada@example.com", cast_role: "Swing" }, error: null },
      show_dates: {
        data: {
          date: "2026-02-01", venue: "Grand Hall", duration_minutes: 120,
          session_1: "20:00", session_2: null, session_3: null,
          cities: { name: "Munich" },
        },
        error: null,
      },
    });
    renderPage();
    await screen.findByText("HO-2026-0201-1");

    fireEvent.click(screen.getByRole("button", { name: /refresh from showflow/i }));

    await waitFor(() => expect(screen.getByLabelText("Role")).toHaveValue("Swing"));
    expect(screen.getByLabelText("Venue")).toHaveValue("Grand Hall");
    expect(within(screen.getByTestId("field-role")).getByText("SF")).toBeInTheDocument();
    // The fee was already manual-sourced before the refresh — preserved as-is.
    expect(screen.getByLabelText("Engagement fee")).toHaveValue(4500);
    expect(within(screen.getByTestId("field-fee")).getByText("Manual")).toBeInTheDocument();
  });

  it("disables Refresh from ShowFlow for an unlinked (manual) order", async () => {
    seedFor(order({ show_date_id: null, artist_id: null }));
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    expect(screen.getByRole("button", { name: /refresh from showflow/i })).toBeDisabled();
  });

  it("Save draft persists the resolved snapshot via updateHireOrderDraft and invalidates hire-orders", async () => {
    seedFor(order());
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderPage("ho-1", { queryClient });
    await screen.findByText("HO-2026-0201-1");

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Understudy" } });
    fireEvent.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => {
      const update = updateCalls().at(-1);
      expect(update).toBeDefined();
      const patch = update!.args[0] as { data?: Record<string, { value: unknown; source: string }>; fee_amount?: number };
      expect(patch.data?.role).toEqual({ value: "Understudy", source: "manual" });
      expect(patch.fee_amount).toBe(4500);
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["hire-orders"] }));
  });

  it("fetches an initial live preview on mount, before any edit", async () => {
    seedFor(order());
    renderPage();
    const frame = await screen.findByTitle(/hire order live preview/i);
    await waitFor(() => expect(frame).toHaveAttribute("src", `data:application/pdf;base64,${PREVIEW_PDF_B64}`));
    expect(previewInvokeCalls().length).toBeGreaterThanOrEqual(1);
  });

  it(
    "re-requests the preview action debounced 800ms after an edit (save-then-preview)",
    async () => {
      seedFor(order());
      renderPage();
      await screen.findByTitle(/hire order live preview/i);
      await waitFor(() => expect(previewInvokeCalls().length).toBe(1));

      fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Updated note" } });

      // Not yet within the debounce window.
      await new Promise((r) => setTimeout(r, 300));
      expect(previewInvokeCalls().length).toBe(1);

      await waitFor(() => expect(previewInvokeCalls().length).toBeGreaterThan(1), { timeout: 2000 });
      // The debounced cycle persists before re-previewing.
      const lastUpdate = updateCalls().at(-1);
      const patch = lastUpdate!.args[0] as { data?: Record<string, { value: unknown }> };
      expect(patch.data?.notes?.value).toBe("Updated note");
    },
    8000,
  );

  it("disables Issue and send while orderReadyIssues is non-empty, with a title listing the readable issue copy", async () => {
    const dataWithoutFee = { ...DATA, fee: undefined };
    seedFor(order({ data: dataWithoutFee, fee_amount: null }), {
      app_settings: { data: [], error: null },
    });
    renderPage();
    const btn = await screen.findByRole("button", { name: /issue and send/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toContain("Set an engagement fee before issuing");
    expect(btn.getAttribute("title")).toContain("Add a letterhead in Settings before issuing");
  });

  it("Issue and send calls the issue action when ready, and navigates to the detail page on success", async () => {
    seedFor(order(), {
      "fn:generate-hire-orders": { data: { issued: ["ho-1"], pdf_base64: PREVIEW_PDF_B64 }, error: null },
    });
    renderPage();
    const btn = await screen.findByRole("button", { name: /issue and send/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);

    await waitFor(() => {
      const invoke = invokeCalls().find(
        (c) => c.table === "fn:generate-hire-orders" && c.method === "invoke" && (c.args[0] as { action?: string })?.action === "issue",
      );
      expect(invoke).toBeDefined();
      expect((invoke!.args[0] as { order_ids?: string[] }).order_ids).toEqual(["ho-1"]);
    });
    expect(await screen.findByText("DETAIL STUB")).toBeInTheDocument();
  });

  it("surfaces a destructive alert when the order cannot be loaded", async () => {
    seedClient({ hire_orders: { data: null, error: new Error("permission denied") } });
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
  });
});
