import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NewOrgDialog } from "./NewOrgDialog";
import * as platform from "@/data/platform";

describe("NewOrgDialog modules section", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults every module off and submits the chosen features", async () => {
    const provision = vi.spyOn(platform, "provisionOrg").mockResolvedValue("o1");
    renderWithProviders(<NewOrgDialog />);
    fireEvent.click(screen.getByRole("button", { name: /new organization/i }));

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/first admin email/i), { target: { value: "a@acme.com" } });

    const bookingEngine = screen.getByLabelText("Booking engine");
    const hireOrders = screen.getByLabelText("Hire orders");
    expect(bookingEngine).not.toBeChecked();
    expect(hireOrders).not.toBeChecked();

    fireEvent.click(bookingEngine); // turn one module on

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(provision).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          features: { booking_flow: true, hire_orders: false, language_packages: false },
        }),
      ),
    );
  });
});
