import { assertEquals } from "./test-asserts.ts";
import { makeFakeDeps } from "./testing.ts";
import { resolveOrgKind, VOCABULARY, ORG_KINDS } from "./orgKind.ts";

function seed(kind: string | null) {
  return makeFakeDeps({
    tables: kind !== null
      ? { organizations: [{ when: { id: "org1" }, data: { org_kind: kind } }] }
      : {},
  });
}

Deno.test("resolveOrgKind: staffing row => staffing", async () => {
  const { deps } = seed("staffing");
  assertEquals(await resolveOrgKind(deps.admin, "org1"), "staffing");
});

Deno.test("resolveOrgKind: unknown value => production", async () => {
  const { deps } = seed("circus");
  assertEquals(await resolveOrgKind(deps.admin, "org1"), "production");
});

Deno.test("resolveOrgKind: no row => production", async () => {
  const { deps } = seed(null);
  assertEquals(await resolveOrgKind(deps.admin, "org1"), "production");
});

Deno.test("resolveOrgKind: null org => production without a read", async () => {
  const { deps, calls } = seed("staffing");
  assertEquals(await resolveOrgKind(deps.admin, null), "production");
  assertEquals(calls.length, 0);
});

Deno.test("resolveOrgKind: read error => production", async () => {
  const { deps } = makeFakeDeps({
    tables: { organizations: [{ when: { id: "org1" }, error: { message: "boom" } }] },
  });
  assertEquals(await resolveOrgKind(deps.admin, "org1"), "production");
});

Deno.test("mirror block carries the vocabulary tables", () => {
  assertEquals(ORG_KINDS.length, 2);
  assertEquals(typeof VOCABULARY.staffing.en.Artists, "string");
});
