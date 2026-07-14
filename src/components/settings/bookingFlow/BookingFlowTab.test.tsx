import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";

// The tab and its child hooks (useSettingsAudit) read `currentOrg` from useAuth.
// A null org keeps every internal query idle (enabled: Boolean(orgId)) so the tab
// renders without touching the network. The supabase client is stubbed for the
// same reason: no method is called on render, but the mock avoids constructing a
// real client from env vars.
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { BookingFlowTab } from "./BookingFlowTab";

function Harness() {
  const [draft, setDraft] = useState<Record<string, unknown>>({
    booking_flow: BOOKING_FLOW_DEFAULTS,
    offer_response_window_hours: 48,
    offer_digest_hour_berlin: 19,
    confirmation_digest_hour_berlin: 20,
  });
  return (
    <BookingFlowTab
      get={(k) => draft[k]}
      set={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
      dirtyKeys={[]}
      saving={false}
      onSave={() => {}}
      onDiscard={() => {}}
    />
  );
}

describe("BookingFlowTab", () => {
  it("selecting the Direct book preset flips the timeline into direct mode", () => {
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /direct book/i }));
    expect(screen.getAllByText("Skipped").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Locked on")).toBeInTheDocument();
  });

  it("shows the resulting lifecycle chips in the rail", () => {
    renderWithProviders(<Harness />);
    // "Suggested"/"Soft booked" also appear as timeline step badges, so scope the
    // assertion to the rail's Resulting lifecycle card to keep it unambiguous.
    const lifecycle = screen.getByText("Resulting lifecycle").parentElement as HTMLElement;
    expect(within(lifecycle).getByText("Suggested")).toBeInTheDocument();
    expect(within(lifecycle).getByText("Soft booked")).toBeInTheDocument();
  });
});
