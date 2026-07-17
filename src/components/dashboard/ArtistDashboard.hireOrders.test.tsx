import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * Task 14: ArtistDashboard's "Your hire orders" card lists the artist's own
 * issued/countersigned hire orders (order number, date, venue, status badge,
 * Download), and renders nothing (no empty card) when the hire_orders feature
 * is off, or the list is empty.
 */

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, unknown>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed as never));
}

vi.mock("react-router-dom", () => ({
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
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: () => featureHolder.enabled,
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
    expect(screen.getByText("HO-2026-0201-1")).toBeInTheDocument();
    expect(screen.getByText(/01\/02\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Main Hall/)).toBeInTheDocument();
    expect(screen.getByText(/awaiting countersign/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
    // No em/en dashes in the card copy.
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("renders nothing when the list of orders is empty", async () => {
    featureHolder.enabled = true;
    seedClient({
      bookings: [{ when: { artist_id: "artist-1" }, data: [], error: null }],
      hire_orders: { data: [], error: null },
    });

    renderWithProviders(<ArtistDashboard />);

    await screen.findByText("Dashboard");
    expect(screen.queryByText("Your hire orders")).not.toBeInTheDocument();
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
