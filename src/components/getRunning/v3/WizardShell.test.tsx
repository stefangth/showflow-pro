import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WizardShell } from "./WizardShell";
import type { GetRunningStep } from "@/lib/getRunning/steps";

const steps: GetRunningStep[] = [
  { key: "artists", phase: "bookable", done: true, block: null, adminOnly: false, actionableByViewer: true, placeholder: false },
  { key: "coverage", phase: "bookable", done: false, block: "offers", adminOnly: false, actionableByViewer: true, placeholder: false },
];
function renderShell(active = "coverage" as const, onSelectStep = vi.fn(), onCollapse = vi.fn()) {
  render(
    <MemoryRouter>
      <WizardShell phaseKey="bookable" steps={steps} activeKey={active} onSelectStep={onSelectStep} onCollapse={onCollapse}>
        <div>BODY</div>
      </WizardShell>
    </MemoryRouter>
  );
  return { onSelectStep, onCollapse };
}

it("renders the active step body and the step counter", () => {
  renderShell();
  expect(screen.getByText("BODY")).toBeInTheDocument();
  expect(screen.getByText(/2 \/ 2|step 2 \/ 2/i)).toBeInTheDocument();
});
it("renders every step in the left rail and lets you pick one", () => {
  const { onSelectStep } = renderShell();
  fireEvent.click(screen.getByRole("button", { name: /artists/i }));
  expect(onSelectStep).toHaveBeenCalledWith("artists");
});
it("collapses from the header and the footer", () => {
  const { onCollapse } = renderShell();
  fireEvent.click(screen.getByRole("button", { name: /collapse|close/i }));
  fireEvent.click(screen.getByRole("button", { name: /finish later/i }));
  expect(onCollapse).toHaveBeenCalledTimes(2);
});
it("shows the how-this-works guide for the active step", () => {
  renderShell();
  // guide.coverage.title from getRunningV3 — assert the section landmark, not exact copy.
  expect(screen.getByText(/how this works/i)).toBeInTheDocument();
});
