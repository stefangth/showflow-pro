import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

// Mock the data-access layer (tested separately), never the supabase singleton —
// matches the repo convention (see AirtableSyncTab.test.tsx).
vi.mock("@/data/settings", () => ({
  resolveOrgSetting: vi.fn((_client: unknown, _orgId: unknown, key: string) => {
    if (key === "default_entitlements") return Promise.resolve({ booking_flow: true, hire_orders: false });
    return Promise.resolve({ skills: [], cities: [], casts: [] });
  }),
}));
vi.mock("@/data/platform", () => ({
  EMPTY_STARTER_TEMPLATE: { skills: [], cities: [], casts: [] },
  savePlatformSetting: vi.fn(() => Promise.resolve()),
  fetchPlatformBookingDefaults: vi.fn(),
  savePlatformBookingDefaults: vi.fn(() => Promise.resolve()),
}));

import { PlatformDefaultsTab } from "./PlatformDefaultsTab";
import { fetchPlatformBookingDefaults, savePlatformBookingDefaults, savePlatformSetting } from "@/data/platform";

const DEFAULTS = {
  offer_response_window_hours: 36,
  offer_digest_hour_berlin: 18,
  confirmation_digest_hour_berlin: 21,
  resend_from_address: "Platform <p@x.com>",
};

describe("PlatformDefaultsTab — booking engine defaults", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the platform booking defaults into the form", async () => {
    (fetchPlatformBookingDefaults as ReturnType<typeof vi.fn>).mockResolvedValue(DEFAULTS);
    renderWithProviders(<PlatformDefaultsTab />);
    const fromInput = await screen.findByLabelText("Default sender address (Resend)");
    expect((fromInput as HTMLInputElement).value).toBe("Platform <p@x.com>");
    expect((screen.getByLabelText("Offer response window (hours)") as HTMLInputElement).value).toBe("36");
    expect((screen.getByLabelText("Offer digest hour (Berlin)") as HTMLInputElement).value).toBe("18");
    expect((screen.getByLabelText("Confirmation digest hour (Berlin)") as HTMLInputElement).value).toBe("21");
  });

  it("saves edited values via savePlatformBookingDefaults", async () => {
    (fetchPlatformBookingDefaults as ReturnType<typeof vi.fn>).mockResolvedValue(DEFAULTS);
    renderWithProviders(<PlatformDefaultsTab />);
    const fromInput = await screen.findByLabelText("Default sender address (Resend)");
    fireEvent.change(fromInput, { target: { value: "New <n@ew.com>" } });
    fireEvent.click(screen.getByRole("button", { name: "Save booking defaults" }));
    await waitFor(() =>
      expect(savePlatformBookingDefaults).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          offer_response_window_hours: 36,
          offer_digest_hour_berlin: 18,
          confirmation_digest_hour_berlin: 21,
          resend_from_address: "New <n@ew.com>",
        }),
      ),
    );
  });
});

describe("PlatformDefaultsTab — default modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchPlatformBookingDefaults as ReturnType<typeof vi.fn>).mockResolvedValue(DEFAULTS);
  });

  it("loads the platform default entitlements into switches", async () => {
    renderWithProviders(<PlatformDefaultsTab />);
    const bookingFlowSwitch = await screen.findByRole("switch", { name: /booking flow/i });
    const hireOrdersSwitch = screen.getByRole("switch", { name: /hire orders/i });
    expect(bookingFlowSwitch).toBeChecked();
    expect(hireOrdersSwitch).not.toBeChecked();
  });

  it("saves a toggle via savePlatformSetting under the default_entitlements key", async () => {
    renderWithProviders(<PlatformDefaultsTab />);
    const hireOrdersSwitch = await screen.findByRole("switch", { name: /hire orders/i });
    fireEvent.click(hireOrdersSwitch);
    await waitFor(() =>
      expect(savePlatformSetting).toHaveBeenCalledWith(
        expect.anything(),
        "default_entitlements",
        expect.objectContaining({ booking_flow: true, hire_orders: true }),
      ),
    );
  });
});
