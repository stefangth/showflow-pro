import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mirror of BOOKING_CONFIG.SUGGEST_WEIGHTS from app.config.ts
const WEIGHTS = { PRIORITY: 0.4, SKILL_MATCH: 0.35, AVAILABILITY_HISTORY: 0.25 };
const MAX_SUGGESTIONS = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json(null, 204);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData } = await userClient.auth.getClaims(token);
    if (!claimsData?.claims) return json({ error: 'Unauthorized' }, 401);
    const callerId = claimsData.claims.sub as string;

    const admin = createClient(supabaseUrl, serviceKey);

    // Caller must be admin, producer, or artist (artists further verified below)
    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', callerId)
      .in('role', ['admin', 'producer', 'artist'])
      .maybeSingle();
    if (!roleRow) return json({ error: 'Forbidden' }, 403);
    const callerIsArtist = roleRow.role === 'artist';

    const body = await req.json().catch(() => ({}));
    const show_date_id: string = body.show_date_id || '';
    if (!show_date_id) return json({ error: 'show_date_id is required' }, 400);

    // Fetch the show date + parent show
    const { data: showDate, error: sdErr } = await admin
      .from('show_dates')
      .select('id, show_id, city_id, date, status, shows(required_skills, sub_program)')
      .eq('id', show_date_id)
      .maybeSingle();
    if (sdErr || !showDate) return json({ error: 'Show date not found' }, 404);
    if (showDate.status === 'cancelled') return json({ error: 'Show date is cancelled' }, 400);

    // Artists may only trigger suggestions for dates where they themselves are available
    if (callerIsArtist) {
      const { data: artistRow } = await admin
        .from('artists')
        .select('id')
        .eq('user_id', callerId)
        .maybeSingle();
      if (!artistRow) return json({ error: 'Forbidden — no artist profile linked to this account' }, 403);

      const { data: availRow } = await admin
        .from('availability')
        .select('id')
        .eq('artist_id', artistRow.id)
        .eq('date', (showDate as any).date)
        .eq('status', 'available')
        .maybeSingle();
      if (!availRow) return json({ error: 'Forbidden — you must be available on this date to trigger suggestions' }, 403);
    }

    const show = (showDate as any).shows as { required_skills: string[] | null; sub_program: string | null };
    const requiredSkills: string[] = show.required_skills ?? [];

    // Resolve slot count from sub_program_slots_defaults (no fallback — must be configured)
    const { data: slotSetting } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'sub_program_slots_defaults')
      .maybeSingle();
    const slotDefaults = (slotSetting?.value ?? {}) as Record<string, { main_cast: number; understudies: number }>;
    const slotConfig = show.sub_program ? slotDefaults[show.sub_program] : null;
    if (!slotConfig) {
      return json({ error: `No slot configuration for sub-program "${show.sub_program ?? '(none)'}". Set defaults in Settings.` }, 400);
    }
    const effectiveSlots: number = slotConfig.main_cast;

    // Find eligible artists: those in casts eligible for this show_date
    // Logic mirrors useArtistEligibleDates: cast membership → show_cast_eligibility or show_date_cast_eligibility
    const { data: dateCastRows } = await admin
      .from('show_date_cast_eligibility')
      .select('cast_id')
      .eq('show_date_id', show_date_id);

    const { data: showCastRows } = await admin
      .from('show_cast_eligibility')
      .select('cast_id')
      .eq('show_id', showDate.show_id)
      .eq('city_id', showDate.city_id ?? '');

    const eligibleCastIds = new Set<string>([
      ...(dateCastRows ?? []).map((r: any) => r.cast_id),
      ...(showCastRows ?? []).map((r: any) => r.cast_id),
    ]);

    if (eligibleCastIds.size === 0) {
      return json({ suggestions: [], message: 'No eligible casts for this show date' });
    }

    const { data: castMemberRows } = await admin
      .from('cast_members')
      .select('artist_id')
      .in('cast_id', [...eligibleCastIds]);

    const eligibleArtistIds = [...new Set((castMemberRows ?? []).map((r: any) => r.artist_id))];
    if (eligibleArtistIds.length === 0) return json({ suggestions: [], message: 'No eligible artists' });

    // Fetch already-booked artists for this date
    const { data: existingBookings } = await admin
      .from('bookings')
      .select('artist_id, status')
      .eq('show_date_id', show_date_id)
      .neq('status', 'cancelled');

    const alreadyBookedIds = new Set((existingBookings ?? []).map((b: any) => b.artist_id));
    const confirmedCount = (existingBookings ?? []).filter((b: any) => b.status === 'confirmed').length;

    if (confirmedCount >= effectiveSlots) {
      return json({ suggestions: [], message: 'Show date is already fully filled' });
    }

    const slotsRemaining = effectiveSlots - confirmedCount;
    const candidateIds = eligibleArtistIds.filter((id) => !alreadyBookedIds.has(id));
    if (candidateIds.length === 0) return json({ suggestions: [], message: 'All eligible artists already booked' });

    // Fetch artist details
    const { data: artists } = await admin
      .from('artists')
      .select('id, name, priority_score, skills, status')
      .in('id', candidateIds)
      .eq('status', 'active');

    if (!artists || artists.length === 0) return json({ suggestions: [], message: 'No active eligible artists' });

    // Fetch recent booking history (past 90 days) for scoring
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentBookings } = await admin
      .from('bookings')
      .select('artist_id')
      .in('artist_id', artists.map((a: any) => a.id))
      .gte('created_at', since)
      .eq('status', 'confirmed');

    const recentCountMap = new Map<string, number>();
    for (const b of (recentBookings ?? [])) {
      recentCountMap.set(b.artist_id, (recentCountMap.get(b.artist_id) ?? 0) + 1);
    }

    // Score each candidate
    const scored = artists.map((artist: any) => {
      const priorityScore   = Math.min((artist.priority_score ?? 0) / 10, 1);
      const artistSkills    = new Set<string>(artist.skills ?? []);
      const skillMatch      = requiredSkills.length === 0
        ? 1
        : requiredSkills.filter((s) => artistSkills.has(s)).length / requiredSkills.length;
      const recentCount     = recentCountMap.get(artist.id) ?? 0;
      const historyScore    = 1 - Math.min(recentCount / 10, 1); // fewer recent bookings = higher score

      const total =
        priorityScore   * WEIGHTS.PRIORITY +
        skillMatch      * WEIGHTS.SKILL_MATCH +
        historyScore    * WEIGHTS.AVAILABILITY_HISTORY;

      return { artist_id: artist.id, artist_name: artist.name, score: Math.round(total * 1000) / 1000 };
    });

    scored.sort((a, b) => b.score - a.score);
    const topCandidates = scored.slice(0, Math.min(slotsRemaining * MAX_SUGGESTIONS, scored.length));

    // Insert suggested bookings (idempotent)
    const toInsert = topCandidates.map((c) => ({
      show_date_id,
      artist_id:  c.artist_id,
      status:     'suggested',
      is_understudy: false,
      booked_by:  callerId,
    }));

    const { data: inserted, error: insErr } = await admin
      .from('bookings')
      .upsert(toInsert, { onConflict: 'show_date_id,artist_id', ignoreDuplicates: true })
      .select('id, artist_id, status');

    if (insErr) throw insErr;

    return json({ suggestions: topCandidates, bookings_created: inserted?.length ?? 0 });
  } catch (e) {
    console.error('auto-suggest-bookings error', e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
