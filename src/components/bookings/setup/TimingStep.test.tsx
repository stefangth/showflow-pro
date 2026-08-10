import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { upsertOrgSetting, timesRef, timesErrorRef } = vi.hoisted(() => ({
  upsertOrgSetting: vi.fn(() => Promise.resolve()),
  // Ref-held so a test can put the query back in its loading state (data
  // undefined), which is where the step used to offer a Save, or into its
  // error state, where data is undefined FOREVER.
  timesRef: { value: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } as unknown },
  timesErrorRef: { value: null as Error | null },
}));
vi.mock("@/data/settings", () => ({ upsertOrgSetting }));
vi.mock("@/hooks/useBookingFlow", () => ({
  useFlowTimes: () => ({
    data: timesRef.value,
    isError: Boolean(timesErrorRef.value),
    error: timesErrorRef.value,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TimingStep } from "./TimingStep";
import { toast } from "sonner";

beforeEach(() => {
  timesRef.value = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };
  timesErrorRef.value = null;
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

  // The worst instance of the seed-once pattern in the tree, because this step had no
  // loading gate at all: the three inputs rendered pre-filled with BOOKING_ENGINE
  // defaults (48 / 19 / 20) and Save was enabled for the WHOLE fetch, not one commit.
  // An org running a 72h window that opened the rail and hit Save before the read
  // landed had its real timing replaced by the code defaults, with nothing on screen
  // to suggest the values shown were not its own.
  it("offers no Save while the org's stored timing is still loading", () => {
    timesRef.value = undefined;
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);

    expect(screen.queryByRole("button", { name: /save timing/i })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("48")).not.toBeInTheDocument();
  });

  // The step is reachable with no active org (a super-admin bypasses the org gate),
  // where the query never runs and so never resolves. That must not be an eternal
  // skeleton - Save is already disabled without an org.
  it("still renders without an active org, where the query never runs", () => {
    timesRef.value = undefined;
    renderWithProviders(<TimingStep orgId={null} onDone={() => {}} />);

    expect(screen.getByRole("button", { name: /save timing/i })).toBeDisabled();
  });

  // Withholding the panel until the read lands turns a failed read into an
  // indefinite skeleton, because `data` stays undefined once React Query has
  // exhausted its retries -- a silent dead end in the rail with nothing to explain
  // it. The siblings fixed alongside this one (LetterheadStep, CountersignStep)
  // already show an alert for the same case.
  it("surfaces the failed read instead of holding the skeleton forever", () => {
    timesRef.value = undefined;
    timesErrorRef.value = new Error("permission denied");
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load the timing/i);
    expect(screen.getByRole("alert")).toHaveTextContent("permission denied");
    expect(screen.queryByRole("button", { name: /save timing/i })).not.toBeInTheDocument();
  });
});
