import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeatureOffBanner } from "./FeatureOffBanner";

describe("FeatureOffBanner", () => {
  it("names the module and links to where it is enabled", () => {
    render(<MemoryRouter><FeatureOffBanner feature="hire_orders" /></MemoryRouter>);
    expect(screen.getByText(/Hire orders is off for this organization/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /enable it/i })).toHaveAttribute("href", "/platform");
  });
});
