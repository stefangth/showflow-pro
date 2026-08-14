import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { DocumentationTab } from "./DocumentationTab";

describe("DocumentationTab", () => {
  it("shows all three sub-tabs for super-admins", () => {
    renderWithProviders(<DocumentationTab isSuperAdmin={true} />);
    expect(screen.getByRole("tab", { name: /app logic/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /system map/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /reference/i })).toBeInTheDocument();
  });

  // SettingsPage now only ever mounts this component for a super-admin (Settings >
  // Documentation is gated at the trigger, content, and deep-link layers — see
  // SettingsPage.test.tsx and settingsTabs.test.ts), so this `isSuperAdmin={false}` branch
  // is unreachable from the app today. It stays here, and the prop stays required, so the
  // component is still robust on its own rather than depending on its one caller's gate.
  it("falls back to the guide-only view when rendered without super-admin", () => {
    renderWithProviders(<DocumentationTab isSuperAdmin={false} />);
    expect(screen.queryByRole("tab", { name: /system map/i })).toBeNull();
    expect(screen.getByText(/how showflow works/i)).toBeInTheDocument();
  });
});
