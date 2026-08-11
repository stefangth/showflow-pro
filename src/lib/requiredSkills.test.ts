import { describe, it, expect } from "vitest";
import type { SlotDraft } from "@/data/slots";
import { computeRequiredSkillCard } from "./requiredSkills";

const SKILLS = [
  { id: "vocals", name: "Vocals" },
  { id: "stage-combat", name: "Stage combat" },
  { id: "german", name: "German" },
];

// Plan C3.1's fixture: Main requires Vocals + Stage combat (Stage combat is a
// date-add, not a show requirement — used for provenance only); two "Chorus"
// slot rows both require Vocals. The show requires Vocals and German; this
// date adds Stage combat and drops German.
const SLOTS: SlotDraft[] = [
  { name: "Main", count: 1, kind: "main", skillIds: ["vocals", "stage-combat"] },
  { name: "Chorus", count: 1, kind: "main", skillIds: ["vocals"] },
  { name: "Chorus", count: 1, kind: "main", skillIds: ["vocals"] },
];

describe("computeRequiredSkillCard", () => {
  it("classifies inherited/added/dropped rows with slot provenance and a change count", () => {
    const result = computeRequiredSkillCard({
      slots: SLOTS,
      showSkillIds: ["vocals", "german"],
      dateSkillIds: ["stage-combat"],
      droppedSkillIds: ["german"],
      skills: SKILLS,
    });

    expect(result.slotCount).toBe(3);
    expect(result.changeCount).toBe(2);

    const vocals = result.rows.find((r) => r.skillId === "vocals");
    expect(vocals).toMatchObject({ kind: "inherited", name: "Vocals", provenance: "Main, Chorus ×2" });

    const stageCombat = result.rows.find((r) => r.skillId === "stage-combat");
    expect(stageCombat).toMatchObject({ kind: "added", name: "Stage combat" });
    expect(stageCombat?.provenance).toBeUndefined();

    const german = result.rows.find((r) => r.skillId === "german");
    expect(german).toMatchObject({ kind: "dropped", name: "German" });
  });

  it("renders dropped rows last, after inherited and added rows", () => {
    const result = computeRequiredSkillCard({
      slots: SLOTS,
      showSkillIds: ["vocals", "german"],
      dateSkillIds: ["stage-combat"],
      droppedSkillIds: ["german"],
      skills: SKILLS,
    });
    expect(result.rows.map((r) => r.kind)).toEqual(["inherited", "added", "dropped"]);
  });

  it("a stale drop for a skill that isn't show-level is inert (not rendered, not counted)", () => {
    const result = computeRequiredSkillCard({
      slots: [],
      showSkillIds: ["vocals"],
      dateSkillIds: ["stage-combat"],
      droppedSkillIds: ["stage-combat"], // drops only ever apply to show-level skills; this one is stale
      skills: SKILLS,
    });
    expect(result.rows.map((r) => r.skillId)).toEqual(["vocals", "stage-combat"]);
    expect(result.rows.find((r) => r.skillId === "stage-combat")?.kind).toBe("added");
    expect(result.changeCount).toBe(1);
  });

  it("groups a single slot occurrence without a ×N suffix", () => {
    const result = computeRequiredSkillCard({
      slots: [{ name: "Ophelia", count: 1, kind: "main", skillIds: ["vocals"] }],
      showSkillIds: ["vocals"],
      dateSkillIds: [],
      droppedSkillIds: [],
      skills: SKILLS,
    });
    expect(result.rows[0].provenance).toBe("Ophelia");
  });

  it("no changes from the production default yields a zero change count", () => {
    const result = computeRequiredSkillCard({
      slots: SLOTS,
      showSkillIds: ["vocals"],
      dateSkillIds: [],
      droppedSkillIds: [],
      skills: SKILLS,
    });
    expect(result.changeCount).toBe(0);
  });
});
