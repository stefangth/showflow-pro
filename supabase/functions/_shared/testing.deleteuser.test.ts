import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createFakeClient } from "./testing.ts";

Deno.test("fake auth.admin.deleteUser defaults to success", async () => {
  const { client } = createFakeClient();
  const res = await client.auth.admin.deleteUser("u1");
  assertEquals(res.error, null);
});

Deno.test("fake auth.admin.deleteUser honors a seeded error", async () => {
  const { client } = createFakeClient({ deleteUserResult: { data: null, error: { message: "boom" } } });
  const res = await client.auth.admin.deleteUser("u1");
  assertEquals((res.error as { message: string }).message, "boom");
});
