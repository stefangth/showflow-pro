import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FeatureDisabledScreen from "./FeatureDisabledScreen";

function renderScreen(feature: "hire_orders" | "booking_flow" = "hire_orders") {
  return render(
    <MemoryRouter>
      <FeatureDisabledScreen feature={feature} />
    </MemoryRouter>,
  );
}

describe("FeatureDisabledScreen", () => {
  it("shows the feature's label and explains it is not enabled", () => {
    renderScreen("hire_orders");
    expect(screen.getByText("Hire orders is not enabled")).toBeTruthy();
  });

  it("links back to the dashboard", () => {
    renderScreen("hire_orders");
    const link = screen.getByText("Back to dashboard").closest("a");
    expect(link?.getAttribute("href")).toBe("/dashboard");
  });

  it("copy contains no em-dashes or en-dashes", () => {
    const { container } = renderScreen("hire_orders");
    expect(container.textContent).not.toMatch(/[–—]/);
  });
});
