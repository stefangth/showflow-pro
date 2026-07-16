import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RequiredSkillsSection } from "./RequiredSkillsSection";

const SKILLS = [
  { id: "s1", name: "judge" }, { id: "s2", name: "juggling" }, { id: "s3", name: "singing" },
];

describe("RequiredSkillsSection", () => {
  it("shows inherited skills read-only with the From show label", () => {
    render(<RequiredSkillsSection skills={SKILLS} showSkillIds={["s1"]} dateSkillIds={[]}
      onAdd={() => {}} onRemove={() => {}} pending={false} />);
    expect(screen.getByText("judge")).toBeInTheDocument();
    expect(screen.getByText("From show")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove judge/i })).not.toBeInTheDocument();
  });
  it("date-level skills are removable", () => {
    const onRemove = vi.fn();
    render(<RequiredSkillsSection skills={SKILLS} showSkillIds={[]} dateSkillIds={["s2"]}
      onAdd={() => {}} onRemove={onRemove} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /remove juggling/i }));
    expect(onRemove).toHaveBeenCalledWith("s2");
  });
  it("the add picker offers only skills not already required", () => {
    const onAdd = vi.fn();
    render(<RequiredSkillsSection skills={SKILLS} showSkillIds={["s1"]} dateSkillIds={["s2"]}
      onAdd={onAdd} onRemove={() => {}} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: "singing" }));
    expect(onAdd).toHaveBeenCalledWith("s3");
    expect(screen.queryByRole("button", { name: "judge" })).not.toBeInTheDocument();
  });
  it("a skill in both show and date lists renders once, as the read-only show chip", () => {
    render(<RequiredSkillsSection skills={SKILLS} showSkillIds={["s1"]} dateSkillIds={["s1", "s2"]}
      onAdd={() => {}} onRemove={() => {}} pending={false} />);
    expect(screen.getAllByText("judge")).toHaveLength(1);
    expect(screen.getByText("From show")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove judge/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove juggling/i })).toBeInTheDocument();
  });
});
