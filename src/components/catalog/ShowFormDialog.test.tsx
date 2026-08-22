import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import type { SlotDraft } from "@/data/slots";

const createShow = vi.fn((..._a: unknown[]) => Promise.resolve({ id: "s-new" }));
const updateShow = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/data/shows", async (orig) => ({ ...(await orig<typeof import("@/data/shows")>()), createShow: (...a: unknown[]) => createShow(...a), updateShow: (...a: unknown[]) => updateShow(...a) }));

// The dialog now authors named slots: it reads them via useShowSlots (-> fetchShowSlots)
// and writes them via saveShowSlots. Mock both so the tests can seed the read and assert
// the exact slots array the dialog submits (ids for new rows are client-minted UUIDs).
const saveShowSlots = vi.fn((..._a: unknown[]) => Promise.resolve());
const fetchShowSlots = vi.fn((..._a: unknown[]) => Promise.resolve([] as SlotDraft[]));
vi.mock("@/data/slots", async (orig) => ({ ...(await orig<typeof import("@/data/slots")>()), saveShowSlots: (...a: unknown[]) => saveShowSlots(...a), fetchShowSlots: (...a: unknown[]) => fetchShowSlots(...a) }));

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({ skills: { data: [], error: null } }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: () => true }) }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));

import { useCan } from "@/hooks/useCapabilities";
import { ShowFormDialog } from "./ShowFormDialog";

const SHOW = {
  id: "show-1", program: "Hamlet", sub_program: null, category: null, description: null,
  status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null,
  sort_order: 1, dateCount: 0,
};
const TWO_SKILLS = { skills: { data: [{ id: "sk-1", name: "Singing" }, { id: "sk-2", name: "Juggling" }], error: null } };

