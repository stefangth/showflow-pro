import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHookWithProviders } from "@/test/renderWithProviders";

const createSkill = vi.fn((..._a: unknown[]) => Promise.resolve({ id: "sk-9", name: "Tap" }));
vi.mock("@/data/skills", async (orig) => ({ ...(await orig<typeof import("@/data/skills")>()), createSkill: (...a: unknown[]) => createSkill(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { toast } from "sonner";
import { useInlineSkillCreate } from "./useInlineSkillCreate";

const ACTIVE = [{ id: "sk-1", name: "Singing" }];

function mount(active = ACTIVE) {
  const { result } = renderHookWithProviders(() => useInlineSkillCreate(active), {
    authOverrides: { currentOrg: { id: "org-1", name: "Org", suspended_at: null } as never },
  });
  return result;
}

describe("useInlineSkillCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSkill.mockResolvedValue({ id: "sk-9", name: "Tap" });
  });

  it("creates the skill and resolves to it", async () => {
    await expect(mount().current("Tap")).resolves.toEqual({ id: "sk-9", name: "Tap" });
    expect(createSkill).toHaveBeenCalledWith({}, "Tap", "org-1");
    expect(toast.error).not.toHaveBeenCalled();
  });

  // Case-insensitively, because the producer reading the chip row sees "Singing" and
  // should be told it is already there rather than watching an insert fail.
  it("names an active duplicate without touching the database", async () => {
    await expect(mount().current("singing")).rejects.toThrow();
    expect(createSkill).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already exists/i));
  });

  it("points at Settings when the unique index rejects the insert (code shape)", async () => {
    createSkill.mockRejectedValue({ code: "23505", message: "duplicate key" });
    await expect(mount().current("Tap")).rejects.toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/may be archived/i));
  });

  // supabase-js hands back a PLAIN object, not an Error, and not every path carries a
  // `code` — the constraint text is the other shape this has to recognise.
  it("points at Settings when the rejection only carries the constraint text", async () => {
    createSkill.mockRejectedValue({ message: 'duplicate key value violates unique constraint "skills_org_id_name_key"' });
    await expect(mount().current("Tap")).rejects.toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/may be archived/i));
  });

  it("does not claim a collision for an unrelated failure", async () => {
    createSkill.mockRejectedValue(new Error("Failed to fetch"));
    await expect(mount().current("Tap")).rejects.toThrow("Failed to fetch");
    expect(toast.error).toHaveBeenCalledWith("Failed to fetch");
  });

  it("falls back to the add-failed message when the failure says nothing", async () => {
    createSkill.mockRejectedValue({});
    await expect(mount().current("Tap")).rejects.toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/failed to add skill/i));
  });
});
