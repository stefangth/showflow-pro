import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { GetRunningModelV3, GetRunningPhaseV3, GetRunningStep, GetRunningStepKey } from "@/lib/getRunning/steps";

// FinishSetupLink reads useGetRunningV3Enabled + useGetRunningV3 (both live-data
// integration hooks). Mirroring GetRunningBoardV3.test.tsx's harness: both hooks are
// mocked so each test hands back an exact enabled flag / model rather than seeding every
// table the underlying booking/hire-order/app_settings reads touch. The pure `done` /
// `actionableByViewer` decision itself (pickFinishStep) is unit-tested directly below
// against hand-built models, per the task brief's "prefer the pure-helper split" guidance.
vi.mock("@/hooks/useGetRunningV3Enabled", () => ({ useGetRunningV3Enabled: vi.fn() }));
vi.mock("@/hooks/useGetRunningV3", () => ({ useGetRunningV3: vi.fn() }));

import { useGetRunningV3Enabled } from "@/hooks/useGetRunningV3Enabled";
import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { FinishSetupLink, pickFinishStep } from "./FinishSetupLink";

const mockEnabled = vi.mocked(useGetRunningV3Enabled);
const mockModel = vi.mocked(useGetRunningV3);

function makeStep(key: GetRunningStepKey, overrides: Partial<GetRunningStep> = {}): GetRunningStep {
  return {
    key,
    phase: "bookable",
    done: false,
    block: null,
    adminOnly: false,
    actionableByViewer: true,
    placeholder: false,
    ...overrides,
  };
}

function makePhase(steps: GetRunningStep[]): GetRunningPhaseV3 {
  return {
    key: "bookable",
    steps,
    done: steps.every((s) => s.done),
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    block: null,
    waitsOn: null,
  };
}

function makeModel(steps: GetRunningStep[]): GetRunningModelV3 {
  return {
    phases: [makePhase(steps)],
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    canFirstOffer: false,
    complete: false,
    bookingOn: true,
    hireOrdersOn: false,
    datesWithoutCity: 0,
    nextStep: null,
  };
}

describe("pickFinishStep", () => {
  it("returns the first candidate that is visible, not done, and actionable", () => {
    const model = makeModel([
      makeStep("artists", { done: true }),
      makeStep("skills", { done: false, actionableByViewer: true }),
    ]);
    expect(pickFinishStep(model, ["artists", "skills"])).toBe("skills");
  });

  it("skips a done candidate", () => {
    const model = makeModel([makeStep("artists", { done: true })]);
    expect(pickFinishStep(model, ["artists"])).toBeNull();
  });

  it("skips a candidate the viewer cannot act on", () => {
    const model = makeModel([
      makeStep("artists", { done: false, actionableByViewer: false }),
      makeStep("skills", { done: false, actionableByViewer: true }),
    ]);
    expect(pickFinishStep(model, ["artists", "skills"])).toBe("skills");
  });

  it("skips a hidden candidate", () => {
    const model = makeModel([makeStep("connect", { done: false, actionableByViewer: true, hidden: true })]);
    expect(pickFinishStep(model, ["connect"])).toBeNull();
  });

  it("returns null when the candidate list is empty", () => {
    const model = makeModel([makeStep("artists", { done: false })]);
    expect(pickFinishStep(model, [])).toBeNull();
  });
});

describe("FinishSetupLink", () => {
  it("renders nothing when v3 is disabled, without reaching the heavy model hook", () => {
    mockEnabled.mockReturnValue({ enabled: false, isLoading: false });
    mockModel.mockReturnValue({ model: makeModel([makeStep("artists", { done: false })]), isLoading: false });

    const { container } = renderWithProviders(
      <MemoryRouter>
        <FinishSetupLink steps={["artists"]} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
    // The whole point of the outer/inner split: a v3-disabled org never mounts the
    // inner component, so useGetRunningV3() (the full board-model composition, incl.
    // the useAirtableConsole query fan-out) is never called.
    expect(mockModel).not.toHaveBeenCalled();
  });

  it("renders nothing while the enabled flag itself is still loading, without reaching the heavy model hook", () => {
    mockEnabled.mockReturnValue({ enabled: false, isLoading: true });
    mockModel.mockReturnValue({ model: makeModel([makeStep("artists", { done: false })]), isLoading: false });

    const { container } = renderWithProviders(
      <MemoryRouter>
        <FinishSetupLink steps={["artists"]} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(mockModel).not.toHaveBeenCalled();
  });

  it("renders nothing while the model is still loading", () => {
    mockEnabled.mockReturnValue({ enabled: true, isLoading: false });
    mockModel.mockReturnValue({ model: null, isLoading: true });

    const { container } = renderWithProviders(
      <MemoryRouter>
        <FinishSetupLink steps={["artists"]} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("links to the first not-done candidate step when v3 is enabled", async () => {
    mockEnabled.mockReturnValue({ enabled: true, isLoading: false });
    mockModel.mockReturnValue({ model: makeModel([makeStep("artists", { done: false })]), isLoading: false });

    renderWithProviders(
      <MemoryRouter>
        <FinishSetupLink steps={["artists"]} />
      </MemoryRouter>,
    );

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", expect.stringContaining("/get-running?step=artists"));
  });

  it("renders nothing once every candidate step is done", () => {
    mockEnabled.mockReturnValue({ enabled: true, isLoading: false });
    mockModel.mockReturnValue({ model: makeModel([makeStep("artists", { done: true })]), isLoading: false });

    const { container } = renderWithProviders(
      <MemoryRouter>
        <FinishSetupLink steps={["artists"]} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
