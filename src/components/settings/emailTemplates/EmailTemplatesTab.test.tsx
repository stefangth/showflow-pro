import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";

const { invoke, fetchSettings } = vi.hoisted(() => ({
  invoke: vi.fn(),
  fetchSettings: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
vi.mock("@/data/emailTemplates", () => ({
  fetchEmailTemplateSettings: fetchSettings,
}));

import { EmailTemplatesTab } from "./EmailTemplatesTab";

describe("EmailTemplatesTab", () => {
  beforeEach(() => {
    invoke.mockResolvedValue({
      data: { templates: [{ html: "<h1>Saved preview</h1>" }] },
      error: null,
    });
    fetchSettings.mockResolvedValue({
      copy: { "offer-immediate.subject": "A saved subject" },
      theme: { base: { footerText: "Saved footer" } },
    });
  });

  it("groups all customer and external rows while keeping internal system delivery private", async () => {
    renderWithProviders(<EmailTemplatesTab readOnly={false} isSuperAdmin={false} />);

    expect(await screen.findByText("Booking engine")).toBeInTheDocument();
    expect(screen.getByText("Hire orders")).toBeInTheDocument();
    expect(screen.getByText("Accounts & access")).toBeInTheDocument();
    expect(screen.getByText("Immediate offer")).toBeInTheDocument();
    expect(screen.getByText("Hire order countersigned")).toBeInTheDocument();
    expect(screen.getByText("Password reset")).toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
    expect(screen.queryByText("Cron health alert")).not.toBeInTheDocument();
    expect(screen.getByText("External")).toBeInTheDocument();
  });

  it("shows the internal system row only to super-admins", async () => {
    renderWithProviders(<EmailTemplatesTab readOnly={false} isSuperAdmin />);

    expect(await screen.findByText("System")).toBeInTheDocument();
    expect(screen.getByText("Cron health alert")).toBeInTheDocument();
    expect(screen.getByText("Internal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit cron health alert/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /preview cron health alert/i })).not.toBeInTheDocument();
  });

  it("requests a preview with saved copy and theme, then renders it in a sandboxed iframe", async () => {
    renderWithProviders(<EmailTemplatesTab readOnly={false} isSuperAdmin={false} />);

    const previewButton = await screen.findByRole("button", { name: /preview immediate offer/i });
    await waitFor(() => expect(previewButton).toBeEnabled());
    fireEvent.click(previewButton);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("preview-transactional-email", {
      body: {
        templateName: "offer-immediate",
        copyOverride: { "offer-immediate.subject": "A saved subject" },
        themeOverride: { base: { footerText: "Saved footer" } },
      },
    }));
    const preview = await screen.findByTitle("Email preview");
    expect(preview).toHaveAttribute("sandbox", "allow-same-origin");
    expect(preview).toHaveAttribute("srcdoc", "<h1>Saved preview</h1>");
  });

  it("waits for the effective saved presentation before enabling preview", async () => {
    fetchSettings.mockReturnValueOnce(new Promise(() => {}));
    renderWithProviders(<EmailTemplatesTab readOnly={false} isSuperAdmin={false} />);

    expect(await screen.findByRole("status")).toHaveTextContent("Loading saved email presentation");
    expect(await screen.findByRole("button", { name: /preview immediate offer/i })).toBeDisabled();
  });

  it("keeps preview disabled after a settings failure and retries the saved presentation read", async () => {
    fetchSettings
      .mockRejectedValueOnce(new Error("Settings unavailable"))
      .mockResolvedValueOnce({
        copy: { "offer-immediate.subject": "Recovered subject" },
        theme: { base: { footerText: "Recovered footer" } },
      });
    renderWithProviders(<EmailTemplatesTab readOnly={false} isSuperAdmin={false} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the saved email presentation");
    expect(alert).toHaveTextContent("Settings unavailable");
    expect(screen.getByRole("button", { name: /preview immediate offer/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    const previewButton = screen.getByRole("button", { name: /preview immediate offer/i });
    await waitFor(() => expect(previewButton).toBeEnabled());
    fireEvent.click(previewButton);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("preview-transactional-email", {
      body: {
        templateName: "offer-immediate",
        copyOverride: { "offer-immediate.subject": "Recovered subject" },
        themeOverride: { base: { footerText: "Recovered footer" } },
      },
    }));
    expect(await screen.findByTitle("Email preview")).toHaveAttribute("srcdoc", "<h1>Saved preview</h1>");
  });

  it("uses semantic surface tokens and removes edit actions on the read-only floor", async () => {
    renderWithProviders(<EmailTemplatesTab readOnly isSuperAdmin={false} />);

    const section = await screen.findByTestId("email-template-group-Booking engine");
    expect(section).toHaveClass("bg-card", "border-border", "text-foreground");
    expect(screen.queryByRole("button", { name: /edit immediate offer/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /preview immediate offer/i })).toBeEnabled());
  });

  it("does not offer previews for the external password-reset email", async () => {
    renderWithProviders(<EmailTemplatesTab readOnly={false} isSuperAdmin={false} />);

    expect(await screen.findByText("Password reset")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /preview password reset/i })).not.toBeInTheDocument();
  });
});
