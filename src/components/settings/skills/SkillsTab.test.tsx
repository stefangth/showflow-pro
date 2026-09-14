import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import type { SkillCatalogRow } from "@/data/skills";

// SkillsTab imports the supabase singleton directly (mutations, via useSkills)
// and reads currentOrg/hasRole from AuthContext, so both need mocking (mirrors
// SkillsCard.test.tsx / BookingFlowTab.test.tsx).
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
import { SkillsTab } from "./SkillsTab";

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
// after an async settle would hide a table that briefly renders empty/undefined
// rows before its query resolves.
function renderTab(rows: SkillCatalogRow[] = ROWS) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(["skills", "catalog", "org-1"], rows);
  return renderWithProviders(<SkillsTab orgId="org-1" />, { queryClient });
}

beforeEach(() => {
  authState.isAdmin = true;
  vi.mocked(useCan).mockReturnValue(true);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  seedClient();
});

describe("SkillsTab", () => {
  it("renders nothing when orgId is empty", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["skills", "catalog", "org-1"], ROWS);
    const { container } = renderWithProviders(<SkillsTab orgId="" />, { queryClient });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the header and catalog rows with usage counts on the first render", () => {
    renderTab();

    expect(screen.getByText("ORGANIZATION · CATALOG")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();

    const vocalsRow = screen.getByTestId("skill-row-skill-1");
    expect(within(vocalsRow).getByText("Vocals")).toBeInTheDocument();
    expect(within(vocalsRow).getByText("18")).toBeInTheDocument();
    expect(within(vocalsRow).getByText("4 productions")).toBeInTheDocument();

    const silksRow = screen.getByTestId("skill-row-skill-2");
    expect(within(silksRow).getByText("2")).toBeInTheDocument();
    expect(within(silksRow).getByText("Not required yet")).toBeInTheDocument();

    const archivedRow = screen.getByTestId("skill-row-skill-3");
    expect(within(archivedRow).getByText("Puppetry")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Archived")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Hidden from pickers")).toBeInTheDocument();
    // Archived rows only ever offer Restore, never Rename/Archive/delete.
    expect(within(archivedRow).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(archivedRow).queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    expect(within(archivedRow).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(within(archivedRow).queryByLabelText("Delete Puppetry")).not.toBeInTheDocument();
  });

  it("a date-only requirement (show-level 0, date-level > 0) shows the upcoming-dates copy", () => {
    const dateOnlyRow: SkillCatalogRow = {
      id: "skill-4", name: "Fire spinning", archivedAt: null, artistCount: 1,
      requiredByCount: 0, requiredByDateCount: 1,
    };
    renderTab([...ROWS, dateOnlyRow]);
    const row = screen.getByTestId("skill-row-skill-4");
    expect(within(row).getByText("1 upcoming date")).toBeInTheDocument();
    expect(within(row).getByLabelText("Delete Fire spinning")).toBeDisabled();
  });

  it("Find a skill filters the table by name client-side", () => {
    renderTab();
    expect(screen.getByTestId("skill-row-skill-1")).toBeInTheDocument();
    expect(screen.getByTestId("skill-row-skill-2")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Find skills"), { target: { value: "vocal" } });

    expect(screen.getByTestId("skill-row-skill-1")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-row-skill-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("skill-row-skill-3")).not.toBeInTheDocument();
  });

  it("shows a no-match message when the search filters out every row", () => {
    renderTab();
    fireEvent.change(screen.getByPlaceholderText("Find skills"), { target: { value: "zzz-no-match" } });
    expect(screen.getByText("No skills match your search.")).toBeInTheDocument();
  });

  it("New skill opens a dialog; submitting a name issues a create and closes it", async () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "New skill" })).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Skill name"), { target: { value: "Stage combat" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create skill" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const insert = calls.find((c) => c.table === "skills" && c.method === "insert");
      expect(insert).toBeDefined();
      expect((insert!.args[0] as { name: string }).name).toBe("Stage combat");
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("New skill is disabled when manage_skills is off", () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderTab();
    expect(screen.getByRole("button", { name: /new skill/i })).toBeDisabled();
  });

  it("typing an existing active skill's name into New skill shows a toast and issues no insert", async () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /new skill/i }));
    fireEvent.change(screen.getByLabelText("Skill name"), { target: { value: "vocals" } });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('The skill "vocals" already exists.');
    });
    const calls = (client.calls ?? []) as { table: string; method: string }[];
    expect(calls.find((c) => c.table === "skills" && c.method === "insert")).toBeUndefined();
    // Dialog stays open on a blocked collision.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clicking Rename opens the editor dialog seeded with the current name, and saving renames", async () => {
    renderTab();
    const vocalsRow = screen.getByTestId("skill-row-skill-1");
    fireEvent.click(within(vocalsRow).getByRole("button", { name: "Rename" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Rename Vocals" })).toBeInTheDocument();
    const input = within(dialog).getByDisplayValue("Vocals");

    fireEvent.change(input, { target: { value: "Singing" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "skills" && c.method === "update");
      expect(update).toBeDefined();
      expect((update!.args[0] as { name: string }).name).toBe("Singing");
    });
  });

  it("renaming to an archived skill's name shows the restore-hint toast and issues no rename", async () => {
    renderTab();
    const silksRow = screen.getByTestId("skill-row-skill-2");
    fireEvent.click(within(silksRow).getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByDisplayValue("Aerial silks"), { target: { value: "Puppetry" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('The skill "Puppetry" is archived. Use Restore to bring it back.');
    });
    const calls = (client.calls ?? []) as { table: string; method: string }[];
    expect(calls.find((c) => c.table === "skills" && c.method === "update")).toBeUndefined();
  });

  it("manage_skills off: Rename and Archive are disabled, catalog still reads", () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderTab();
    const vocalsRow = screen.getByTestId("skill-row-skill-1");
    expect(within(vocalsRow).getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(within(vocalsRow).getByRole("button", { name: "Archive" })).toBeDisabled();
  });

  it("clicking Archive calls the archive mutation for that skill", async () => {
    renderTab();
    const vocalsRow = screen.getByTestId("skill-row-skill-1");
    fireEvent.click(within(vocalsRow).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "skills" && c.method === "update");
      expect(update).toBeDefined();
      expect((update!.args[0] as { archived_at: string | null }).archived_at).not.toBeNull();
    });
  });

  it("clicking Restore calls the restore mutation for an archived skill", async () => {
    renderTab();
    const archivedRow = screen.getByTestId("skill-row-skill-3");
    fireEvent.click(within(archivedRow).getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "skills" && c.method === "update");
      expect(update).toBeDefined();
      expect((update!.args[0] as { archived_at: string | null }).archived_at).toBeNull();
    });
  });

  it("disables the delete button when requiredByCount > 0 and enables it when 0 (admin)", () => {
    renderTab();
    const vocalsRow = screen.getByTestId("skill-row-skill-1");
    expect(within(vocalsRow).getByLabelText("Delete Vocals")).toBeDisabled();

    const silksRow = screen.getByTestId("skill-row-skill-2");
    expect(within(silksRow).getByLabelText("Delete Aerial silks")).not.toBeDisabled();
  });

  it("hides the delete button entirely for a non-admin, even when unused", () => {
    authState.isAdmin = false;
    renderTab();
    const silksRow = screen.getByTestId("skill-row-skill-2");
    expect(within(silksRow).queryByLabelText("Delete Aerial silks")).not.toBeInTheDocument();
  });

  it("clicking an unused skill's delete button calls the delete mutation", async () => {
    renderTab();
    const silksRow = screen.getByTestId("skill-row-skill-2");
    fireEvent.click(within(silksRow).getByLabelText("Delete Aerial silks"));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const del = calls.find((c) => c.table === "skills" && c.method === "delete");
      expect(del).toBeDefined();
    });
  });
});
