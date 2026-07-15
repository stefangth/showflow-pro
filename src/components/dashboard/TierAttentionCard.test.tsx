import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { MemoryRouter } from "react-router-dom";
import { TierAttentionCard } from "./TierAttentionCard";

const item = {
  showDateId: "d1", date: "2026-07-20", program: "TJE", subProgram: "Murder", custom: null,
  tier: 2, filled: 1, required: 3, atRisk: true, expiresSoon: true,
};
const wrap = (ui: React.ReactElement) => renderWithProviders(<MemoryRouter>{ui}</MemoryRouter>);

describe("TierAttentionCard", () => {
  it("renders rows with fill state and badges", () => {
    wrap(<TierAttentionCard items={[item]} hint="" reference={{ source: "show" }} customFieldKey={null} />);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText(/Tier 2 · 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText("At risk")).toBeInTheDocument();
    expect(screen.getByText("Expires soon")).toBeInTheDocument();
  });
  it("shows the immediate-delivery hint when provided and renders nothing when empty", () => {
    const { container } = wrap(<TierAttentionCard items={[]} hint="x" reference={{ source: "show" }} customFieldKey={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
