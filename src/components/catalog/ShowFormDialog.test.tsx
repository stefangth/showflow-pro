import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const createShow = vi.fn((...a: unknown[]) => Promise.resolve({ id: "s-new" }));
const updateShow = vi.fn((...a: unknown[]) => Promise.resolve());
vi.mock("@/data/shows", async (orig) => ({ ...(await orig<typeof import("@/data/shows")>()), createShow: (...a: unknown[]) => createShow(...a), updateShow: (...a: unknown[]) => updateShow(...a) }));
// Real fake client (not a bare {}): the dialog now reads/writes show_required_skills
// via the real @/data/eligibility functions and reads skills via useSkills, so both
// tables need a seed. Individual tests override it with Object.assign for their own seeds.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({ skills: { data: [], error: null } }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: () => true }) }));

import { ShowFormDialog } from "./ShowFormDialog";

const SHOW_WITH_SKILL = {
  id: "show-1", program: "Hamlet", sub_program: null, category: null, description: null,
  status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null,
  sort_order: 1, dateCount: 0,
};

describe("ShowFormDialog", () => {
  beforeEach(() => vi.clearAllMocks());

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
  });
});
