import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { GetRunningModelV3, GetRunningPhaseV3, GetRunningStep, GetRunningStepKey } from "@/lib/getRunning/steps";

// FinishSetupLink reads useGetRunningV3 (the live-data integration hook that composes the
// whole board model). Mirroring GetRunningBoardV3.test.tsx's harness: the hook is mocked
// so each test hands back an exact model rather than seeding every table the underlying
// booking/hire-order/app_settings reads touch. The pure `done` / `actionableByViewer`
// decision itself (pickFinishStep) is unit-tested directly below against hand-built models,
// per the task brief's "prefer the pure-helper split" guidance. Since the v3 cutover,
// FinishSetupLink no longer gates on useGetRunningV3Enabled (that flag check was collapsed
// away with v3 unconditional), so no enabled-flag mock is needed here at all.
vi.mock("@/hooks/useGetRunningV3", () => ({ useGetRunningV3: vi.fn() }));

import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { FinishSetupLink, pickFinishStep } from "./FinishSetupLink";

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
    datesSource: null,
    hireOrdersOn: false,
    datesWithoutCity: 0,
    datesWithoutCityUnknown: false,
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
  it("renders nothing while the model is still loading", () => {
    mockModel.mockReturnValue({ model: null, isLoading: true });

    const { container } = renderWithProviders(
      <MemoryRouter>
        <FinishSetupLink steps={["artists"]} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("links to the first outstanding step (no enabled flag involved)", async () => {
    mockModel.mockReturnValue({ model: makeModel([makeStep("skills", { done: false })]), isLoading: false });

    renderWithProviders(
      <MemoryRouter>
        <FinishSetupLink steps={["skills"]} />
      </MemoryRouter>,
    );

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", expect.stringContaining("?step=skills"));
  });

  it("renders nothing once every candidate step is done", () => {
    mockModel.mockReturnValue({ model: makeModel([makeStep("artists", { done: true })]), isLoading: false });

    const { container } = renderWithProviders(
      <MemoryRouter>
        <FinishSetupLink steps={["artists"]} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
