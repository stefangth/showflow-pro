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
import { resolveOrgSetting } from "@/data/settings";

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
    // findByLabelText resolves the moment the input exists — during the loading
    // render, when it still holds the fallback value. Wait for the async-loaded
    // value before asserting, or this races the query resolution under load.
    await waitFor(() => expect((fromInput as HTMLInputElement).value).toBe("Platform <p@x.com>"));
    expect((screen.getByLabelText("Offer response window (hours)") as HTMLInputElement).value).toBe("36");
    expect((screen.getByLabelText("Offer digest hour (Berlin)") as HTMLInputElement).value).toBe("18");
    expect((screen.getByLabelText("Confirmation digest hour (Berlin)") as HTMLInputElement).value).toBe("21");
  });

  it("saves edited values via savePlatformBookingDefaults", async () => {
    (fetchPlatformBookingDefaults as ReturnType<typeof vi.fn>).mockResolvedValue(DEFAULTS);
    renderWithProviders(<PlatformDefaultsTab />);
    const fromInput = await screen.findByLabelText("Default sender address (Resend)");
    // Wait for the defaults to load before editing, so the untouched fields carry
    // the loaded values (not the loading fallback) into the save payload.
    await waitFor(() => expect((fromInput as HTMLInputElement).value).toBe("Platform <p@x.com>"));
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

// Data-loss regression: when a platform-defaults read fails, React Query settles to
// status:'error' with isLoading:false and data:undefined. A card that branches only on
// isLoading falls through and renders its blank/default form values as if they were the
// real saved platform-wide defaults, with Save (or a live-mutating Switch/Select) enabled.
// A super-admin acting on that screen then overwrites real defaults with empties — for
// every org on the platform. Each card must surface the failure instead and offer no
// write path while in that state.
describe("PlatformDefaultsTab — settings-read failure guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("StarterCatalogCard shows a destructive alert and no Save when the read fails, instead of a blank editable form", async () => {
    (resolveOrgSetting as ReturnType<typeof vi.fn>).mockImplementation((_c: unknown, _o: unknown, key: string) => {
      if (key === "starter_catalog_template") return Promise.reject(new Error("permission denied for table app_settings"));
      if (key === "default_entitlements") return Promise.resolve({ booking_flow: true, hire_orders: false });
      return Promise.resolve({ skills: [], cities: [], casts: [] });
    });
    (fetchPlatformBookingDefaults as ReturnType<typeof vi.fn>).mockResolvedValue(DEFAULTS);
    renderWithProviders(<PlatformDefaultsTab />);

    expect(await screen.findByText(/permission denied for table app_settings/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save defaults" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Skills")).not.toBeInTheDocument();
  });

  it("AirtableDefaultsCard shows a destructive alert and no Select when the read fails, instead of the fallback interval", async () => {
    (resolveOrgSetting as ReturnType<typeof vi.fn>).mockImplementation((_c: unknown, _o: unknown, key: string) => {
      if (key === "airtable_poll_interval_minutes") return Promise.reject(new Error("network error"));
      if (key === "default_entitlements") return Promise.resolve({ booking_flow: true, hire_orders: false });
      return Promise.resolve({ skills: [], cities: [], casts: [] });
    });
    (fetchPlatformBookingDefaults as ReturnType<typeof vi.fn>).mockResolvedValue(DEFAULTS);
    renderWithProviders(<PlatformDefaultsTab />);

    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
    expect(screen.queryByText("Default sync frequency")).not.toBeInTheDocument();
  });

  it("DefaultModulesCard shows a destructive alert and no Switches when the read fails, instead of the registry fallback", async () => {
    (resolveOrgSetting as ReturnType<typeof vi.fn>).mockImplementation((_c: unknown, _o: unknown, key: string) => {
      if (key === "default_entitlements") return Promise.reject(new Error("permission denied for table app_settings"));
      return Promise.resolve({ skills: [], cities: [], casts: [] });
    });
    (fetchPlatformBookingDefaults as ReturnType<typeof vi.fn>).mockResolvedValue(DEFAULTS);
    renderWithProviders(<PlatformDefaultsTab />);

    expect(await screen.findAllByText(/permission denied for table app_settings/i)).not.toHaveLength(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});

// Each of these three cards held a COPY of its platform setting, seeded once by an
// effect behind a ref. The copy is what Save persists, so any moment it is not the
// stored value is a moment Save writes the wrong thing over it -- including the
// commit that opens the isLoading gate, where the copy is still the code default.
// (The booking-defaults test above works around exactly that window: "findByLabelText
// resolves the moment the input exists -- during the loading render, when it still
// holds the fallback value.")
//
// The permanent, deterministic half of the same root cause is a refetch. These are
// PLATFORM settings with several super-admins, so a tab left open goes stale and its
// Save silently reverts whatever the other admin just changed. Deriving the draft
// fixes both, and has to keep the guarantee the ref was there for: once edited, the
// form is pinned and no refetch may wipe work in progress.
describe("PlatformDefaultsTab — drafts track the stored settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("booking defaults follow a refetch while untouched, and pin once edited", async () => {
    (fetchPlatformBookingDefaults as ReturnType<typeof vi.fn>).mockResolvedValue(DEFAULTS);
    const { queryClient } = renderWithProviders(<PlatformDefaultsTab />);
    const windowInput = await screen.findByLabelText("Offer response window (hours)");
    await waitFor(() => expect((windowInput as HTMLInputElement).value).toBe("36"));

    (fetchPlatformBookingDefaults as ReturnType<typeof vi.fn>).mockResolvedValue({ ...DEFAULTS, offer_response_window_hours: 72 });
    await queryClient.invalidateQueries({ queryKey: ["platform", "booking-defaults"] });
    await waitFor(() => expect((windowInput as HTMLInputElement).value).toBe("72"));

    fireEvent.change(windowInput, { target: { value: "12" } });
    (fetchPlatformBookingDefaults as ReturnType<typeof vi.fn>).mockResolvedValue({ ...DEFAULTS, offer_response_window_hours: 99 });
    await queryClient.invalidateQueries({ queryKey: ["platform", "booking-defaults"] });
    expect((windowInput as HTMLInputElement).value).toBe("12");
  });

  it("the starter catalog follows a refetch while untouched", async () => {
    const { queryClient } = renderWithProviders(<PlatformDefaultsTab />);
    const skills = await screen.findByLabelText("Skills");
    await waitFor(() => expect((skills as HTMLTextAreaElement).value).toBe(""));

    (resolveOrgSetting as ReturnType<typeof vi.fn>).mockImplementation((_c: unknown, _o: unknown, key: string) => {
      if (key === "default_entitlements") return Promise.resolve({ booking_flow: true, hire_orders: false });
      return Promise.resolve({ skills: ["Juggling"], cities: [], casts: [] });
    });
    await queryClient.invalidateQueries({ queryKey: ["platform", "starter-template"] });

    await waitFor(() => expect((skills as HTMLTextAreaElement).value).toBe("Juggling"));
  });

  it("the terms library follows a refetch while untouched", async () => {
    (resolveOrgSetting as ReturnType<typeof vi.fn>).mockImplementation((_c: unknown, _o: unknown, key: string) => {
      if (key === "default_entitlements") return Promise.resolve({ booking_flow: true, hire_orders: false });
      if (key === "hire_order_terms_library") return Promise.resolve({ templates: [{ id: "a", name: "First", clauses: [] }] });
      return Promise.resolve({ skills: [], cities: [], casts: [] });
    });
    const { queryClient } = renderWithProviders(<PlatformDefaultsTab />);
    const json = await screen.findByLabelText("Templates (JSON)");
    await waitFor(() => expect((json as HTMLTextAreaElement).value).toContain("First"));

    (resolveOrgSetting as ReturnType<typeof vi.fn>).mockImplementation((_c: unknown, _o: unknown, key: string) => {
      if (key === "default_entitlements") return Promise.resolve({ booking_flow: true, hire_orders: false });
      if (key === "hire_order_terms_library") return Promise.resolve({ templates: [{ id: "b", name: "Second", clauses: [] }] });
      return Promise.resolve({ skills: [], cities: [], casts: [] });
    });
    await queryClient.invalidateQueries({ queryKey: ["platform", "terms-library"] });

    await waitFor(() => expect((json as HTMLTextAreaElement).value).toContain("Second"));
  });
});
