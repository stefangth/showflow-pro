import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { BOOKING_FLOW_TEMPLATE_DEFAULTS } from "@/lib/bookingFlow";

const fetchTemplates = vi.fn((_client: unknown) => Promise.resolve(BOOKING_FLOW_TEMPLATE_DEFAULTS));
const saveTemplates = vi.fn((_client: unknown, _templates: typeof BOOKING_FLOW_TEMPLATE_DEFAULTS) => Promise.resolve());
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/data/platform", async (original) => ({
  ...(await original<typeof import("@/data/platform")>()),
  fetchPlatformBookingTemplates: (client: unknown) => fetchTemplates(client),
  savePlatformBookingTemplates: (client: unknown, templates: typeof BOOKING_FLOW_TEMPLATE_DEFAULTS) => saveTemplates(client, templates),
}));

import { BookingTemplatesDefaultsCard } from "./BookingTemplatesDefaultsCard";

describe("BookingTemplatesDefaultsCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("edits four platform templates and saves the active definition without clobbering siblings", async () => {
    renderWithProviders(<BookingTemplatesDefaultsCard />);

    expect(await screen.findByRole("tab", { name: "Classic" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Fast-track" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Direct book" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Off" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Fast-track" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Fast-track" })).toHaveAttribute("data-state", "active"));
    const windowInput = screen.getByLabelText("Response window (h)");
    fireEvent.change(windowInput, { target: { value: "72" } });
    await waitFor(() => expect(windowInput).toHaveValue(72));
    fireEvent.click(screen.getByRole("button", { name: "Save booking templates" }));

    await waitFor(() => expect(saveTemplates).toHaveBeenCalled());
    const saved = saveTemplates.mock.calls[0]?.[1];
    expect(saved).toBeDefined();
    if (!saved) throw new Error("Expected templates to be saved");
    expect(saved.fasttrack.times.windowHours).toBe(72);
    expect(saved.classic).toEqual(BOOKING_FLOW_TEMPLATE_DEFAULTS.classic);
  });

  it("does not offer org-specific custom fields in platform templates", async () => {
    renderWithProviders(<BookingTemplatesDefaultsCard />);
    await screen.findByRole("tab", { name: "Classic" });
    fireEvent.click(screen.getByRole("combobox", { name: "Reference field" }));
    expect(screen.queryByRole("option", { name: /custom field/i })).not.toBeInTheDocument();
  });

  it.each([
    ["Response window (h)", "0", /window must be between 1 and 336 hours/i],
    ["Digest hour (Berlin, Germany)", "24", /digest hours must be between 0 and 23/i],
    ["Hour (Berlin, Germany)", "-1", /digest hours must be between 0 and 23/i],
  ])("blocks saving an invalid %s", async (label, value, message) => {
    renderWithProviders(<BookingTemplatesDefaultsCard />);
    const input = await screen.findByLabelText(label);

    fireEvent.change(input, { target: { value } });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save booking templates" })).toBeDisabled();
    expect(saveTemplates).not.toHaveBeenCalled();
  });
});
