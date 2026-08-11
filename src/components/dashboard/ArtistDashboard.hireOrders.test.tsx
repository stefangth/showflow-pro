import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import type { StageChainResult } from "@/lib/dashboard/stageChain.types";

/**
 * Task 14: ArtistDashboard's "Your hire orders" card lists the artist's own
 * issued/countersigned hire orders (order number, date, venue, status badge,
 * Download), and renders nothing when the hire_orders feature is off.
 *
 * Task 7 (R4.6): when the module is ON but the artist has no hire orders yet, the card
 * now renders with a zero-state message introducing the flow (a producer sends a hire
 * order by email, it can be reviewed/signed here), instead of hiding entirely. The
 * module-off case must still render nothing at all, even with orders present, so a
 * module-off org shows no trace of the feature.
 */

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, unknown>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed as never));
}

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({
  useMyArtist: () => ({ data: { id: "artist-1", name: "A" } }),
}));
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }),
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));

const featureHolder = { enabled: true };
vi.mock("@/hooks/useEntitlements", () => {
  const useFeature = () => featureHolder.enabled;
  // ModuleGate reads useModuleGate; derive it from the same rule so the two stay in step.
  return { useFeature, useModuleGate: () => ({ allow: useFeature(), pending: false }) };
});

// A minimal but fully-typed StageChainResult -- annotated so a future field rename in
// the real type is a compile error here, even though vi.mock factories themselves are
// not type-checked against the real hook signature.
const EMPTY_STAGE_CHAIN_RESULT: StageChainResult = {
  eyebrow: "", headline: "", body: "", ghost: "", hint: "",
  progressLabel: "", progressHint: "", hasSteps: false, ticks: [],
  modules: [], offFooters: [], hasChain: false, chainTitle: "", rulesBy: "",
  stages: [], sideTitle: "", sideBody: "", side: [],
  queueTitle: "", queueHint: "", sample: false, queueOpacity: 0, nothingOn: true,
};

// The first-run layer greets the artist above the dashboard body; with show:false it
// is a no-op (no surface) and the real body renders directly, so this card's
// assertions still exercise it. Mocked here so the real useDashboardFirstRun (which
// reads useEntitlements/useBookingSetup/etc.) does not run against this file's partial
// hook mocks. Shape matches the current hook contract (result/queueRows/dismiss/
// undismiss/openSetupAt) even though show:false keeps it inert, so a future show:true
// flip cannot crash on a stale pre-rewire shape.
vi.mock("@/components/dashboard/firstRun/useDashboardFirstRun", () => ({
  useDashboardFirstRun: () => ({
    show: false,
    result: EMPTY_STAGE_CHAIN_RESULT,
    queueRows: [],
    dismissed: false,
    dismiss: () => {},
    undismiss: () => {},
  }),
}));

import { ArtistDashboard } from "./ArtistDashboard";

function issuedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "ho-1",
    order_no: "HO-2026-0201-1",
    status: "issued",
    artist_id: "artist-1",
    show_date_id: "sd-1",
    data: {
      date: { value: "2026-02-01", source: "showflow" },
      venue: { value: "Main Hall", source: "showflow" },
    },
    ...overrides,
  };
}

describe("ArtistDashboard hire-orders card (Task 14)", () => {
  it("lists issued/countersigned orders with order number, date, venue and a status badge", async () => {
    featureHolder.enabled = true;
    seedClient({
      bookings: [{ when: { artist_id: "artist-1" }, data: [], error: null }],
      "my-cast-memberships": { data: [], error: null },
      cast_members: { data: [], error: null },
      hire_orders: { data: [issuedOrder()], error: null },
    });

    renderWithProviders(<ArtistDashboard />);

    expect(await screen.findByText("Your hire orders")).toBeInTheDocument();
    // The card now renders as soon as the module is on (Task 7's zero-state), independent
    // of myHireOrders resolving, so the order row itself needs an async query rather than
    // assuming it is already in the DOM alongside the card header.
    expect(await screen.findByText("HO-2026-0201-1")).toBeInTheDocument();
    expect(screen.getByText(/01\/02\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Main Hall/)).toBeInTheDocument();
    expect(screen.getByText(/awaiting countersign/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
    // No em/en dashes in the card copy.
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("shows a hire-orders zero-state when the module is on and there are no orders", async () => {
    featureHolder.enabled = true;
    seedClient({
      bookings: [{ when: { artist_id: "artist-1" }, data: [], error: null }],
      hire_orders: { data: [], error: null },
    });

    renderWithProviders(<ArtistDashboard />);

    expect(await screen.findByText("Your hire orders")).toBeInTheDocument();
    // The zero-state now renders only after the query resolves (not while loading /
    // on error), so wait for it rather than asserting synchronously.
    expect(
      await screen.findByText(/your booking paperwork shows up here/i),
    ).toBeInTheDocument();
    // No em/en dashes in the zero-state copy.
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("renders nothing when the hire_orders feature is off, even with orders present", async () => {
    featureHolder.enabled = false;
    seedClient({
      bookings: [{ when: { artist_id: "artist-1" }, data: [], error: null }],
      hire_orders: { data: [issuedOrder()], error: null },
    });

    renderWithProviders(<ArtistDashboard />);

    await screen.findByText("Dashboard");
    expect(screen.queryByText("Your hire orders")).not.toBeInTheDocument();
    expect(screen.queryByText(/your booking paperwork/i)).not.toBeInTheDocument();
  });

  it("tints a hire-order row whose snapshotted date is in the past (Plan B Task 2), leaves a future one untinted", async () => {
    featureHolder.enabled = true;
    seedClient({
      bookings: [{ when: { artist_id: "artist-1" }, data: [], error: null }],
      "my-cast-memberships": { data: [], error: null },
      cast_members: { data: [], error: null },
      hire_orders: {
        data: [
          issuedOrder({ id: "ho-past", order_no: "HO-PAST", data: { date: { value: "2020-01-01", source: "showflow" }, venue: { value: "Old Hall", source: "showflow" } } }),
          issuedOrder({ id: "ho-future", order_no: "HO-FUTURE", data: { date: { value: "2099-01-01", source: "showflow" }, venue: { value: "New Hall", source: "showflow" } } }),
        ],
        error: null,
      },
    });

    renderWithProviders(<ArtistDashboard />);

    const pastRow = (await screen.findByText("HO-PAST")).closest("div.flex.items-center.justify-between");
    const futureRow = screen.getByText("HO-FUTURE").closest("div.flex.items-center.justify-between");
    expect(pastRow).toBeTruthy();
    expect(futureRow).toBeTruthy();
    expect(pastRow!.className).toMatch(/opacity-60/);
    expect(pastRow!.className).not.toMatch(/pointer-events-none/);
    expect(futureRow!.className).not.toMatch(/opacity-60/);
  });

  it("clicking Download invokes the download-url action for that order", async () => {
    featureHolder.enabled = true;
    seedClient({
      bookings: [{ when: { artist_id: "artist-1" }, data: [], error: null }],
      hire_orders: { data: [issuedOrder({ id: "ho-2", order_no: "HO-2" })], error: null },
      "fn:generate-hire-orders": { data: { url: "https://signed.example/ho-2.pdf" }, error: null },
    });

    renderWithProviders(<ArtistDashboard />);

    fireEvent.click(await screen.findByRole("button", { name: /download/i }));
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      expect(invoke).toBeDefined();
      const body = invoke!.args[0] as { action: string; org_id: string; order_id: string };
      expect(body.action).toBe("download-url");
      expect(body.org_id).toBe("org-1");
      expect(body.order_id).toBe("ho-2");
    });
  });
});
