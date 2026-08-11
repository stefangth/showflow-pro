import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import type { SkillCatalogRow } from "@/data/skills";

// SkillsCard imports the supabase singleton directly (mutations) and reads
// currentOrg/hasRole from AuthContext, so both need mocking (mirrors
// CastsCitiesTab.test.tsx / LetterheadCard.test.tsx).
const { client, authState } = vi.hoisted(() => ({
  client: {} as Record<string, unknown>,
  authState: { isAdmin: true },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" }, hasRole: (r: string) => r === "admin" && authState.isAdmin }),
}));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useCan } from "@/hooks/useCapabilities";
import { toast } from "sonner";
import { SkillsCard } from "./SkillsCard";

function seedClient(seed: Record<string, TableSeed> = { skills: { data: [], error: null } }) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

const ROWS: SkillCatalogRow[] = [
  { id: "skill-1", name: "Vocals", archivedAt: null, artistCount: 18, requiredByCount: 4, requiredByDateCount: 0 },
  { id: "skill-2", name: "Aerial silks", archivedAt: null, artistCount: 2, requiredByCount: 0, requiredByDateCount: 0 },
  { id: "skill-3", name: "Puppetry", archivedAt: "2026-01-01T00:00:00.000Z", artistCount: 3, requiredByCount: 0, requiredByDateCount: 0 },
];

// Prime the react-query cache for ['skills','catalog',orgId] so the catalog rows
// are present on the FIRST render, per the seed-once-ref memory: asserting only
// after an async settle would hide a card that briefly renders an empty/undefined
// catalog before its query resolves.
function renderCard(rows: SkillCatalogRow[] = ROWS) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(["skills", "catalog", "org-1"], rows);
  return renderWithProviders(<SkillsCard canEnter />, { queryClient });
}

beforeEach(() => {
  authState.isAdmin = true;
  vi.mocked(useCan).mockReturnValue(true);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  seedClient();
});

