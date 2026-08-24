import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WizardShell } from "./WizardShell";
import { WizardFooterAction } from "./WizardFooterAction";
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

it("keys its body layout off the wizard's own width, not the viewport", () => {
  renderShell();
  const root = document.querySelector("[data-testid='wizard-shell']");
  expect(root?.className).toContain("@container");

  const grid = document.querySelector("nav[aria-label='Steps']")?.parentElement;
  // No viewport-keyed `lg:` column template survives: at viewport 1024 the wizard is only
  // ~708px wide, which is what crushed the editor column to 222px between the two rails.
  expect(grid?.className).not.toMatch(/\blg:grid-cols-/);
  expect(grid?.className).toContain("@2xl:grid-cols-");
  expect(grid?.className).toContain("@5xl:grid-cols-");
});

it("drops the guide below the editor at the two-column size", () => {
  renderShell();
  const aside = document.querySelector("aside");
  expect(aside?.className).toContain("@2xl:col-span-2");
  expect(aside?.className).toContain("@5xl:col-span-1");
});

it("titles every step from the shell, including bodies that render no heading of their own", () => {
  // `artists` is one of the eight steps whose body is reused from v1 and the setup rails.
  render(
    <MemoryRouter>
      <WizardShell phaseKey="bookable" steps={steps} activeKey="artists" onSelectStep={vi.fn()} onCollapse={vi.fn()}>
        <div>BODY</div>
      </WizardShell>
    </MemoryRouter>
  );
  expect(screen.getByRole("heading", { name: /add your artists/i })).toBeInTheDocument();
});

it("offers a Continue in the footer when the body portals no action of its own", () => {
  const onNext = vi.fn();
  render(
    <MemoryRouter>
      <WizardShell
        phaseKey="bookable"
        steps={steps}
        activeKey="artists"
        onSelectStep={vi.fn()}
        onCollapse={vi.fn()}
        onNext={onNext}
      >
        <div>BODY</div>
      </WizardShell>
    </MemoryRouter>
  );
  const footer = screen.getByTestId("wizard-footer");
  fireEvent.click(within(footer).getByRole("button", { name: /^continue$/i }));
  expect(onNext).toHaveBeenCalledTimes(1);
});

it("stands its own Continue down when the body supplies one", () => {
  render(
    <MemoryRouter>
      <WizardShell
        phaseKey="bookable"
        steps={steps}
        activeKey="artists"
        onSelectStep={vi.fn()}
        onCollapse={vi.fn()}
        onNext={vi.fn()}
      >
        <WizardFooterAction>
          <button type="button">Save timing</button>
        </WizardFooterAction>
      </WizardShell>
    </MemoryRouter>
  );
  const footer = screen.getByTestId("wizard-footer");
  expect(within(footer).getByRole("button", { name: "Save timing" })).toBeInTheDocument();
  expect(within(footer).queryByRole("button", { name: /^continue$/i })).not.toBeInTheDocument();
});

it("sends Read more to the help answer, not to the settings page", () => {
  renderShell();
  // `coverage` is the active step in renderShell; its guide link used to resolve through
  // stepFeatureLink and open /settings?tab=casts-coverage.
  const link = screen.getByRole("link", { name: /read more about cast ranking/i });
  expect(link.getAttribute("href")).toMatch(/^\/help\?item=/);
});

it("never shows two primary actions at once when the open step changes", () => {
  // The at-rest invariant either side of a step change: exactly one primary action.
  // NOTE this cannot catch the frame-timing half of the same bug (registration in a
  // passive effect painted BOTH buttons for one frame on letterhead -> fee): RTL wraps
  // render/rerender in act(), which flushes passive effects before the assertion, and
  // jsdom has no paint to observe. That half is addressed by `WizardFooterAction` using
  // useLayoutEffect; this test guards the settled state.
  const { rerender } = render(
    <MemoryRouter>
      <WizardShell
        phaseKey="bookable"
        steps={steps}
        activeKey="artists"
        onSelectStep={vi.fn()}
        onCollapse={vi.fn()}
        onNext={vi.fn()}
      >
        <div>NO ACTION BODY</div>
      </WizardShell>
    </MemoryRouter>
  );
  expect(within(screen.getByTestId("wizard-footer")).getAllByRole("button", { name: /^continue$/i })).toHaveLength(1);

  rerender(
    <MemoryRouter>
      <WizardShell
        phaseKey="bookable"
        steps={steps}
        activeKey="coverage"
        onSelectStep={vi.fn()}
        onCollapse={vi.fn()}
        onNext={vi.fn()}
      >
        <WizardFooterAction>
          <button type="button">Continue</button>
        </WizardFooterAction>
      </WizardShell>
    </MemoryRouter>
  );
  expect(within(screen.getByTestId("wizard-footer")).getAllByRole("button", { name: /^continue$/i })).toHaveLength(1);
});
