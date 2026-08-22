import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { SlotDraft } from "@/data/slots";
import { RequiredSkillsCard } from "./RequiredSkillsCard";

const SKILLS = [
  { id: "vocals", name: "Vocals" },
  { id: "stage-combat", name: "Stage combat" },
  { id: "german", name: "German" },
];

// Same fixture as src/lib/requiredSkills.test.ts's C3.1 case.
const SLOTS: SlotDraft[] = [
  { name: "Main", count: 1, kind: "main", skillIds: ["vocals", "stage-combat"] },
  { name: "Chorus", count: 1, kind: "main", skillIds: ["vocals"] },
  { name: "Chorus", count: 1, kind: "main", skillIds: ["vocals"] },
];

function renderCard(overrides: Partial<Parameters<typeof RequiredSkillsCard>[0]> = {}) {
  const onReset = vi.fn();
  const onEdit = vi.fn();
  const utils = renderWithProviders(
    <RequiredSkillsCard
      show="Hamlet"
      slots={SLOTS}
      showSkillIds={["vocals", "german"]}
      dateSkillIds={["stage-combat"]}
      droppedSkillIds={["german"]}
      skills={SKILLS}
      onReset={onReset}
      onEdit={onEdit}
      {...overrides}
    />,
  );
  return { ...utils, onReset, onEdit };
}

describe("RequiredSkillsCard", () => {
  it("renders the header and a subtitle naming the slot count and the show", () => {
    renderCard();
    expect(screen.getByText("Skills required on this date")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Computed from the 3 parts on Hamlet. Only artists holding all of them can be asked or booked.",
      ),
    ).toBeInTheDocument();
  });

  it("shows an inherited chip with slot provenance", () => {
    renderCard();
    expect(screen.getByText("Vocals")).toBeInTheDocument();
    expect(screen.getByText("Main, Chorus ×2")).toBeInTheDocument();
  });

  it("shows a date-added chip labeled added on this date, without provenance", () => {
    renderCard();
    expect(screen.getByText("Stage combat")).toBeInTheDocument();
    expect(screen.getByText("added on this date")).toBeInTheDocument();
  });

  it("shows a dropped chip struck through and labeled dropped on this date", () => {
    renderCard();
    expect(screen.getByText("German")).toBeInTheDocument();
    expect(screen.getByText("dropped on this date")).toBeInTheDocument();
    expect(screen.getByText("German").className).toMatch(/line-through/);
  });

  it("shows the footer change count with correct pluralization", () => {
    renderCard();
    expect(screen.getByText("2 changes from the production default")).toBeInTheDocument();
  });

  it("uses singular copy for exactly one change", () => {
    renderCard({ showSkillIds: ["vocals"], dateSkillIds: ["stage-combat"], droppedSkillIds: [] });
    expect(screen.getByText("1 change from the production default")).toBeInTheDocument();
  });

  it("hides the Reset to computed button and the change summary when there are no changes", () => {
    renderCard({ showSkillIds: ["vocals"], dateSkillIds: [], droppedSkillIds: [] });
    expect(screen.queryByRole("button", { name: "Reset to computed" })).not.toBeInTheDocument();
    expect(screen.queryByText(/from the production default/)).not.toBeInTheDocument();
  });

  it("clicking Reset to computed fires onReset", () => {
    const { onReset } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Reset to computed" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("clicking Edit fires onEdit", () => {
    const { onEdit } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
