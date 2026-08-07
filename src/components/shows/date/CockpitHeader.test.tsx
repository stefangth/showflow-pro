import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CockpitHeader, type CockpitHeaderProps } from "./CockpitHeader";

const base: CockpitHeaderProps = {
  title: "Nutcracker · Tour B", dateLine: "Thursday, 12 March 2026",
  metaLine: "14:00 / 19:30 · Volksbühne, Berlin",
  slots: { main_cast: 4, understudies: 2 }, confirmedCount: 2, acceptedCount: 2,
  statusText: "Tier 2 open", statusTone: "amber",
  workflowCta: { kind: "confirm", label: "Confirm 2 accepted" }, onWorkflowCta: vi.fn(),
  showGenerateHireOrder: false, generateDisabled: false, onGenerate: vi.fn(),
  flowLabel: "Classic offers",
  tabs: [
    { id: "cast", label: "Cast" }, { id: "offers", label: "Offers" },
    { id: "order", label: "Hire order", hidden: true }, { id: "chat", label: "Chat" },
    { id: "setup", label: "Setup" },
  ],
  activeTab: "cast", onTab: vi.fn(),
};

describe("CockpitHeader", () => {
  it("renders the workflow CTA and fires it", () => {
    const onWorkflowCta = vi.fn();
    render(<CockpitHeader {...base} onWorkflowCta={onWorkflowCta} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm 2 accepted/i }));
    expect(onWorkflowCta).toHaveBeenCalledOnce();
  });

  it("hides tabs marked hidden (hire order off)", () => {
    render(<CockpitHeader {...base} />);
    expect(screen.queryByRole("button", { name: /hire order/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cast$/i })).toBeInTheDocument();
  });

  it("shows the Generate hire order button only when enabled by the flag", () => {
    const { rerender } = render(<CockpitHeader {...base} showGenerateHireOrder={false} />);
    expect(screen.queryByRole("button", { name: /generate hire order/i })).not.toBeInTheDocument();
    rerender(<CockpitHeader {...base} showGenerateHireOrder onGenerate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /generate hire order/i })).toBeInTheDocument();
  });

  it("renders flow label as a Settings link only when onEditFlow is provided", () => {
    const onEditFlow = vi.fn();
    const { rerender } = render(<CockpitHeader {...base} />);
    expect(screen.getByText("Classic offers").tagName).not.toBe("BUTTON");
    rerender(<CockpitHeader {...base} onEditFlow={onEditFlow} />);
    fireEvent.click(screen.getByRole("button", { name: /classic offers/i }));
    expect(onEditFlow).toHaveBeenCalledOnce();
  });
});
