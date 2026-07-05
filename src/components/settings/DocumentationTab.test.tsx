import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { DocumentationTab } from "./DocumentationTab";

describe("DocumentationTab", () => {
  it("shows the System Map tab for super-admins", () => {
    renderWithProviders(<DocumentationTab isSuperAdmin={true} />);
    expect(screen.getByRole("tab", { name: /system map/i })).toBeInTheDocument();
  });

  it("hides the System Map tab for non-super-admins but still shows the guide", () => {
    renderWithProviders(<DocumentationTab isSuperAdmin={false} />);
    expect(screen.queryByRole("tab", { name: /system map/i })).toBeNull();
    expect(screen.getByText(/how showflow works/i)).toBeInTheDocument();
  });
});
