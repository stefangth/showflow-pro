import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { Toaster } from "@/components/ui/toaster";

/**
 * Task 5 (R3.1/R3.2): Accept/Decline toasts are flow-aware. Accept tells the artist what
 * actually happened (mirrors acceptConsequenceNote); Decline reassures that declining one
 * offer does not affect future offers. The real `use-toast` module + a mounted <Toaster/>
 * are used (not a spy) so the assertions exercise the rendered toast text, per the brief's
 * test sketch.
 */

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, unknown>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed as never));
}

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));

import { OfferResponseButtons } from "./OfferResponseButtons";

function renderButtons() {
  return renderWithProviders(
    <>
      <OfferResponseButtons bookingId="b1" />
      <Toaster />
    </>,
  );
}

// The Accept button stays disabled until useBookingFlow's query resolves (it feeds the
// autoConfirm decision), so a click fired before that resolves is a no-op on a disabled
// button. Wait for it to become enabled before clicking.
async function clickAccept() {
  const btn = await screen.findByRole("button", { name: /accept/i });
  await waitFor(() => expect(btn).not.toBeDisabled());
  fireEvent.click(btn);
}

describe("OfferResponseButtons toasts (Task 5)", () => {
  it("accept toast tells a hold-flow artist the producer confirms next", async () => {
    seedClient({
      bookings: { data: [{ id: "b1" }], error: null },
      // No app_settings override -> fetchBookingFlow resolves BOOKING_FLOW_DEFAULTS
      // (producer_confirmation: true), the classic hold-then-confirm flow.
      app_settings: [{ when: { key: "booking_flow" }, data: [], error: null }],
    });

    renderButtons();

    await clickAccept();

    expect(await screen.findByText("Offer accepted")).toBeInTheDocument();
    expect(await screen.findByText(/hold placed\. your producer confirms next/i)).toBeInTheDocument();
  });

  it("accept toast tells an auto-confirm artist they're booked", async () => {
    seedClient({
      bookings: { data: [{ id: "b1" }], error: null },
      app_settings: [
        {
          when: { key: "booking_flow" },
          data: [{ org_id: "org-1", value: { producer_confirmation: false } }],
          error: null,
        },
      ],
    });

    renderButtons();

    await clickAccept();

    expect(await screen.findByText("Offer accepted. You're booked.")).toBeInTheDocument();
  });

  it("decline toast reassures about future offers", async () => {
    seedClient({
      bookings: { data: [{ id: "b1" }], error: null },
      app_settings: [{ when: { key: "booking_flow" }, data: [], error: null }],
    });

    renderButtons();

    fireEvent.click(await screen.findByRole("button", { name: /decline/i }));

    expect(await screen.findByText("Offer declined")).toBeInTheDocument();
    expect(await screen.findByText(/will not affect future offers/i)).toBeInTheDocument();
  });
});
