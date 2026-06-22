import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const createShowDate = vi.fn(() => Promise.resolve({ id: "d-new" }));
const openOfferTier = vi.fn(() => Promise.resolve({ offersCreated: 1 }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: () => true }) }));
vi.mock("@/data/showDates", async (orig) => ({ ...(await orig<typeof import("@/data/showDates")>()), createShowDate: (...a: unknown[]) => createShowDate(...a), fetchShowDatesForShow: () => Promise.resolve([]) }));
vi.mock("@/data/bookings", async (orig) => ({ ...(await orig<typeof import("@/data/bookings")>()), openOfferTier: (...a: unknown[]) => openOfferTier(...a) }));
vi.mock("@/hooks/useShows", async (orig) => ({ ...(await orig<typeof import("@/hooks/useShows")>()), useShows: () => ({ data: [
  { id: "s1", program: "Configured", sub_program: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 1, category: null, description: null, dateCount: 0 },
  { id: "s2", program: "NoSlots", sub_program: null, status: "active", main_cast_slots: null, understudy_slots: null, airtable_program_key: null, sort_order: 2, category: null, description: null, dateCount: 0 },
], isLoading: false }) }));
vi.mock("@/hooks/useCities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCities")>()), useCities: () => ({ data: [{ id: "c1", name: "Berlin", airtable_city_key: null }] }) }));

import { ShowDateFormDialog } from "./ShowDateFormDialog";

describe("ShowDateFormDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create requires a production and a date", async () => {
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" />);
    fireEvent.click(screen.getByRole("button", { name: /create date/i }));
    expect(await screen.findByText(/production is required/i)).toBeInTheDocument();
    expect(createShowDate).not.toHaveBeenCalled();
  });

  it("synced date locks the date field, keeps notes editable", () => {
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={{ id: "d1", show_id: "s1", date: "2026-07-01", session_1: null, session_2: null, session_3: null, venue: null, city_id: null, notes: "n", airtable_record_id: "rec1", status: "open" }} />);
    expect(screen.getByText(/synced from airtable/i)).toBeInTheDocument();
    expect(screen.getByTestId("date-trigger")).toBeDisabled();
    expect(screen.getByLabelText(/notes/i)).not.toBeDisabled();
  });
});
