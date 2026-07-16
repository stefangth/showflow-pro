import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SkillPicker } from "./SkillPicker";

const SKILLS = [{ id: "s1", name: "judge" }, { id: "s2", name: "juggling" }];

describe("SkillPicker", () => {
  it("renders one toggle per skill and marks selected ones", () => {
    render(<SkillPicker skills={SKILLS} selectedIds={["s1"]} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "judge" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "juggling" })).toHaveAttribute("aria-pressed", "false");
  });
  it("fires onToggle with the skill id", () => {
    const onToggle = vi.fn();
    render(<SkillPicker skills={SKILLS} selectedIds={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "judge" }));
    expect(onToggle).toHaveBeenCalledWith("s1");
  });
  it("shows the empty hint when there are no skills", () => {
    render(<SkillPicker skills={[]} selectedIds={[]} onToggle={() => {}} emptyHint="No skills yet." />);
    expect(screen.getByText("No skills yet.")).toBeInTheDocument();
  });
});
