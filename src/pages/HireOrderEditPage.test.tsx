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
import HireOrderEditPage, { createSingleFlightRunner } from "./HireOrderEditPage";

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

  it("clearing a field with a showflow fallback keeps it empty instead of reverting, shows Manual, and saves the empty value", async () => {
    seedFor(order());
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    expect(within(screen.getByTestId("field-role")).getByText("SF")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "" } });

    // The input must not silently snap back to the showflow fallback value.
    expect(screen.getByLabelText("Role")).toHaveValue("");
    expect(within(screen.getByTestId("field-role")).getByText("Manual")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => {
      const update = updateCalls().at(-1);
      expect(update).toBeDefined();
      const patch = update!.args[0] as { data?: Record<string, { value: unknown; source: string }> };
      expect(patch.data?.role).toEqual({ value: "", source: "manual" });
    });
  });

  it("re-typing a value into a previously-cleared field un-clears it back to a normal manual edit", async () => {
    seedFor(order());
    renderPage();
    await screen.findByText("HO-2026-0201-1");

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "" } });
    expect(within(screen.getByTestId("field-role")).getByText("Manual")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Swing" } });
    expect(screen.getByLabelText("Role")).toHaveValue("Swing");
    expect(within(screen.getByTestId("field-role")).getByText("Manual")).toBeInTheDocument();
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
    "serializes the mount preview and an edit that lands inside its round trip, so the edit's fresher preview always wins",
    async () => {
      seedFor(order());
      // An edit fires while the mount preview's own `generate-hire-orders`
      // invoke is still in flight (its response is gated below). If the
      // mount fetch runs through the SAME single-flight runner as the
      // debounced edit cycle (the fix for finding 14), the edit's trigger
      // must coalesce into a trailing rerun rather than firing a second,
      // concurrent invoke — so invokeCount stays at 1 until the mount call
      // is released, and the edit's response (not the stale mount response)
      // is what ends up in `previewSrc`.
      const gate = deferred<{ data: unknown; error: null }>();
      let invokeCount = 0;
      const invokeSpy = vi.fn(() => {
        invokeCount += 1;
        if (invokeCount === 1) return gate.promise;
        return Promise.resolve({ data: { pdf_base64: "RURJVA==" }, error: null });
      });
      (client as unknown as { functions: { invoke: unknown } }).functions.invoke = invokeSpy;

      renderPage();
      await waitFor(() => expect(invokeCount).toBe(1));

      fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Updated during mount fetch" } });

      // Past the 800ms debounce window, but the mount call is still gated:
      // no second invoke should have started (proves the edit's trigger was
      // coalesced into the mount cycle's runner, not run independently).
      await new Promise((r) => setTimeout(r, 900));
      expect(invokeCount).toBe(1);

      // Release the stale mount response.
      gate.resolve({ data: { pdf_base64: PREVIEW_PDF_B64 }, error: null });

      // The trailing rerun (persist the edit, then re-preview) now runs, and
      // its result is the final state — never clobbered back to the mount
      // cycle's own (stale) response.
      await waitFor(() => {
        const frame = screen.getByTitle(/hire order live preview/i);
        expect(frame).toHaveAttribute("src", "data:application/pdf;base64,RURJVA==");
      });
      expect(invokeCount).toBe(2);
      const lastUpdate = updateCalls().at(-1);
      expect(lastUpdate).toBeDefined();
      const patch = lastUpdate!.args[0] as { data?: Record<string, { value: unknown }> };
      expect(patch.data?.notes?.value).toBe("Updated during mount fetch");
    },
    8000,
  );

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

/** A manually-resolvable promise, for controlling exactly when an in-flight
 *  `run()` call settles relative to test assertions. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Drains the microtask queue `times` rounds deep — enough for a chain of
 *  `await`s inside `createSingleFlightRunner`'s loop (run's own continuation,
 *  then the loop's continuation, then the next run's synchronous prefix) to
 *  settle, without needing fake timers (the runner has no timers of its own;
 *  the 800ms debounce lives in the component's effect, not this primitive). */
async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// Regression coverage for the debounced live-preview race (finding 1): two
// overlapping persist+preview cycles must never run concurrently, so
// whichever one is "stale" can never write the DB or set previewSrc after a
// newer one. `createSingleFlightRunner` is the primitive `HireOrderEditPage`
// wraps its persist+preview cycle in to guarantee that; it's pure (no React,
// no timers), so the race is reproduced deterministically here with
// hand-controlled deferred promises instead of trying to win a real timing
// race against jsdom/RTL's real-timer async utilities (which the rest of
// this file already relies on for the 800ms debounce itself — mixing fake
// timers into that suite would risk exactly the flakiness this file's other
// tests avoid by using real timers).
describe("createSingleFlightRunner", () => {
  it("never starts a second cycle while one is in flight, coalesces any number of mid-flight triggers into exactly one trailing rerun, and only starts the rerun after the first cycle fully settles", async () => {
    const calls: string[] = [];
    const gate1 = deferred<void>();
    const gate2 = deferred<void>();
    let callIndex = 0;
    const run = vi.fn(async () => {
      callIndex += 1;
      const idx = callIndex;
      calls.push(`start-${idx}`);
      await (idx === 1 ? gate1.promise : gate2.promise);
      calls.push(`end-${idx}`);
    });

    const trigger = createSingleFlightRunner(run);

    trigger();
    expect(run).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["start-1"]);

    // Three edits land while cycle 1's write/preview is still in flight (its
    // gate hasn't been released yet) — none may start a second, concurrent
    // cycle. This is the exact shape of the bug: rapid edits during a slow
    // persist+preview chain.
    trigger();
    trigger();
    trigger();
    expect(run).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["start-1"]);

    // Let cycle 1 finish.
    gate1.resolve();
    await flushMicrotasks();

    // Exactly ONE trailing rerun fired for the three mid-flight triggers —
    // not three, not zero — and it only started once cycle 1's own "end"
    // had already happened (proving strict sequencing, not concurrency).
    expect(calls).toEqual(["start-1", "end-1", "start-2"]);
    expect(run).toHaveBeenCalledTimes(2);

    gate2.resolve();
    await flushMicrotasks();
    expect(calls).toEqual(["start-1", "end-1", "start-2", "end-2"]);
    // No further rerun: nothing triggered during cycle 2's flight, so a
    // settled cycle does not loop forever.
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh, independent cycle for a trigger that arrives after the previous cycle has already settled", async () => {
    const run = vi.fn(async () => {});
    const trigger = createSingleFlightRunner(run);

    trigger();
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(1);

    trigger();
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
