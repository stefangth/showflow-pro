import { assertEquals, assertExists } from "./test-asserts.ts";
import { makeFakeDeps } from "./testing.ts";
import {
  resolveTierLadder, ladderCastIdsAtTier, nextTierAfter,
  fetchGateArtistIds, fetchRequiredSkillIds, filterArtistIdsBySkills,
} from "./eligibility.ts";

Deno.test("resolveTierLadder prefers show rows and reports source show", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      show_cast_eligibility: { data: [{ cast_id: "cast-g", priority: 1 }, { cast_id: "cast-a", priority: 2 }] },
      cast_city_priority: { data: [{ cast_id: "cast-x", priority: 1 }] },
    },
  });
  const ladder = await resolveTierLadder(deps.admin, "show-1", "city-1");
  assertEquals(ladder.source, "show");
  assertEquals(ladder.tiers, [{ tier: 1, castId: "cast-g" }, { tier: 2, castId: "cast-a" }]);
});

Deno.test("resolveTierLadder falls back to the org city list", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      show_cast_eligibility: { data: [] },
      cast_city_priority: { data: [{ cast_id: "cast-x", priority: 2 }, { cast_id: "cast-y", priority: 1 }] },
    },
  });
  const ladder = await resolveTierLadder(deps.admin, "show-1", "city-1");
  assertEquals(ladder.source, "org");
  assertEquals(ladder.tiers.map((t) => t.tier), [1, 2]);
});

Deno.test("resolveTierLadder excludes untiered show rows via .not('priority','is',null)", async () => {
  // The fake harness records .not() but does not apply it, so the data-shape
  // tests above cannot catch a dropped or mistargeted filter. Pin the exact
  // invocation: legacy untiered rows (priority IS NULL) must be excluded from
  // the show-ladder query, since that filter is the whole mechanism that
  // distinguishes a show-scoped tier override from a plain eligibility row.
  const { deps, calls } = makeFakeDeps({
    tables: {
      show_cast_eligibility: { data: [{ cast_id: "cast-g", priority: 1 }] },
      cast_city_priority: { data: [] },
    },
  });
  await resolveTierLadder(deps.admin, "show-1", "city-1");
  const notCall = calls.find((c) => c.table === "show_cast_eligibility" && c.method === "not");
  assertExists(notCall, "show-ladder query must carry .not('priority', 'is', null)");
  assertEquals(notCall!.args, ["priority", "is", null]);
});

Deno.test("nextTierAfter returns the smallest higher tier or null", () => {
  const ladder = { source: "org" as const, tiers: [{ tier: 1, castId: "a" }, { tier: 3, castId: "b" }] };
  assertEquals(nextTierAfter(ladder, 1), 3);
  assertEquals(nextTierAfter(ladder, 3), null);
});

Deno.test("ladderCastIdsAtTier returns the casts at exactly that tier", () => {
  const ladder = { source: "show" as const, tiers: [{ tier: 1, castId: "a" }, { tier: 2, castId: "b" }] };
  assertEquals(ladderCastIdsAtTier(ladder, 2), ["b"]);
  assertEquals(ladderCastIdsAtTier(ladder, 4), []);
});

Deno.test("fetchGateArtistIds returns null with no gate rows, else the member union", async () => {
  const { deps: noGate } = makeFakeDeps({ tables: {
    show_cast_eligibility: { data: [] },
    show_date_cast_eligibility: { data: [] },
  } });
  assertEquals(await fetchGateArtistIds(noGate.admin, { showId: "s", cityId: "c", showDateId: "d" }), null);

  const { deps: gated } = makeFakeDeps({ tables: {
    show_cast_eligibility: { data: [{ cast_id: "cast-a" }] },
    show_date_cast_eligibility: { data: [{ cast_id: "cast-b" }] },
    cast_members: { data: [{ artist_id: "ar-1" }, { artist_id: "ar-2" }] },
  } });
  const set = await fetchGateArtistIds(gated.admin, { showId: "s", cityId: "c", showDateId: "d" });
  assertEquals([...set!].sort(), ["ar-1", "ar-2"]);
});

Deno.test("fetchGateArtistIds with null cityId reads only date-level gate rows", async () => {
  // No city -> the show-level (show+city) gate query must be skipped entirely;
  // only show_date_cast_eligibility contributes gate casts.
  const { deps, calls } = makeFakeDeps({ tables: {
    // Would be a gate row if the show-level query ran; it must not.
    show_cast_eligibility: { data: [{ cast_id: "cast-a" }] },
    show_date_cast_eligibility: { data: [{ cast_id: "cast-b" }] },
    cast_members: { data: [{ artist_id: "ar-9" }] },
  } });
  const set = await fetchGateArtistIds(deps.admin, { showId: "s", cityId: null, showDateId: "d" });
  assertEquals([...set!], ["ar-9"]);
  assertEquals(
    calls.some((c) => c.table === "show_cast_eligibility"),
    false,
    "show_cast_eligibility must not be queried when cityId is null",
  );
  const inCall = calls.find((c) => c.table === "cast_members" && c.method === "in");
  assertExists(inCall, "cast_members must be filtered by the gate cast ids");
  assertEquals(inCall!.args, ["cast_id", ["cast-b"]]);
});

Deno.test("fetchRequiredSkillIds unions show and date rows", async () => {
  const { deps } = makeFakeDeps({ tables: {
    show_required_skills: { data: [{ skill_id: "sk-1" }] },
    show_date_required_skills: { data: [{ skill_id: "sk-1" }, { skill_id: "sk-2" }] },
  } });
  assertEquals(await fetchRequiredSkillIds(deps.admin, { showId: "s", showDateId: "d" }), ["sk-1", "sk-2"]);
});

Deno.test("fetchRequiredSkillIds subtracts date-dropped skills: (show union dateAdded) minus dateDropped", async () => {
  // Twin of the src/data/eligibility.ts case: show {sk-1, sk-2}, date adds {sk-3},
  // date drops {sk-2} => required = {sk-1, sk-3}. Identical set math to the frontend.
  const { deps } = makeFakeDeps({ tables: {
    show_required_skills: { data: [{ skill_id: "sk-1" }, { skill_id: "sk-2" }] },
    show_date_required_skills: { data: [{ skill_id: "sk-3" }] },
    show_date_skill_drops: { data: [{ skill_id: "sk-2" }] },
  } });
  assertEquals(await fetchRequiredSkillIds(deps.admin, { showId: "s", showDateId: "d" }), ["sk-1", "sk-3"]);
});

Deno.test("filterArtistIdsBySkills keeps only artists holding ALL required skills", async () => {
  const { deps } = makeFakeDeps({ tables: {
    artist_skills: { data: [
      { artist_id: "ar-1", skill_id: "sk-1" }, { artist_id: "ar-1", skill_id: "sk-2" },
      { artist_id: "ar-2", skill_id: "sk-1" },
    ] },
  } });
  assertEquals(await filterArtistIdsBySkills(deps.admin, ["ar-1", "ar-2", "ar-3"], ["sk-1", "sk-2"]), ["ar-1"]);
  assertEquals(await filterArtistIdsBySkills(deps.admin, ["ar-1", "ar-2"], []), ["ar-1", "ar-2"]);
});