describe("ShowFormDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCan).mockReturnValue(true);
    createShow.mockResolvedValue({ id: "s-new" });
    updateShow.mockResolvedValue(undefined);
    saveShowSlots.mockResolvedValue(undefined);
    fetchShowSlots.mockResolvedValue([]);
  });

  it("create: requires a program/sub-program label", async () => {
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/program or sub-program required/i)).toBeInTheDocument();
    expect(createShow).not.toHaveBeenCalled();
  });

  it("create: adds two named slots and saves them (createShow no longer carries slot counts)", async () => {
    Object.assign(client, createFakeSupabase(TWO_SKILLS));
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[{ sort_order: 4 } as never]} />);
    fireEvent.change(screen.getByLabelText(/^program/i), { target: { value: "Hamlet" } });

    fireEvent.click(screen.getByRole("button", { name: /add part/i }));
    const slot1 = screen.getByRole("group", { name: "Part 1" });
    fireEvent.change(within(slot1).getByLabelText(/part name/i), { target: { value: "Ophelia" } });
    fireEvent.change(within(slot1).getByLabelText(/count/i), { target: { value: "1" } });
    fireEvent.click(await within(slot1).findByRole("button", { name: "Singing" }));

    fireEvent.click(screen.getByRole("button", { name: /add part/i }));
    const slot2 = screen.getByRole("group", { name: "Part 2" });
    fireEvent.change(within(slot2).getByLabelText(/part name/i), { target: { value: "Chorus" } });
    fireEvent.change(within(slot2).getByLabelText(/count/i), { target: { value: "3" } });

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(createShow).toHaveBeenCalled());
    const createArg = createShow.mock.calls[0][1] as Record<string, unknown>;
    expect(createArg).toMatchObject({ program: "Hamlet", orgId: "org-1", createdBy: "u1", sortOrder: 5 });
    expect(createArg).not.toHaveProperty("mainCastSlots");
    expect(createArg).not.toHaveProperty("understudySlots");

    await waitFor(() => expect(saveShowSlots).toHaveBeenCalled());
    const saveArg = saveShowSlots.mock.calls[0][1] as { showId: string; orgId: string; slots: SlotDraft[] };
    expect(saveArg.showId).toBe("s-new");
    expect(saveArg.orgId).toBe("org-1");
    expect(saveArg.slots).toEqual([
      expect.objectContaining({ name: "Ophelia", count: 1, kind: "main", skillIds: ["sk-1"] }),
      expect.objectContaining({ name: "Chorus", count: 3, kind: "main", skillIds: [] }),
    ]);
    // Every new row gets a client-minted id so a retry stays idempotent.
    expect(saveArg.slots[0].id).toEqual(expect.any(String));
    expect(saveArg.slots[1].id).toEqual(expect.any(String));
  });

  it("edit: seeds the show's slots, adds a skill to one, and saves the union (patch omits slot counts)", async () => {
    Object.assign(client, createFakeSupabase(TWO_SKILLS));
    fetchShowSlots.mockResolvedValue([{ id: "slot-1", name: "Leads", count: 2, kind: "main", skillIds: ["sk-1"] }]);
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={SHOW as never} />);

    await screen.findByDisplayValue("Leads");
    const slot = screen.getByRole("group", { name: "Part: Leads" });
    fireEvent.click(within(slot).getByRole("button", { name: "Juggling" }));

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(updateShow).toHaveBeenCalled());
    const patch = updateShow.mock.calls[0][2] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("main_cast_slots");
    expect(patch).not.toHaveProperty("understudy_slots");

    await waitFor(() => expect(saveShowSlots).toHaveBeenCalled());
    const saveArg = saveShowSlots.mock.calls[0][1] as { showId: string; slots: SlotDraft[] };
    expect(saveArg.showId).toBe("show-1");
    expect(saveArg.slots).toEqual([{ id: "slot-1", name: "Leads", count: 2, kind: "main", skillIds: ["sk-1", "sk-2"] }]);
  });

  it("edit: removing a slot drops it from the saved array", async () => {
    Object.assign(client, createFakeSupabase(TWO_SKILLS));
    fetchShowSlots.mockResolvedValue([
      { id: "slot-1", name: "Leads", count: 2, kind: "main", skillIds: [] },
      { id: "slot-2", name: "Chorus", count: 3, kind: "main", skillIds: [] },
    ]);
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={SHOW as never} />);

    await screen.findByDisplayValue("Chorus");
    const slot2 = screen.getByRole("group", { name: "Part: Chorus" });
    fireEvent.click(within(slot2).getByRole("button", { name: /remove/i }));

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saveShowSlots).toHaveBeenCalled());
    const saveArg = saveShowSlots.mock.calls[0][1] as { slots: SlotDraft[] };
    expect(saveArg.slots).toEqual([{ id: "slot-1", name: "Leads", count: 2, kind: "main", skillIds: [] }]);
  });

  it("edit: a slot added but not saved does not survive close/reopen of the same show", async () => {
    Object.assign(client, createFakeSupabase(TWO_SKILLS));
    fetchShowSlots.mockResolvedValue([{ id: "slot-1", name: "Leads", count: 2, kind: "main", skillIds: [] }]);
    const { rerender } = renderWithProviders(
      <ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={SHOW as never} />,
    );
    await screen.findByDisplayValue("Leads");
    fireEvent.click(screen.getByRole("button", { name: /add part/i }));
    expect(screen.getByRole("group", { name: "Part 2" })).toBeInTheDocument();
    // Close via the open prop (X/Escape path; the dialog instance stays mounted on ProductionsPage).
    rerender(<ShowFormDialog open={false} onOpenChange={() => {}} allShows={[]} show={SHOW as never} />);
    rerender(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={SHOW as never} />);
    await screen.findByDisplayValue("Leads");
    // The unsaved blank slot must be gone: only the persisted slot remains.
    expect(screen.queryByRole("group", { name: "Part 2" })).not.toBeInTheDocument();
  });

  it("shows a computed callout listing the union of all slot skills", async () => {
    Object.assign(client, createFakeSupabase(TWO_SKILLS));
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add part/i }));
    const slot1 = screen.getByRole("group", { name: "Part 1" });
    fireEvent.click(await within(slot1).findByRole("button", { name: "Singing" }));
    expect(screen.getByText(/every date of this production will require Singing\./i)).toBeInTheDocument();
  });

  it("synced show: program is read-only, slots stay editable", () => {
    fetchShowSlots.mockResolvedValue([]);
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={{ ...SHOW, id: "s1", program: "P", airtable_program_key: "K" } as never} />);
    expect(screen.getByText(/synced from airtable/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^program/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /add part/i })).not.toBeDisabled();
  });

  it("edit_scheduling off: the slot repeater is disabled, other fields stay editable", () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={{ ...SHOW, id: "s1", program: "P" } as never} />);
    expect(screen.getByRole("button", { name: /add part/i })).toBeDisabled();
    expect(screen.getByLabelText(/^program/i)).not.toBeDisabled();
  });
});
