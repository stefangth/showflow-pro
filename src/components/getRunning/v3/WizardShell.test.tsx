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

it("renders the blocks-first-ask chip for a booking-blocked step (get_dates phase)", () => {
  const bookingSteps: GetRunningStep[] = [
    { key: "cities", phase: "get_dates", done: false, block: "booking", adminOnly: false, actionableByViewer: true, placeholder: false },
  ];
  render(
    <MemoryRouter>
      <WizardShell phaseKey="get_dates" steps={bookingSteps} activeKey="cities" onSelectStep={vi.fn()} onCollapse={vi.fn()}>
        <div>BODY</div>
      </WizardShell>
    </MemoryRouter>
  );
  expect(screen.getByText(/blocks your first ask/i)).toBeInTheDocument();
});

it("does not render the blocks-first-ask chip for an issuing-blocked step (paperwork phase)", () => {
  const paperworkSteps: GetRunningStep[] = [
    { key: "letterhead", phase: "paperwork", done: false, block: "issuing", adminOnly: true, actionableByViewer: true, placeholder: false },
  ];
  render(
    <MemoryRouter>
      <WizardShell phaseKey="paperwork" steps={paperworkSteps} activeKey="letterhead" onSelectStep={vi.fn()} onCollapse={vi.fn()}>
        <div>BODY</div>
      </WizardShell>
    </MemoryRouter>
  );
  expect(screen.queryByText(/blocks your first ask/i)).not.toBeInTheDocument();
  expect(screen.getByText(/admin only/i)).toBeInTheDocument();
});
