import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase } from "@/test/supabaseFake";

// vi.mock is hoisted above imports, so the factory can only read a vi.hoisted holder
// (not an outer const). Populate that holder with the approved fake after imports run —
// NOT a hand-rolled vi.mock chain.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

// One consistent seed set shared by the catalog query and the upcoming-date-counts
// query: skill s1 is held by one artist, required by one production (show1), and
// show1 has one upcoming, non-cancelled date (d1) — so s1 should show artistCount=1,
// requiredByCount=1, and one upcoming date.
Object.assign(
  client,
  createFakeSupabase({
    skills: { data: [{ id: "s1", name: "Singing", archived_at: null }], error: null },
    artist_skills: { data: [{ skill_id: "s1" }], error: null },
    show_required_skills: { data: [{ skill_id: "s1", show_id: "show1" }], error: null },
    show_dates: { data: [{ id: "d1", show_id: "show1" }], error: null },
    show_date_required_skills: { data: [], error: null },
  }),
);

import {
  useSkillCatalog,
  useRenameSkill,
  useArchiveSkill,
  useRestoreSkill,
  useDeleteSkill,
  useUpcomingDateCountsBySkill,
} from "./useSkills";
import { useAuth } from "@/features/auth/AuthContext";

describe("skills catalog hooks", () => {
  beforeEach(() => {
    (client.calls as unknown[]).length = 0;
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-1" } } as never);
  });

  it("useSkillCatalog fetches the org's catalog with usage counts", async () => {
    const { result } = renderHookWithProviders(() => useSkillCatalog());
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      { id: "s1", name: "Singing", archivedAt: null, artistCount: 1, requiredByCount: 1 },
    ]);
    expect(client.calls).toContainEqual({ table: "skills", method: "eq", args: ["org_id", "org-1"] });
  });

  it("useSkillCatalog stays disabled without a current org", () => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: null } as never);
    const { result } = renderHookWithProviders(() => useSkillCatalog());
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useUpcomingDateCountsBySkill returns per-skill upcoming date counts", async () => {
    const { result } = renderHookWithProviders(() => useUpcomingDateCountsBySkill());
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.get("s1")).toBe(1);
  });

  it("useRenameSkill invalidates ['skills'] on success", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useRenameSkill(), { queryClient });

    await result.current.mutateAsync({ id: "s1", name: "Dance" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["skills"] });
  });

  it("useArchiveSkill invalidates ['skills'] on success", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useArchiveSkill(), { queryClient });

    await result.current.mutateAsync("s1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["skills"] });
  });

  it("useRestoreSkill invalidates ['skills'] on success", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useRestoreSkill(), { queryClient });

    await result.current.mutateAsync("s1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["skills"] });
  });

  it("useDeleteSkill invalidates ['skills'] on success", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useDeleteSkill(), { queryClient });

    await result.current.mutateAsync("s1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["skills"] });
  });
});
