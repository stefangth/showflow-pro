import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { upsertOrgSetting } = vi.hoisted(() => ({ upsertOrgSetting: vi.fn(() => Promise.resolve()) }));
vi.mock("@/data/settings", () => ({ upsertOrgSetting }));
vi.mock("@/hooks/useBookingFlow", () => ({
  useFlowTimes: () => ({ data: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TimingStep } from "./TimingStep";
import { toast } from "sonner";

beforeEach(() => {
  upsertOrgSetting.mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("TimingStep", () => {
  it("saves the seeded values on a plain save", async () => {
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /save timing/i }));
    await waitFor(() =>
      expect(upsertOrgSetting).toHaveBeenCalledWith(expect.anything(), "org-1", "offer_response_window_hours", 48),
    );
  });

  it("rejects a cleared window field instead of writing a 0-hour window", async () => {
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    const windowInput = await screen.findByDisplayValue("48");
    fireEvent.change(windowInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save timing/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Enter a window of at least 1 hour and digest hours between 0 and 23."),
    );
    expect(upsertOrgSetting).not.toHaveBeenCalled();
  });

  it("rejects a digest hour outside 0..23", async () => {
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    const offerInput = await screen.findByDisplayValue("19");
    fireEvent.change(offerInput, { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: /save timing/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Enter a window of at least 1 hour and digest hours between 0 and 23."),
    );
    expect(upsertOrgSetting).not.toHaveBeenCalled();
  });
});
