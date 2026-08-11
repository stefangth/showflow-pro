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
// requiredByCount=1, and one upcoming date. The catalog itself is backed by the
// skill_catalog RPC (Finding 5); fetchUpcomingDateCountsBySkill still reads the
// underlying tables directly, so both seed shapes stay side by side.
Object.assign(
  client,
  createFakeSupabase({
    "rpc:skill_catalog": {
      data: [{ id: "s1", name: "Singing", archived_at: null, artist_count: 1, required_by_count: 1, required_by_date_count: 0 }],
      error: null,
    },
    skills: { data: [{ id: "s1", name: "Singing", archived_at: null }], error: null },
    artist_skills: { data: [{ skill_id: "s1" }], error: null },
    show_required_skills: { data: [{ skill_id: "s1", show_id: "show1" }], error: null },
    show_dates: { data: [{ id: "d1", show_id: "show1" }], error: null },
    show_date_required_skills: { data: [], error: null },
  }),
);

import {
  useSkillCatalog,
  useCreateSkill,
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
      { id: "s1", name: "Singing", archivedAt: null, artistCount: 1, requiredByCount: 1, requiredByDateCount: 0 },
    ]);
    expect(client.calls).toContainEqual({ table: "rpc:skill_catalog", method: "rpc", args: [{ p_org: "org-1" }] });
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

  it("useRenameSkill invalidates ['skills'] and ['artist-skills'] on success", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useRenameSkill(), { queryClient });

    await result.current.mutateAsync({ id: "s1", name: "Dance" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["skills"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["artist-skills"] });
  });

  it("useArchiveSkill invalidates ['skills'] and ['artist-skills'] on success", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useArchiveSkill(), { queryClient });

    await result.current.mutateAsync("s1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["skills"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["artist-skills"] });
  });

  it("useRestoreSkill invalidates ['skills'] and ['artist-skills'] on success", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useRestoreSkill(), { queryClient });

    await result.current.mutateAsync("s1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["skills"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["artist-skills"] });
  });

  it("useDeleteSkill invalidates ['skills'] and ['artist-skills'] on success", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useDeleteSkill(), { queryClient });

    await result.current.mutateAsync("s1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["skills"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["artist-skills"] });
  });

  it("useCreateSkill invalidates ['skills'] and ['artist-skills'] on success", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useCreateSkill(), { queryClient });

    await result.current.mutateAsync("Dance");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["skills"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["artist-skills"] });
  });

  it("useUpcomingDateCountsBySkill is disabled when { enabled: false } is passed", () => {
    const { result } = renderHookWithProviders(() => useUpcomingDateCountsBySkill({ enabled: false }));
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});
