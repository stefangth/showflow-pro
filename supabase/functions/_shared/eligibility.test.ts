import { assertEquals } from "./test-asserts.ts";
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

Deno.test("fetchRequiredSkillIds unions show and date rows", async () => {
  const { deps } = makeFakeDeps({ tables: {
    show_required_skills: { data: [{ skill_id: "sk-1" }] },
    show_date_required_skills: { data: [{ skill_id: "sk-1" }, { skill_id: "sk-2" }] },
  } });
  assertEquals(await fetchRequiredSkillIds(deps.admin, { showId: "s", showDateId: "d" }), ["sk-1", "sk-2"]);
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
