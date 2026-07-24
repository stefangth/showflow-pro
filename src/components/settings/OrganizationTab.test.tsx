import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const renameOrg = vi.fn((..._a: unknown[]) => Promise.resolve());
const refreshOrgs = vi.fn(() => Promise.resolve());
vi.mock("@/data/orgs", async (orig) => ({ ...(await orig<typeof import("@/data/orgs")>()), renameOrg: (...a: unknown[]) => renameOrg(...a) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Acme", slug: "acme", status: "active" }, refreshOrgs }),
}));

import { OrganizationTab } from "./OrganizationTab";

describe("OrganizationTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prefills the name and shows slug read-only", () => {
    renderWithProviders(<OrganizationTab />);
    expect(screen.getByLabelText(/organization name/i)).toHaveValue("Acme");
    expect(screen.getByLabelText(/slug/i)).toBeDisabled();
  });

  it("rejects a blank name", async () => {
    renderWithProviders(<OrganizationTab />);
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(renameOrg).not.toHaveBeenCalled();
  });

  it("saves a new name then refreshes orgs", async () => {
    renderWithProviders(<OrganizationTab />);
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "Acme Theatre" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(renameOrg).toHaveBeenCalledWith({}, "org-1", "Acme Theatre"));
    await waitFor(() => expect(refreshOrgs).toHaveBeenCalled());
  });

  // Capability read-only floor: a producer without `rename_org` sees the real org name
  // but can't submit a change.
  describe("readOnly", () => {
    it("disables the name input and Save button, but still shows the real name", () => {
      renderWithProviders(<OrganizationTab readOnly />);
      expect(screen.getByLabelText(/organization name/i)).toHaveValue("Acme");
      expect(screen.getByLabelText(/organization name/i)).toBeDisabled();
      expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    });

    it("leaves the input and Save button enabled when readOnly is false", () => {
      renderWithProviders(<OrganizationTab readOnly={false} />);
      expect(screen.getByLabelText(/organization name/i)).toBeEnabled();
      expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
    });
  });
});
