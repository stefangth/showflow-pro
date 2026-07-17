import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// The card reads the shared supabase client through its Task-11 hooks
// (useHireOrdersForDate / useHireOrderAction) and its feature gate
// (useFeature -> useEntitlements -> fetchEntitlements), plus useAuth for the
// current org. Same harness as HireOrdersTab.test.tsx: a call-recording fake
// swapped into a hoisted holder (never a hand-rolled vi.mock chain), and
// useAuth as a vi.fn() so each test picks the active org.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
// The Task 14 artist branch (ArtistHireOrders) reads useMyHireOrders, which is
// backed by useMyArtist -> useEffectiveUserId (AuthContext). Mocking useMyArtist
// directly (same convention as useHireOrders.test.ts / the flowCopy dashboard
// tests) keeps this file from needing a real AuthProvider.
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { HireOrdersCard } from "./HireOrdersCard";

function authAs(orgId: string) {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: { id: orgId, name: "Aurora Productions", slug: "aurora" },
  } as never);
}

const ENTITLEMENTS: Record<string, TableSeed> = {
  org_entitlements: [
    { when: { org_id: "org-on" }, data: [{ feature: "hire_orders", enabled: true }], error: null },
    { when: { org_id: "org-off" }, data: [{ feature: "hire_orders", enabled: false }], error: null },
  ],
};

const SHOW_DATE_FILLED = {
  id: "sd-1",
  date: "2026-02-01",
  venue: "Main Hall",
  duration_minutes: 90,
  status: "fully_filled",
  show: { program: "Aurora", sub_program: null },
  city: { name: "Berlin" },
} as never;

const SHOW_DATE_OPEN = { ...(SHOW_DATE_FILLED as object), status: "open" } as never;

const CONFIRMED_BOOKING = {
  id: "bk-1",
  status: "confirmed",
  artist: { id: "ar-1", name: "Ada Lovelace" },
} as never;

/** A hire_orders row shaped like fetchHireOrdersForDate returns it (artist joined). */
function order(overrides: Record<string, unknown>) {
  return {
    id: "ho-1",
    order_no: "HO-2026-0201-1",
    status: "draft",
    booking_id: "bk-1",
    artist_id: "ar-1",
    show_date_id: "sd-1",
    fee_amount: 500,
    fee_currency: "EUR",
    terms_variant: "standard",
    data: {},
    artists: { name: "Ada Lovelace" },
    ...overrides,
  };
}

describe("HireOrdersCard", () => {
  beforeEach(() => {
    seedClient({ ...ENTITLEMENTS, hire_orders: { data: [], error: null } });
    vi.mocked(useMyArtist).mockReset();
  });

  it("renders nothing when the org is not entitled to hire_orders", async () => {
    authAs("org-off");
    const { queryClient } = renderWithProviders(
      <HireOrdersCard showDateId="sd-1" showDate={SHOW_DATE_FILLED} bookings={[CONFIRMED_BOOKING]} canManage />,
    );
    await waitFor(() =>
      expect(queryClient.getQueryState(["entitlements", "org-off"])?.status).toBe("success"),
    );
    expect(screen.queryByText("Hire orders")).not.toBeInTheDocument();
  });

  it("shows the fully-filled banner and a Generate button when a confirmed booking lacks an order", async () => {
    authAs("org-on");
    renderWithProviders(
      <HireOrdersCard showDateId="sd-1" showDate={SHOW_DATE_FILLED} bookings={[CONFIRMED_BOOKING]} canManage />,
    );
    expect(await screen.findByText("Hire orders")).toBeInTheDocument();
    expect(await screen.findByText(/fully filled and ready for hire orders/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate hire orders/i })).toBeInTheDocument();
    // No em/en dashes in the banner copy.
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("uses the non-fully-filled banner copy when the date is not fully filled", async () => {
    authAs("org-on");
    renderWithProviders(
      <HireOrdersCard showDateId="sd-1" showDate={SHOW_DATE_OPEN} bookings={[CONFIRMED_BOOKING]} canManage />,
    );
    expect(await screen.findByText(/generate for confirmed artists/i)).toBeInTheDocument();
    expect(screen.queryByText(/fully filled and ready/i)).not.toBeInTheDocument();
  });

  it("clicking Generate hire orders invokes the draft action for the date", async () => {
    authAs("org-on");
    seedClient({
      ...ENTITLEMENTS,
      hire_orders: { data: [], error: null },
      "fn:generate-hire-orders": { data: { created: ["ho-1"], skipped: [] }, error: null },
    });
    renderWithProviders(
      <HireOrdersCard showDateId="sd-1" showDate={SHOW_DATE_FILLED} bookings={[CONFIRMED_BOOKING]} canManage />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /generate hire orders/i }));
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      expect(invoke).toBeDefined();
      const body = invoke!.args[0] as { action: string; show_date_id: string; org_id: string };
      expect(body.action).toBe("draft");
      expect(body.show_date_id).toBe("sd-1");
      expect(body.org_id).toBe("org-on");
    });
  });

  it("renders one row per existing order with a status badge and the right action", async () => {
    authAs("org-on");
    seedClient({
      ...ENTITLEMENTS,
      hire_orders: {
        data: [
          order({ id: "ho-1", order_no: "HO-2026-0201-1", status: "draft", booking_id: "bk-1", artists: { name: "Ada Lovelace" } }),
          order({ id: "ho-2", order_no: "HO-2026-0201-2", status: "issued", booking_id: "bk-2", artist_id: "ar-2", artists: { name: "Grace Hopper" } }),
        ],
        error: null,
      },
    });
    const bookings = [
      CONFIRMED_BOOKING,
      { id: "bk-2", status: "confirmed", artist: { id: "ar-2", name: "Grace Hopper" } },
    ] as never;
    renderWithProviders(
      <HireOrdersCard showDateId="sd-1" showDate={SHOW_DATE_FILLED} bookings={bookings} canManage />,
    );

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("HO-2026-0201-1")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("HO-2026-0201-2")).toBeInTheDocument();

    // Status signals: draft -> Draft; issued -> Awaiting countersign.
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText(/awaiting countersign/i)).toBeInTheDocument();

    // Actions: draft -> Review and issue; issued -> Download.
    expect(screen.getByRole("button", { name: /review and issue/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();

    // Every confirmed booking already has an order, so no generate banner.
    expect(screen.queryByRole("button", { name: /generate hire orders/i })).not.toBeInTheDocument();
  });

  it("surfaces a destructive alert when the orders query fails", async () => {
    authAs("org-on");
    seedClient({
      ...ENTITLEMENTS,
      hire_orders: { data: null, error: new Error("permission denied for table hire_orders") },
    });
    renderWithProviders(
      <HireOrdersCard showDateId="sd-1" showDate={SHOW_DATE_FILLED} bookings={[CONFIRMED_BOOKING]} canManage />,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/could not load hire orders/i)).toBeInTheDocument();
  });
});

