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

// The countersign controls choose HOW the artist signs (in the app, or outside it), not
// who signs on behalf of the org. The guide has to describe the control it sits beside.
it("describes the countersign step as the artist's signing route, not an org signer", () => {
  const paperworkSteps: GetRunningStep[] = [
    { key: "countersign", phase: "paperwork", done: false, block: null, adminOnly: true, actionableByViewer: true, placeholder: false },
  ];
  render(
    <MemoryRouter>
      <WizardShell phaseKey="paperwork" steps={paperworkSteps} activeKey="countersign" onSelectStep={vi.fn()} onCollapse={vi.fn()}>
        <div>BODY</div>
      </WizardShell>
    </MemoryRouter>
  );
  expect(screen.queryByText(/on behalf of the org/i)).toBeNull();
  expect(screen.queryByText(/change the signer/i)).toBeNull();
  expect(screen.getByText(/how the artist signs/i)).toBeInTheDocument();
});

// A source choice can hide two steps mid-phase. The number stays honest ("3 / 3"), but on
// its own it reads as if the viewer skipped ahead, and the change is silent to a screen
// reader. Say what happened, out loud.
it("says how many steps dropped out when a choice hides some, and announces it", () => {
  const five: GetRunningStep[] = [
    { key: "source", phase: "get_dates", done: true, block: null, adminOnly: false, actionableByViewer: true, placeholder: false },
    { key: "connect", phase: "get_dates", done: false, block: null, adminOnly: false, actionableByViewer: true, placeholder: false },
    { key: "map", phase: "get_dates", done: false, block: null, adminOnly: false, actionableByViewer: true, placeholder: false },
    { key: "productions", phase: "get_dates", done: false, block: null, adminOnly: false, actionableByViewer: true, placeholder: false },
    { key: "cities", phase: "get_dates", done: false, block: "booking", adminOnly: false, actionableByViewer: true, placeholder: false },
  ];
  const three = five.filter((s) => s.key !== "connect" && s.key !== "map");
  const props = { phaseKey: "get_dates" as const, activeKey: "cities" as const, onSelectStep: vi.fn(), onCollapse: vi.fn() };
  const { rerender } = render(
    <MemoryRouter>
      <WizardShell {...props} steps={five}><div>BODY</div></WizardShell>
    </MemoryRouter>
  );
  expect(screen.queryByText(/no longer apply/i)).toBeNull();

  rerender(
    <MemoryRouter>
      <WizardShell {...props} steps={three}><div>BODY</div></WizardShell>
    </MemoryRouter>
  );
  expect(screen.getByText("3 / 3")).toBeInTheDocument();
  const note = screen.getByText(/2 steps no longer apply/i);
  expect(note).toBeInTheDocument();
  expect(note.closest("[aria-live='polite']")).not.toBeNull();
});
