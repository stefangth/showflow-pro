import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const createShow = vi.fn((..._a: unknown[]) => Promise.resolve({ id: "s-new" }));
const updateShow = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/data/shows", async (orig) => ({ ...(await orig<typeof import("@/data/shows")>()), createShow: (...a: unknown[]) => createShow(...a), updateShow: (...a: unknown[]) => updateShow(...a) }));
// Real fake client (not a bare {}): the dialog now reads/writes show_required_skills
// via the real @/data/eligibility functions and reads skills via useSkills, so both
// tables need a seed. Individual tests override it with Object.assign for their own seeds.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({ skills: { data: [], error: null } }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: () => true }) }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));

import { useCan } from "@/hooks/useCapabilities";
import { ShowFormDialog } from "./ShowFormDialog";

const SHOW_WITH_SKILL = {
  id: "show-1", program: "Hamlet", sub_program: null, category: null, description: null,
  status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null,
  sort_order: 1, dateCount: 0,
};

describe("ShowFormDialog", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useCan).mockReturnValue(true); });

  it("edit_scheduling off: slot fields are disabled, other fields stay editable", () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={{ id: "s1", program: "P", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 1, dateCount: 0 }} />);
    expect(screen.getByLabelText(/main cast/i)).toBeDisabled();
    expect(screen.getByLabelText(/understudy/i)).toBeDisabled();
    expect(screen.getByLabelText(/^program/i)).not.toBeDisabled();
  });

  it("create: requires a program/sub-program label", async () => {
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/program or sub-program required/i)).toBeInTheDocument();
    expect(createShow).not.toHaveBeenCalled();
  });

  it("create: submits mapped values with computed sortOrder", async () => {
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[{ sort_order: 4 } as never]} />);
    fireEvent.change(screen.getByLabelText(/^program/i), { target: { value: "Hamlet" } });
    fireEvent.change(screen.getByLabelText(/main cast/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(createShow).toHaveBeenCalled());
    const arg = createShow.mock.calls[0][1] as Record<string, unknown>;
    expect(arg).toMatchObject({ program: "Hamlet", mainCastSlots: 3, sortOrder: 5, orgId: "org-1", createdBy: "u1" });
  });

  it("synced show: program is read-only, slots editable", () => {
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={{ id: "s1", program: "P", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: "K", sort_order: 1, dateCount: 0 }} />);
    expect(screen.getByText(/synced from airtable/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^program/i)).toBeDisabled();
    expect(screen.getByLabelText(/main cast/i)).not.toBeDisabled();
  });

  describe("required skills", () => {
    it("edit: renders the Required skills section with existing selections pressed", async () => {
      Object.assign(client, createFakeSupabase({
        skills: { data: [{ id: "sk-1", name: "Singing" }, { id: "sk-2", name: "Juggling" }], error: null },
        show_required_skills: { data: [{ skill_id: "sk-1" }], error: null },
      }));
      renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={SHOW_WITH_SKILL as never} />);
      expect(await screen.findByText("Required skills")).toBeInTheDocument();
      expect(screen.getByText(/artists must have all of these skills/i)).toBeInTheDocument();
      const singing = await screen.findByRole("button", { name: "Singing" });
      await waitFor(() => expect(singing).toHaveAttribute("aria-pressed", "true"));
      expect(screen.getByRole("button", { name: "Juggling" })).toHaveAttribute("aria-pressed", "false");
    });

    it("edit: toggling a new skill on and saving inserts the pair", async () => {
      const fake = createFakeSupabase({
        skills: { data: [{ id: "sk-1", name: "Singing" }, { id: "sk-2", name: "Juggling" }], error: null },
        show_required_skills: { data: [{ skill_id: "sk-1" }], error: null },
      });
      Object.assign(client, fake);
      renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={SHOW_WITH_SKILL as never} />);
      const juggling = await screen.findByRole("button", { name: "Juggling" });
      await waitFor(() => expect(juggling).toHaveAttribute("aria-pressed", "false"));
      fireEvent.click(juggling);
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => expect(updateShow).toHaveBeenCalled());
      await waitFor(() => {
        const ins = fake.calls.find((c) => c.table === "show_required_skills" && c.method === "insert");
        expect(ins?.args[0]).toEqual({ show_id: "show-1", skill_id: "sk-2", org_id: "org-1" });
      });
    });

    it("edit: toggling an existing skill off and saving deletes it", async () => {
      const fake = createFakeSupabase({
        skills: { data: [{ id: "sk-1", name: "Singing" }, { id: "sk-2", name: "Juggling" }], error: null },
        show_required_skills: { data: [{ skill_id: "sk-1" }], error: null },
      });
      Object.assign(client, fake);
      renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={SHOW_WITH_SKILL as never} />);
      const singing = await screen.findByRole("button", { name: "Singing" });
      await waitFor(() => expect(singing).toHaveAttribute("aria-pressed", "true"));
      fireEvent.click(singing);
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => expect(updateShow).toHaveBeenCalled());
      await waitFor(() => {
        expect(fake.calls.some((c) => c.table === "show_required_skills" && c.method === "delete")).toBe(true);
      });
      expect(fake.calls).toContainEqual({ table: "show_required_skills", method: "eq", args: ["show_id", "show-1"] });
      expect(fake.calls).toContainEqual({ table: "show_required_skills", method: "eq", args: ["skill_id", "sk-1"] });
    });

    it("edit: an unsaved toggle does not survive close/reopen of the same show", async () => {
      Object.assign(client, createFakeSupabase({
        skills: { data: [{ id: "sk-1", name: "Singing" }, { id: "sk-2", name: "Juggling" }], error: null },
        show_required_skills: { data: [{ skill_id: "sk-1" }], error: null },
      }));
      const { rerender } = renderWithProviders(
        <ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={SHOW_WITH_SKILL as never} />,
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Singing" })).toHaveAttribute("aria-pressed", "true"));
      // Unsaved toggle: turn Juggling on, then close via the open prop (X/Escape path,
      // dialog instance stays mounted as on ProductionsPage).
      fireEvent.click(screen.getByRole("button", { name: "Juggling" }));
      expect(screen.getByRole("button", { name: "Juggling" })).toHaveAttribute("aria-pressed", "true");
      rerender(<ShowFormDialog open={false} onOpenChange={() => {}} allShows={[]} show={SHOW_WITH_SKILL as never} />);
      // Reopen the SAME show: chips must show the true persisted set, not the stale toggle.
      rerender(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={SHOW_WITH_SKILL as never} />);
      const singing = await screen.findByRole("button", { name: "Singing" });
      await waitFor(() => expect(singing).toHaveAttribute("aria-pressed", "true"));
      expect(screen.getByRole("button", { name: "Juggling" })).toHaveAttribute("aria-pressed", "false");
    });

    it("create mode reopened after an edit session starts with no selected skills", async () => {
      Object.assign(client, createFakeSupabase({
        skills: { data: [{ id: "sk-1", name: "Singing" }, { id: "sk-2", name: "Juggling" }], error: null },
        show_required_skills: { data: [{ skill_id: "sk-1" }], error: null },
      }));
      const { rerender } = renderWithProviders(
        <ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={SHOW_WITH_SKILL as never} />,
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Singing" })).toHaveAttribute("aria-pressed", "true"));
      rerender(<ShowFormDialog open={false} onOpenChange={() => {}} allShows={[]} show={SHOW_WITH_SKILL as never} />);
      // Reopen in CREATE mode: no inherited selections from the edit session.
      rerender(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} />);
      const singing = await screen.findByRole("button", { name: "Singing" });
      expect(singing).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Juggling" })).toHaveAttribute("aria-pressed", "false");
    });

    it("edit: a failed delete keeps the succeeded insert; retry does not duplicate it", async () => {
      // Array seed: the delete chain records eq("skill_id", "sk-1") so it matches the
      // error entry; the select and the sk-2 insert fall through to the ok fallback.
      const fake = createFakeSupabase({
        skills: { data: [{ id: "sk-1", name: "Singing" }, { id: "sk-2", name: "Juggling" }], error: null },
        show_required_skills: [
          { when: { skill_id: "sk-1" }, data: null, error: { message: "delete blocked" } },
          { data: [{ skill_id: "sk-1" }], error: null },
        ],
      });
      Object.assign(client, fake);
      const onOpenChange = vi.fn();
      renderWithProviders(<ShowFormDialog open onOpenChange={onOpenChange} allShows={[]} show={SHOW_WITH_SKILL as never} />);
      const singing = await screen.findByRole("button", { name: "Singing" });
      await waitFor(() => expect(singing).toHaveAttribute("aria-pressed", "true"));
      fireEvent.click(screen.getByRole("button", { name: "Juggling" })); // add sk-2
      fireEvent.click(singing); // remove sk-1
      const insertsFor = (skillId: string) =>
        fake.calls.filter((c) => c.table === "show_required_skills" && c.method === "insert"
          && (c.args[0] as { skill_id?: string })?.skill_id === skillId);
      const deletes = () =>
        fake.calls.filter((c) => c.table === "show_required_skills" && c.method === "delete");
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => expect(updateShow).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(deletes()).toHaveLength(1));
      expect(insertsFor("sk-2")).toHaveLength(1);
      // Diff failed -> the dialog stays open.
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      // Retry: only the unfinished delete is re-attempted; the already-applied
      // insert must NOT repeat (it would hit the UNIQUE (show_id, skill_id) index).
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => expect(updateShow).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(deletes()).toHaveLength(2));
      expect(insertsFor("sk-2")).toHaveLength(1);
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("create: a failed skills insert keeps the created show; retry does not create a duplicate", async () => {
      const fake = createFakeSupabase({
        skills: { data: [{ id: "sk-1", name: "Singing" }], error: null },
        show_required_skills: { data: null, error: { message: "insert blocked" } },
      });
      Object.assign(client, fake);
      const onOpenChange = vi.fn();
      renderWithProviders(<ShowFormDialog open onOpenChange={onOpenChange} allShows={[]} />);
      fireEvent.change(screen.getByLabelText(/^program/i), { target: { value: "Hamlet" } });
      fireEvent.click(await screen.findByRole("button", { name: "Singing" }));
      const inserts = () =>
        fake.calls.filter((c) => c.table === "show_required_skills" && c.method === "insert");
      fireEvent.click(screen.getByRole("button", { name: /create/i }));
      await waitFor(() => expect(createShow).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(inserts()).toHaveLength(1));
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      // Retry: the show already exists in this open session; only the skill
      // insert is re-attempted, no second show is created.
      fireEvent.click(screen.getByRole("button", { name: /create/i }));
      await waitFor(() => expect(inserts()).toHaveLength(2));
      expect(createShow).toHaveBeenCalledTimes(1);
    });
  });
});