describe("HireOrdersCard artist variant (Task 14)", () => {
  beforeEach(() => {
    seedClient({ ...ENTITLEMENTS, hire_orders: { data: [], error: null } });
    vi.mocked(useMyArtist).mockReset();
  });

  it("renders nothing when the viewer has no linked artist profile", async () => {
    authAs("org-on");
    vi.mocked(useMyArtist).mockReturnValue({ data: null } as never);
    const { queryClient } = renderWithProviders(
      <HireOrdersCard showDateId="sd-1" showDate={SHOW_DATE_FILLED} bookings={[CONFIRMED_BOOKING]} canManage={false} />,
    );
    await waitFor(() =>
      expect(queryClient.getQueryState(["entitlements", "org-on"])?.status).toBe("success"),
    );
    expect(screen.queryByText("Hire order")).not.toBeInTheDocument();
    expect(screen.queryByText("Hire orders")).not.toBeInTheDocument();
    // The producer-only controls never appear for an artist viewer.
    expect(screen.queryByRole("button", { name: /generate hire orders/i })).not.toBeInTheDocument();
  });

  it("renders nothing when the artist has no order for this date", async () => {
    authAs("org-on");
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: "ar-1" } } as never);
    seedClient({
      ...ENTITLEMENTS,
      hire_orders: {
        data: [order({ id: "ho-9", show_date_id: "sd-OTHER", artist_id: "ar-1", status: "issued" })],
        error: null,
      },
    });
    const { queryClient } = renderWithProviders(
      <HireOrdersCard showDateId="sd-1" showDate={SHOW_DATE_FILLED} bookings={[CONFIRMED_BOOKING]} canManage={false} />,
    );
    await waitFor(() =>
      expect(queryClient.getQueryState(["entitlements", "org-on"])?.status).toBe("success"),
    );
    expect(screen.queryByText("Hire order")).not.toBeInTheDocument();
  });

  it("renders a read-only row with the order number, status badge and Download for the artist's own order on this date", async () => {
    authAs("org-on");
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: "ar-1" } } as never);
    seedClient({
      ...ENTITLEMENTS,
      hire_orders: {
        data: [
          order({
            id: "ho-9",
            order_no: "HO-2026-0201-9",
            show_date_id: "sd-1",
            artist_id: "ar-1",
            status: "issued",
          }),
        ],
        error: null,
      },
    });
    renderWithProviders(
      <HireOrdersCard showDateId="sd-1" showDate={SHOW_DATE_FILLED} bookings={[CONFIRMED_BOOKING]} canManage={false} />,
    );

    expect(await screen.findByText("Hire order")).toBeInTheDocument();
    expect(screen.getByText("HO-2026-0201-9")).toBeInTheDocument();
    expect(screen.getByText(/awaiting countersign/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();

    // Never the producer's controls.
    expect(screen.queryByRole("button", { name: /generate hire orders/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /review and issue/i })).not.toBeInTheDocument();
    // No em/en dashes in the row copy.
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("clicking Download invokes the download-url action for the artist's own order", async () => {
    authAs("org-on");
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: "ar-1" } } as never);
    seedClient({
      ...ENTITLEMENTS,
      hire_orders: {
        data: [
          order({
            id: "ho-9",
            order_no: "HO-2026-0201-9",
            show_date_id: "sd-1",
            artist_id: "ar-1",
            status: "countersigned",
          }),
        ],
        error: null,
      },
      "fn:generate-hire-orders": { data: { url: "https://signed.example/ho-9.pdf" }, error: null },
    });
    renderWithProviders(
      <HireOrdersCard showDateId="sd-1" showDate={SHOW_DATE_FILLED} bookings={[CONFIRMED_BOOKING]} canManage={false} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /download/i }));
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      expect(invoke).toBeDefined();
      const body = invoke!.args[0] as { action: string; org_id: string; order_id: string };
      expect(body.action).toBe("download-url");
      expect(body.org_id).toBe("org-on");
      expect(body.order_id).toBe("ho-9");
    });
  });
});
