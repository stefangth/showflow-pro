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
// Task 9 wires in useMyArtist (via useEffectiveUserId) alongside useAuth.
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn(), useEffectiveUserId: () => "user-1" }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
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
    viewed_at: null,
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
    <MemoryRouter initialEntries={[`/contracts/${id}`]}>
      <Routes>
        <Route path="/contracts/:id" element={<HireOrderDetailPage />} />
        <Route path="/contracts/:id/edit" element={<div>EDIT STUB</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The artists row linked to useEffectiveUserId's fixed "user-1", in the same org as
 *  the seeded order -- the piece no existing test in this file seeds, so `canArtistSign`
 *  has never evaluated true here before. Matches `order().artist_id` ("ar-1"). */
const LINKED_ARTIST = { id: "ar-1", org_id: "org-1", user_id: "user-1", name: "Ada Lovelace" };

/** Renders the page as the linked artist on an issued, electronic-mode order --
 *  the one state where `canArtistSign` is true and the signing strip should appear. */
async function renderArtistViewingSignableOrder() {
  authAs("artist");
  seedClient({
    hire_orders: { data: order(), error: null },
    "fn:generate-hire-orders": { data: { url: SIGNED_URL }, error: null },
    app_settings: { data: [{ org_id: "org-1", value: { mode: "electronic" } }], error: null },
    artists: { data: LINKED_ARTIST, error: null },
  });
  renderPage();
  await screen.findByText("Performance contract");
}

/** Renders the same issued order for a producer -- canManage is true, so
 *  canArtistSign is false regardless of countersign mode or artist linkage. */
async function renderProducerViewingIssuedOrder() {
  authAs("producer");
  seedFor(order());
  renderPage();
  await screen.findByText("Performance contract");
}

describe("HireOrderDetailPage", () => {
  beforeEach(() => { seedFor(order()); vi.mocked(useCan).mockReturnValue(true); });

  it("manage_countersign off: Mark countersigned is disabled (page still renders)", async () => {
    authAs("producer");
    seedFor(order());
    vi.mocked(useCan).mockImplementation((action: string) => action !== "manage_countersign");
    renderPage();
    expect(await screen.findByRole("button", { name: /mark countersigned/i })).toBeDisabled();
  });

  it("renders the header with the mono order number and an Awaiting-countersign badge", async () => {
    authAs("producer");
    renderPage();
    expect(await screen.findByText("Performance contract")).toBeInTheDocument();
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
    const frame = await screen.findByTitle(/contract document/i);
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

  it("renders the five-step timeline, Seen included", async () => {
    authAs("producer");
    renderPage();
    await screen.findByText("Performance contract");
    const timeline = screen.getByRole("list", { name: /contract status timeline/i });
    expect(within(timeline).getByText("Created")).toBeInTheDocument();
    expect(within(timeline).getByText("Issued to artist")).toBeInTheDocument();
    expect(within(timeline).getByText("Seen")).toBeInTheDocument();
    expect(within(timeline).getByText("Awaiting countersign")).toBeInTheDocument();
    expect(within(timeline).getByText("Countersigned")).toBeInTheDocument();
    // Exactly five steps, no more.
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(5);
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

  it("hides Mark countersigned for a manager on an electronic issued order, showing an awaiting-signature hint", async () => {
    // Electronic orders must complete via the artist's in-app signature (consent
    // + audit row + signed PDF). A one-click manager flip would skip all of that,
    // so the button is gated out of electronic mode and a non-action hint takes
    // its place so the rail is not empty.
    authAs("producer");
    seedClient({
      hire_orders: { data: order(), error: null },
      "fn:generate-hire-orders": { data: { url: SIGNED_URL }, error: null },
      app_settings: { data: [{ org_id: "org-1", value: { mode: "electronic" } }], error: null },
    });
    renderPage();
    expect(await screen.findByText(/awaiting artist signature/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark countersigned/i })).not.toBeInTheDocument();
  });

  it("keeps Mark countersigned for a manager on a manual-mode issued order", async () => {
    authAs("producer");
    seedClient({
      hire_orders: { data: order(), error: null },
      "fn:generate-hire-orders": { data: { url: SIGNED_URL }, error: null },
      app_settings: { data: [{ org_id: "org-1", value: { mode: "manual" } }], error: null },
    });
    renderPage();
    expect(await screen.findByRole("button", { name: /mark countersigned/i })).toBeInTheDocument();
    expect(screen.queryByText(/awaiting artist signature/i)).not.toBeInTheDocument();
  });

  it("hides Mark countersigned when the order was ISSUED electronic, even after the org switched to manual (order-mode wins)", async () => {
    // The order carries a frozen electronic issue-time mode (issue_snapshot), but the
    // org's live setting is now manual. The manual one-click flip would strand the order
    // against the DB gate (which also keys off the frozen mode), so it stays hidden and
    // the awaiting-signature hint shows instead.
    authAs("producer");
    seedClient({
      hire_orders: { data: order({ issue_snapshot: { countersign_mode: "electronic" } }), error: null },
      "fn:generate-hire-orders": { data: { url: SIGNED_URL }, error: null },
      app_settings: { data: [{ org_id: "org-1", value: { mode: "manual" } }], error: null },
    });
    renderPage();
    expect(await screen.findByText(/awaiting artist signature/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark countersigned/i })).not.toBeInTheDocument();
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
    expect(screen.queryByTitle(/contract document/i)).not.toBeInTheDocument();
  });

  it("surfaces a destructive alert when the order cannot be loaded (RLS-denied)", async () => {
    authAs("artist");
    seedFor(null, new Error("permission denied for table hire_orders"));
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
  });

  it("shows an inline error and a Download fallback instead of a perpetual skeleton when the signed-URL fetch fails", async () => {
    authAs("producer");
    seedClient({
      hire_orders: { data: order(), error: null },
      "fn:generate-hire-orders": { data: null, error: new Error("edge function returned a non-2xx status code") },
    });
    renderPage();
    expect(await screen.findByText(/couldn't load the document/i)).toBeInTheDocument();
    // The header Download button is the fallback action; it must stay enabled.
    const downloadBtn = screen.getByRole("button", { name: /download/i });
    expect(downloadBtn).toBeEnabled();
    expect(screen.queryByTitle(/contract document/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^not issued yet$/i)).not.toBeInTheDocument();
  });

  it("shows an Edit button for a draft order that navigates to the V2 builder", async () => {
    authAs("producer");
    seedFor(order({ status: "draft", pdf_path: null, issued_at: null }));
    renderPage();
    const editBtn = await screen.findByRole("button", { name: /^edit$/i });
    fireEvent.click(editBtn);
    expect(await screen.findByText("EDIT STUB")).toBeInTheDocument();
  });

  it("shows an Edit button for a ready order too", async () => {
    authAs("producer");
    seedFor(order({ status: "ready", pdf_path: null, issued_at: null }));
    renderPage();
    expect(await screen.findByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("hides the Edit button for issued/countersigned orders and for an artist viewer", async () => {
    authAs("producer");
    seedFor(order({ status: "issued" }));
    renderPage();
    await screen.findByText("Performance contract");
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("shows an artist only a Download control, never Edit, even on a draft order", async () => {
    authAs("artist");
    seedFor(order({ status: "draft", pdf_path: null, issued_at: null }));
    renderPage();
    await screen.findByRole("button", { name: /download pdf/i });
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("shows the same inline error when a super-admin has no current org (org_id resolves to empty)", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: null,
      hasRole: (r: string) => r === "admin",
      roles: ["admin"],
    } as never);
    seedFor(order());
    renderPage();
    expect(await screen.findByText(/couldn't load the document/i)).toBeInTheDocument();
    expect(screen.queryByTitle(/contract document/i)).not.toBeInTheDocument();
  });
});

describe("HireOrderDetailPage marks the order seen for the linked artist", () => {
  function seenCalls() {
    const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
    return calls.filter((c) => c.table === "rpc:mark_hire_order_seen");
  }

  it("fires once for the linked artist viewing an issued order with viewed_at null", async () => {
    authAs("artist");
    seedClient({
      hire_orders: { data: order(), error: null },
      "fn:generate-hire-orders": { data: { url: SIGNED_URL }, error: null },
      artists: { data: LINKED_ARTIST, error: null },
    });
    renderPage();
    await screen.findByText("Performance contract");
    await waitFor(() => {
      expect(seenCalls()).toHaveLength(1);
      expect(seenCalls()[0].args[0]).toEqual({ p_order: "ho-1" });
    });
  });

  it("does not fire for a producer viewer, even on the same issued order", async () => {
    authAs("producer");
    seedFor(order());
    renderPage();
    await screen.findByText("Performance contract");
    expect(seenCalls()).toHaveLength(0);
  });

  it("does not fire for a draft order, even for the linked artist", async () => {
    authAs("artist");
    seedClient({
      hire_orders: { data: order({ status: "draft", pdf_path: null, issued_at: null }), error: null },
      "fn:generate-hire-orders": { data: { url: SIGNED_URL }, error: null },
      artists: { data: LINKED_ARTIST, error: null },
    });
    renderPage();
    await screen.findByText(/not issued yet/i);
    expect(seenCalls()).toHaveLength(0);
  });

  it("does not fire when viewed_at is already set", async () => {
    authAs("artist");
    seedClient({
      hire_orders: { data: order({ viewed_at: "2026-01-12T11:00:00Z" }), error: null },
      "fn:generate-hire-orders": { data: { url: SIGNED_URL }, error: null },
      artists: { data: LINKED_ARTIST, error: null },
    });
    renderPage();
    await screen.findByText("Performance contract");
    expect(seenCalls()).toHaveLength(0);
  });
});

describe("artist signing strip", () => {
  it("shows a signing prompt directly under the document when the artist may sign", async () => {
    await renderArtistViewingSignableOrder();
    expect(screen.getByText(/needs your signature/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Countersign/i })).toBeInTheDocument();
  });

  it("shows no signing strip for a producer viewing the same order", async () => {
    await renderProducerViewingIssuedOrder();
    expect(screen.queryByText(/needs your signature/i)).not.toBeInTheDocument();
  });
});
