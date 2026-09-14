import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const renameOrg = vi.fn((..._a: unknown[]) => Promise.resolve());
const setOrgKind = vi.fn((..._a: unknown[]) => Promise.resolve());
const refreshOrgs = vi.fn(() => Promise.resolve());
vi.mock("@/data/orgs", async (orig) => ({
  ...(await orig<typeof import("@/data/orgs")>()),
  renameOrg: (...a: unknown[]) => renameOrg(...a),
  setOrgKind: (...a: unknown[]) => setOrgKind(...a),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({
    currentOrg: { id: "org-1", name: "Acme", slug: "acme", status: "active", is_demo: false, org_kind: "production", org_kind_set_at: null },
    refreshOrgs,
    hasRole: (r: string) => (r === "admin" ? h.isAdmin : false),
  }),
}));

// Controllable entitlement + org-language data for the workspace-language picker.
const h = vi.hoisted(() => ({ langPacks: false, orgLang: "en" as string, isAdmin: true }));
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: () => h.langPacks }));
const setOrgLanguage = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/data/settings", () => ({
  fetchOrgLanguage: () => Promise.resolve(h.orgLang),
  setOrgLanguage: (...a: unknown[]) => setOrgLanguage(...a),
}));

import { OrganizationTab } from "./OrganizationTab";

describe("OrganizationTab", () => {
  beforeEach(() => { vi.clearAllMocks(); h.langPacks = false; h.orgLang = "en"; h.isAdmin = true; });

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

  // Workspace-language picker: gated by the language_packages entitlement.
  describe("workspace language picker", () => {
    it("is hidden when language_packages is off", () => {
      h.langPacks = false;
      renderWithProviders(<OrganizationTab />);
      expect(screen.queryByLabelText(/workspace language/i)).toBeNull();
    });

    it("is shown and prefilled from the stored setting when entitled", async () => {
      h.langPacks = true;
      h.orgLang = "de";
      renderWithProviders(<OrganizationTab />);
      expect(await screen.findByLabelText(/workspace language/i)).toBeInTheDocument();
      // The selected value renders its native endonym in the trigger.
      await waitFor(() => expect(screen.getByText("Deutsch")).toBeInTheDocument());
    });

    it("disables the picker for a read-only producer, without writing on mount", async () => {
      h.langPacks = true;
      renderWithProviders(<OrganizationTab readOnly />);
      expect(await screen.findByLabelText(/workspace language/i)).toBeDisabled();
      expect(setOrgLanguage).not.toHaveBeenCalled();
    });
  });

  describe("workspace type picker", () => {
    it("shows the workspace type and saves a change through setOrgKind, then refreshes orgs", async () => {
      renderWithProviders(<OrganizationTab />);
      const select = screen.getByLabelText(/workspace type/i);
      expect(select).toHaveTextContent(/live production/i);
      fireEvent.click(select);
      fireEvent.click(await screen.findByRole("option", { name: /staffing agency/i }));
      await waitFor(() => expect(setOrgKind).toHaveBeenCalledWith(expect.anything(), "org-1", "staffing"));
      await waitFor(() => expect(refreshOrgs).toHaveBeenCalled());
    });

    it("disables the workspace type picker for a non-admin, even with rename_org (readOnly=false)", () => {
      // set_org_kind is hard admin-gated, so the picker follows hasRole('admin'), not the
      // rename_org capability that drives readOnly. A producer granted rename_org
      // (readOnly=false) must still see this control disabled.
      h.isAdmin = false;
      renderWithProviders(<OrganizationTab readOnly={false} />);
      expect(screen.getByLabelText(/workspace type/i)).toBeDisabled();
    });

    it("keeps the workspace type picker enabled for an admin regardless of readOnly", () => {
      renderWithProviders(<OrganizationTab readOnly />);
      expect(screen.getByLabelText(/workspace type/i)).not.toBeDisabled();
    });
  });
});