describe("SkillsCard", () => {
  it("renders nothing when canEnter is false", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["skills", "catalog", "org-1"], ROWS);
    const { container } = renderWithProviders(<SkillsCard canEnter={false} />, { queryClient });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders catalog rows with usage counts on the first render", () => {
    renderCard();

    const vocalsRow = screen.getByTestId("skill-row-skill-1");
    expect(within(vocalsRow).getByText("Vocals")).toBeInTheDocument();
    expect(within(vocalsRow).getByText("18 artists")).toBeInTheDocument();
    expect(within(vocalsRow).getByText("4 productions")).toBeInTheDocument();

    const silksRow = screen.getByTestId("skill-row-skill-2");
    expect(within(silksRow).getByText("2 artists")).toBeInTheDocument();
    expect(within(silksRow).getByText("Not required yet")).toBeInTheDocument();

    const archivedRow = screen.getByTestId("skill-row-skill-3");
    expect(within(archivedRow).getByText("Puppetry")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Archived")).toBeInTheDocument();
    expect(within(archivedRow).getByText("3 artists")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Hidden from pickers")).toBeInTheDocument();
    // Archived rows only ever offer Restore, never Rename/Archive/delete, even for
    // an admin and even when the skill is unused (requiredByCount 0).
    expect(within(archivedRow).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(archivedRow).queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    expect(within(archivedRow).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(within(archivedRow).queryByLabelText("Delete Puppetry")).not.toBeInTheDocument();
  });

  it("archived, unused row (requiredByCount 0) renders only Restore, no delete button, for an admin", () => {
    renderCard();
    const archivedRow = screen.getByTestId("skill-row-skill-3");
    expect(within(archivedRow).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    // Deleting is offered only on active rows per the design's archived example
    // (Puppetry): archiving is the only path off an in-use-or-not skill once it's
    // archived. Query by the delete aria-label / IconTooltip trigger and assert
    // it is entirely absent, not merely disabled.
    expect(within(archivedRow).queryByLabelText("Delete Puppetry")).not.toBeInTheDocument();
    expect(within(archivedRow).queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("disables the delete button when requiredByCount > 0 and enables it when 0 (admin)", () => {
    renderCard();

    const vocalsRow = screen.getByTestId("skill-row-skill-1");
    expect(within(vocalsRow).getByLabelText("Delete Vocals")).toBeDisabled();

    const silksRow = screen.getByTestId("skill-row-skill-2");
    expect(within(silksRow).getByLabelText("Delete Aerial silks")).not.toBeDisabled();
  });

  it("disables the delete button when only requiredByDateCount > 0 (date-level requirement, show-level 0)", () => {
    // Finding 1 regression: a skill required only by a show_date (not the show
    // itself) must still be delete-blocked, since show_date_required_skills is
    // also ON DELETE RESTRICT. The "Required by" column copy is unaffected.
    const dateOnlyRow: SkillCatalogRow = {
      id: "skill-4", name: "Fire spinning", archivedAt: null, artistCount: 1,
      requiredByCount: 0, requiredByDateCount: 1,
    };
    renderCard([...ROWS, dateOnlyRow]);

    const row = screen.getByTestId("skill-row-skill-4");
    expect(within(row).getByLabelText("Delete Fire spinning")).toBeDisabled();
    // The "Required by" column display stays show-level copy per the design.
    expect(within(row).getByText("Not required yet")).toBeInTheDocument();

    // Both counts zero (Aerial silks) stays enabled.
    const silksRow = screen.getByTestId("skill-row-skill-2");
    expect(within(silksRow).getByLabelText("Delete Aerial silks")).not.toBeDisabled();
  });

  it("hides the delete button entirely for a non-admin, even when unused", () => {
    authState.isAdmin = false;
    renderCard();
    const silksRow = screen.getByTestId("skill-row-skill-2");
    expect(within(silksRow).queryByLabelText("Delete Aerial silks")).not.toBeInTheDocument();
  });

  it("clicking Archive calls the archive mutation for that skill", async () => {
    renderCard();
    const vocalsRow = screen.getByTestId("skill-row-skill-1");
    fireEvent.click(within(vocalsRow).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "skills" && c.method === "update");
      expect(update).toBeDefined();
      expect((update!.args[0] as { archived_at: string | null }).archived_at).not.toBeNull();
      const eqCall = calls.find((c) => c.table === "skills" && c.method === "eq" && c.args[0] === "id");
      expect(eqCall?.args[1]).toBe("skill-1");
    });
  });

  it("clicking Restore calls the restore mutation for an archived skill", async () => {
    renderCard();
    const archivedRow = screen.getByTestId("skill-row-skill-3");
    fireEvent.click(within(archivedRow).getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "skills" && c.method === "update");
      expect(update).toBeDefined();
      expect((update!.args[0] as { archived_at: string | null }).archived_at).toBeNull();
    });
  });

  it("Add is disabled with an empty input and enabled once text is typed", () => {
    renderCard();
    const addButton = screen.getByRole("button", { name: /add/i });
    expect(addButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("New skill name"), { target: { value: "Stage combat" } });
    expect(addButton).not.toBeDisabled();
  });

  it("manage_skills off: Add and Rename disabled, catalog still reads", () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderCard();
    fireEvent.change(screen.getByPlaceholderText("New skill name"), { target: { value: "Stage combat" } });
    expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();

    const vocalsRow = screen.getByTestId("skill-row-skill-1");
    expect(within(vocalsRow).getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(within(vocalsRow).getByRole("button", { name: "Archive" })).toBeDisabled();
  });

  it("Rename shows an inline input seeded with the current name, with Cancel/Save name", async () => {
    renderCard();
    const vocalsRow = screen.getByTestId("skill-row-skill-1");
    fireEvent.click(within(vocalsRow).getByRole("button", { name: "Rename" }));

    const input = within(vocalsRow).getByDisplayValue("Vocals");
    expect(input).toBeInTheDocument();
    expect(within(vocalsRow).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(vocalsRow).getByRole("button", { name: "Save name" })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Singing" } });
    fireEvent.click(within(vocalsRow).getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "skills" && c.method === "update");
      expect(update).toBeDefined();
      expect((update!.args[0] as { name: string }).name).toBe("Singing");
    });
  });

  it("typing an archived skill's name and clicking Add shows the restore-hint toast and issues no insert (Finding 4)", async () => {
    renderCard(); // ROWS includes archived "Puppetry" (skill-3)
    fireEvent.change(screen.getByPlaceholderText("New skill name"), { target: { value: "puppetry" } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'A skill named "puppetry" is archived. Use Restore to bring it back.',
      );
    });
    expect(toast.success).not.toHaveBeenCalled();
    const calls = (client.calls ?? []) as { table: string; method: string }[];
    expect(calls.find((c) => c.table === "skills" && c.method === "insert")).toBeUndefined();
  });

  it("typing an existing active skill's name and clicking Add shows an already-exists toast and issues no insert", async () => {
    renderCard(); // ROWS includes active "Vocals" (skill-1)
    fireEvent.change(screen.getByPlaceholderText("New skill name"), { target: { value: "vocals" } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('A skill named "vocals" already exists.');
    });
    expect(toast.success).not.toHaveBeenCalled();
    const calls = (client.calls ?? []) as { table: string; method: string }[];
    expect(calls.find((c) => c.table === "skills" && c.method === "insert")).toBeUndefined();
  });
});
