import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("renders a create affordance instead of dead text when the catalog is empty", () => {
    render(<SkillPicker skills={[]} selectedIds={[]} onToggle={vi.fn()} onCreate={vi.fn()} canCreate emptyHint="none yet" />);
    expect(screen.getByRole("button", { name: /new skill/i })).toBeInTheDocument();
  });

  it("keeps the plain hint when creation is not allowed", () => {
    render(<SkillPicker skills={[]} selectedIds={[]} onToggle={vi.fn()} emptyHint="none yet" />);
    expect(screen.getByText("none yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new skill/i })).toBeNull();
  });

  it("selects the newly created skill without waiting for a refetch", async () => {
    const onCreate = vi.fn().mockResolvedValue({ id: "sk-9", name: "Lead Vocals" });
    const onToggle = vi.fn();
    render(<SkillPicker skills={[]} selectedIds={[]} onToggle={onToggle} onCreate={onCreate} canCreate />);
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Lead Vocals" } });
    fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith("sk-9"));
  });

  it("marks a selected skill with a check", () => {
    render(<SkillPicker skills={[{ id: "sk-1", name: "Piano" }]} selectedIds={["sk-1"]} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: /piano/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("skill-chip-check")).toBeInTheDocument();
  });

  // `disabled` gates SELECTION. A create ends in onToggle, so it must be fenced by
  // `disabled` too, or a caller that gated selection off (a capability gate, not just a
  // transient one) gets a selection anyway by the side door. The fence is INSIDE the chip,
  // not its mount condition: callers pass composite flags (capability || pending), and
  // unmounting on a transient pending flag would throw away a half-typed name.
  it("cannot start a create while selection is disabled", () => {
    const onToggle = vi.fn();
    render(
      <SkillPicker skills={[]} selectedIds={[]} onToggle={onToggle} onCreate={vi.fn()} canCreate disabled emptyHint="none yet" />,
    );
    const trigger = screen.getByRole("button", { name: /new skill/i });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("cannot complete a create while selection is disabled", () => {
    const onCreate = vi.fn();
    const { rerender } = render(
      <SkillPicker skills={[]} selectedIds={[]} onToggle={vi.fn()} onCreate={onCreate} canCreate />,
    );
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Piano" } });
    rerender(<SkillPicker skills={[]} selectedIds={[]} onToggle={vi.fn()} onCreate={onCreate} canCreate disabled />);
    fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("keeps an open form and its typed name across a disabled flip", () => {
    const onCreate = vi.fn();
    const props = { skills: [], selectedIds: [], onToggle: vi.fn(), onCreate, canCreate: true };
    const { rerender } = render(<SkillPicker {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Half typed" } });
    rerender(<SkillPicker {...props} disabled />);
    expect(screen.getByRole("textbox")).toHaveValue("Half typed");
    rerender(<SkillPicker {...props} />);
    expect(screen.getByRole("textbox")).toHaveValue("Half typed");
  });

  it("drops a create whose disabled flips true mid flight", async () => {
    let resolve!: (v: { id: string; name: string }) => void;
    const onCreate = vi.fn().mockReturnValue(new Promise<{ id: string; name: string }>((r) => { resolve = r; }));
    const onToggle = vi.fn();
    const props = { skills: [], selectedIds: [], onToggle, onCreate, canCreate: true };
    const { rerender } = render(<SkillPicker {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Piano" } });
    fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    expect(onCreate).toHaveBeenCalledWith("Piano");
    rerender(<SkillPicker {...props} disabled />);
    resolve({ id: "sk-9", name: "Piano" });
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onToggle).not.toHaveBeenCalled();
  });

  // The chip renders inside ShowFormDialog's production <form>, so it must not be a form
  // of its own and its confirm control must not be a submit button: either would save the
  // production the moment a producer names a skill.
  it("confirms without submitting any enclosing form", () => {
    render(<SkillPicker skills={[]} selectedIds={[]} onToggle={vi.fn()} onCreate={vi.fn()} canCreate />);
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    const confirm = screen.getByRole("button", { name: /add skill/i });
    expect(confirm).toHaveAttribute("type", "button");
    expect(screen.getByRole("textbox").closest("form")).toBeNull();
    expect(screen.queryByRole("button", { name: /new skill/i })).toBeNull();
  });

  it("creates on Enter without letting the key reach an enclosing form", () => {
    const onCreate = vi.fn().mockResolvedValue({ id: "sk-9", name: "Piano" });
    const outerSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={outerSubmit}>
        <SkillPicker skills={[]} selectedIds={[]} onToggle={vi.fn()} onCreate={onCreate} canCreate />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Piano" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("Piano");
    expect(outerSubmit).not.toHaveBeenCalled();
  });

  it("ignores a submit with a whitespace only name", () => {
    const onCreate = vi.fn();
    render(<SkillPicker skills={[]} selectedIds={[]} onToggle={vi.fn()} onCreate={onCreate} canCreate />);
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("does not submit twice while a create is pending", () => {
    const onCreate = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<SkillPicker skills={[]} selectedIds={[]} onToggle={vi.fn()} onCreate={onCreate} canCreate />);
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Lead Vocals" } });
    const confirm = screen.getByRole("button", { name: /add skill/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("leaves the selection untouched when the create is rejected", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("name already taken"));
    const onToggle = vi.fn();
    render(<SkillPicker skills={[]} selectedIds={[]} onToggle={onToggle} onCreate={onCreate} canCreate />);
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Piano" } });
    fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onToggle).not.toHaveBeenCalled();
    // The form stays open with the typed name so an amended name costs one edit.
    expect(screen.getByRole("textbox")).toHaveValue("Piano");
  });
});
