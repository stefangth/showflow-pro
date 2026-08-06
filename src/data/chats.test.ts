import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchMyChats } from "./chats";

describe("fetchMyChats", () => {
  it("filters by org_id and orders newest first", async () => {
    const mine = [{ id: "chat-1", show_date_id: "d1", created_at: "2026-08-01T00:00:00Z", show_date: null }];
    const fake = createFakeSupabase({
      chats: [
        { when: { org_id: "org-1" }, data: mine, error: null },
        {
          when: { org_id: "org-2" },
          data: [{ id: "chat-9", show_date_id: "d9", created_at: "2026-08-02T00:00:00Z", show_date: null }],
          error: null,
        },
      ],
    });
    const res = await fetchMyChats(fake as never, "org-1");
    expect(res.map((c) => c.id)).toEqual(["chat-1"]);
    expect(fake.calls).toContainEqual({ table: "chats", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({
      table: "chats", method: "order", args: ["created_at", { ascending: false }],
    });
  });

  it("returns [] for a null org without querying", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchMyChats(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ chats: { data: null, error: { message: "boom" } } });
    await expect(fetchMyChats(fake as never, "org-1")).rejects.toMatchObject({ message: "boom" });
  });
});
