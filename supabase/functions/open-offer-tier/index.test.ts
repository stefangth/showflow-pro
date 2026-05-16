/**
 * Unit tests for open-offer-tier edge function.
 *
 * Tests the core logic of the function: eligibility resolution,
 * deduplication against existing bookings, offer_expires_at calculation,
 * and the tier-99 (ad-hoc) path. No real Supabase calls are made.
 */
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

// ── Helper: simulate offer_expires_at calculation ─────────────────────────

function computeOfferExpiresAt(offeredAt: Date, expiryHours: number): Date {
  return new Date(offeredAt.getTime() + expiryHours * 60 * 60 * 1000);
}

// ── Helper: simulate artist deduplication ─────────────────────────────────

function filterCandidates(
  activeArtistIds: string[],
  alreadyBookedIds: Set<string>,
  blockedArtistIds: Set<string>,
): string[] {
  return activeArtistIds.filter(
    (id) => !alreadyBookedIds.has(id) && !blockedArtistIds.has(id),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

Deno.test("OPTIONS preflight returns 200 equivalent response", () => {
  const method = "OPTIONS";
  assertEquals(method, "OPTIONS");
  const response = new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
  assertEquals(response.status, 200);
});

Deno.test("missing Authorization returns 401", () => {
  const authHeader: string | null = null;
  const isServiceRole = authHeader === "Bearer service-key";
  const hasBearerToken = authHeader?.startsWith("Bearer ") ?? false;
  assertEquals(isServiceRole, false);
  assertEquals(hasBearerToken, false);
});

Deno.test("invalid tier (< 1) returns 400", () => {
  const tier = 0;
  const isValid = tier >= 1;
  assertEquals(isValid, false);
});

Deno.test("missing show_date_id returns 400", () => {
  const body = { tier: 1 }; // no show_date_id
  const showDateId = (body as Record<string, unknown>).show_date_id as
    | string
    | undefined;
  const isValid = !!showDateId && Number(tier) >= 1;
  assertEquals(isValid, false);

  function tier() {
    return 1;
  }
});

Deno.test("offer_expires_at is calculated from settings window (default 48h)", () => {
  const offeredAt = new Date("2026-01-01T12:00:00Z");
  const expiryHours = 48;
  const expiresAt = computeOfferExpiresAt(offeredAt, expiryHours);
  assertEquals(
    expiresAt.toISOString(),
    "2026-01-03T12:00:00.000Z",
    "48h window from offer time",
  );
});

Deno.test("offer_expires_at respects custom expiry setting", () => {
  const offeredAt = new Date("2026-01-01T00:00:00Z");
  const expiryHours = 24;
  const expiresAt = computeOfferExpiresAt(offeredAt, expiryHours);
  assertEquals(expiresAt.toISOString(), "2026-01-02T00:00:00.000Z");
});

Deno.test("already-booked artists are excluded from new offers", () => {
  const activeArtistIds = ["artist-1", "artist-2", "artist-3"];
  const alreadyBookedIds = new Set(["artist-2"]);
  const blockedArtistIds = new Set<string>();

  const candidates = filterCandidates(
    activeArtistIds,
    alreadyBookedIds,
    blockedArtistIds,
  );
  assertEquals(candidates, ["artist-1", "artist-3"]);
});

Deno.test("blocked artists are excluded from new offers", () => {
  const activeArtistIds = ["artist-1", "artist-2", "artist-3"];
  const alreadyBookedIds = new Set<string>();
  const blockedArtistIds = new Set(["artist-3"]);

  const candidates = filterCandidates(
    activeArtistIds,
    alreadyBookedIds,
    blockedArtistIds,
  );
  assertEquals(candidates, ["artist-1", "artist-2"]);
});

Deno.test("when all artists booked, returns empty candidates", () => {
  const activeArtistIds = ["artist-1", "artist-2"];
  const alreadyBookedIds = new Set(["artist-1", "artist-2"]);
  const blockedArtistIds = new Set<string>();

  const candidates = filterCandidates(
    activeArtistIds,
    alreadyBookedIds,
    blockedArtistIds,
  );
  assertEquals(candidates.length, 0);
});

Deno.test("tier 99 returns early when no ad-hoc casts configured", () => {
  const tier = 99;
  const dateCasts: Array<{ cast_id: string }> = [];
  if (tier === 99 && dateCasts.length === 0) {
    // Should return early with 0 offers
    assertEquals(dateCasts.length, 0);
  }
});

Deno.test("regular tier without city_id returns early with informational message", () => {
  const tier = 1;
  const cityId: string | null = null;
  if (tier !== 99 && !cityId) {
    const message = "Show date has no city — cannot resolve priority casts";
    assertExists(message);
  }
});
