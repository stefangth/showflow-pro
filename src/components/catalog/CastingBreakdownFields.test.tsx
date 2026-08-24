import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CastingBreakdownFields, type SlotDraftRow } from "./CastingBreakdownFields";

const SKILLS = [{ id: "sk-1", name: "Singing" }, { id: "sk-2", name: "Juggling" }];

function Harness({ initial }: { initial: SlotDraftRow[] }) {
  // Thin controlled wrapper so tests can assert what onChange was called with
  // without re-implementing the value/onChange contract themselves.
  const onChange = vi.fn();
  return { onChange, ...renderWithProviders(
    <CastingBreakdownFields value={initial} onChange={onChange} skills={SKILLS} />,
  ) };
}

describe("CastingBreakdownFields", () => {
  it("renders one row per draft", () => {
    renderWithProviders(
      <CastingBreakdownFields
        value={[
          { id: "slot-1", name: "Leads", count: 2, kind: "main", skillIds: [] },
          { id: "slot-2", name: "Chorus", count: 3, kind: "main", skillIds: [] },
        ]}
        onChange={() => {}}
        skills={SKILLS}
      />,
    );
    expect(screen.getByRole("group", { name: "Part: Leads" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Part: Chorus" })).toBeInTheDocument();
  });

  it("typing a role name calls onChange with the updated row", () => {
    const { onChange } = Harness({
      initial: [{ id: "slot-1", name: "", count: 1, kind: "main", skillIds: [] }],
    });
    fireEvent.change(screen.getByLabelText(/part name/i), { target: { value: "Ophelia" } });
    expect(onChange).toHaveBeenCalledWith([
      { id: "slot-1", name: "Ophelia", count: 1, kind: "main", skillIds: [] },
    ]);
  });

  it("Add part appends a row with a fresh client id", () => {
    const { onChange } = Harness({ initial: [] });
    fireEvent.click(screen.getByRole("button", { name: /add part/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const rows = onChange.mock.calls[0][0] as SlotDraftRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "", count: 1, kind: "main", skillIds: [] });
    expect(rows[0].id).toEqual(expect.any(String));
    expect(rows[0].id).not.toBe("");
  });

  it("toggling the understudy control updates kind", () => {
    const { onChange } = Harness({
      initial: [{ id: "slot-1", name: "Chorus", count: 3, kind: "main", skillIds: [] }],
    });
    const group = screen.getByRole("group", { name: "Part: Chorus" });
    fireEvent.click(within(group).getByRole("button", { name: /understudy/i }));
    expect(onChange).toHaveBeenCalledWith([
      { id: "slot-1", name: "Chorus", count: 3, kind: "understudy", skillIds: [] },
    ]);
  });

  it("totals reflect the counts across main and understudy rows", () => {
    renderWithProviders(
      <CastingBreakdownFields
        value={[
          { id: "slot-1", name: "Leads", count: 2, kind: "main", skillIds: [] },
          { id: "slot-2", name: "Understudy Leads", count: 1, kind: "understudy", skillIds: [] },
        ]}
        onChange={() => {}}
        skills={SKILLS}
      />,
    );
    expect(screen.getByText(/2 main/i)).toBeInTheDocument();
    expect(screen.getByText(/1 understudy/i)).toBeInTheDocument();
  });

  it("adds a newly created skill to the part's required skills", async () => {
    const onChange = vi.fn();
    const onCreateSkill = vi.fn().mockResolvedValue({ id: "sk-9", name: "Lead Vocals" });
    renderWithProviders(
      <CastingBreakdownFields
        value={[{ id: "r1", name: "Lead", count: 1, kind: "main", skillIds: [] }]}
        onChange={onChange}
        skills={[]}
        onCreateSkill={onCreateSkill}
        canCreateSkill
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /skill name/i }), { target: { value: "Lead Vocals" } });
    fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ skillIds: ["sk-9"] })]),
    );
  });

  // The affordance is not only an empty-catalog fallback: an org with skills still needs
  // to name a new one while writing the breakdown.
  it("offers inline creation alongside a non empty catalog", () => {
    renderWithProviders(
      <CastingBreakdownFields
        value={[{ id: "r1", name: "Lead", count: 1, kind: "main", skillIds: [] }]}
        onChange={vi.fn()}
        skills={SKILLS}
        onCreateSkill={vi.fn()}
        canCreateSkill
      />,
    );
    expect(screen.getByRole("button", { name: "Singing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new skill/i })).toBeInTheDocument();
  });

  it("leaves the required skills untouched when the create is rejected", async () => {
    const onChange = vi.fn();
    const onCreateSkill = vi.fn().mockRejectedValue(new Error("name already taken"));
    renderWithProviders(
      <CastingBreakdownFields
        value={[{ id: "r1", name: "Lead", count: 1, kind: "main", skillIds: [] }]}
        onChange={onChange}
        skills={[]}
        onCreateSkill={onCreateSkill}
        canCreateSkill
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /skill name/i }), { target: { value: "Singing" } });
    fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    await waitFor(() => expect(onCreateSkill).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers no create affordance without the capability", () => {
    renderWithProviders(
      <CastingBreakdownFields
        value={[{ id: "r1", name: "Lead", count: 1, kind: "main", skillIds: [] }]}
        onChange={vi.fn()}
        skills={[]}
        onCreateSkill={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /new skill/i })).toBeNull();
  });
});
