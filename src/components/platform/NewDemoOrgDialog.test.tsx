import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mutate = vi.fn();
vi.mock("@/hooks/useDemo", () => ({
  useCreateDemoOrg: () => ({ mutate, isPending: false }),
}));

import { NewDemoOrgDialog } from "./NewDemoOrgDialog";

describe("NewDemoOrgDialog", () => {
  beforeEach(() => {
    mutate.mockReset();
  });

  it("submits the form values to useCreateDemoOrg", async () => {
    renderWithProviders(<NewDemoOrgDialog />);
    fireEvent.click(screen.getByRole("button", { name: /new demo org/i }));

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Rheinbühne" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "rheinbuehne" } });
    fireEvent.change(screen.getByLabelText("Rep email"), { target: { value: "rep@demo.invalid" } });

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        {
          name: "Rheinbühne",
          slug: "rheinbuehne",
          adminEmail: "rep@demo.invalid",
          appOrigin: window.location.origin,
          volume: "full",
        },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
      ),
    );
  });
});
