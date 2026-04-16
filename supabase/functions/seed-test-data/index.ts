import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const results: string[] = [];

  // 1. Create test users
  const testUsers = [
    { email: "test-admin@showflowpro.com", password: "TestAdmin123!", displayName: "Test Admin", role: "admin" },
    { email: "test-producer@showflowpro.com", password: "TestProducer123!", displayName: "Test Producer", role: "producer" },
    { email: "test-artist@showflowpro.com", password: "TestArtist123!", displayName: "Test Artist", role: "artist" },
  ];

  const userIds: Record<string, string> = {};

  for (const u of testUsers) {
    // Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existing = existingUsers?.users?.find((eu) => eu.email === u.email);
    
    if (existing) {
      userIds[u.role] = existing.id;
      results.push(`User ${u.email} already exists (${existing.id})`);
    } else {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { display_name: u.displayName },
      });
      if (error) {
        results.push(`Failed to create ${u.email}: ${error.message}`);
        continue;
      }
      userIds[u.role] = data.user.id;
      results.push(`Created user ${u.email} (${data.user.id})`);
    }

    // Assign role
    const { error: roleErr } = await supabaseAdmin.from("user_roles").upsert(
      { user_id: userIds[u.role], role: u.role },
      { onConflict: "user_id,role" }
    );
    if (roleErr) results.push(`Role assign error for ${u.role}: ${roleErr.message}`);
    else results.push(`Assigned role '${u.role}' to ${u.email}`);
  }

  // 2. Seed shows
  const showsData = [
    { title: "The Jury Experience", venue: "Fever Madrid — Gran Vía", category: "immersive", description: "Interactive courtroom drama where the audience decides the verdict.", required_skills: ["acting", "improv"], slots_per_date: 6, status: "active", created_by: userIds.producer },
    { title: "Ballet of Lights", venue: "Fever Barcelona — Sala Apolo", category: "dance", description: "Contemporary ballet with projection mapping and LED costumes.", required_skills: ["ballet", "contemporary"], slots_per_date: 8, status: "active", created_by: userIds.producer },
    { title: "Candlelight: Vivaldi", venue: "Fever London — St. James Church", category: "music", description: "String quartet performing Vivaldi's Four Seasons by candlelight.", required_skills: ["strings", "classical"], slots_per_date: 4, status: "active", created_by: userIds.producer },
    { title: "The Haunted Experience", venue: "Fever NYC — Chelsea Market", category: "immersive", description: "Horror-themed immersive walk-through with live actors.", required_skills: ["acting", "physical theatre"], slots_per_date: 10, status: "draft", created_by: userIds.admin },
    { title: "Comedy Night Live", venue: "Fever Paris — Le Marais", category: "comedy", description: "Stand-up showcase featuring rotating comedians.", required_skills: ["comedy", "improv"], slots_per_date: 3, status: "active", created_by: userIds.producer },
  ];

  const { data: shows, error: showErr } = await supabaseAdmin.from("shows").insert(showsData).select();
  if (showErr) results.push(`Shows error: ${showErr.message}`);
  else results.push(`Created ${shows.length} shows`);

  // 3. Seed show_dates (next 30 days)
  const showDatesData: any[] = [];
  if (shows) {
    const today = new Date();
    for (const show of shows) {
      for (let i = 1; i <= 6; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i * 3 + Math.floor(Math.random() * 3));
        showDatesData.push({
          show_id: show.id,
          date: d.toISOString().split("T")[0],
          start_time: ["18:00", "19:30", "20:00", "21:00"][Math.floor(Math.random() * 4)],
          end_time: "23:00",
          status: i <= 2 ? "fully_filled" : i <= 4 ? "partially_filled" : "open",
        });
      }
    }
  }

  const { data: showDates, error: sdErr } = await supabaseAdmin.from("show_dates").insert(showDatesData).select();
  if (sdErr) results.push(`Show dates error: ${sdErr.message}`);
  else results.push(`Created ${showDates.length} show dates`);

  // 4. Seed artists
  const artistNames = [
    { name: "Sofia Reyes", skills: ["acting", "improv", "comedy"], bio: "Veteran improv performer with 8 years of experience.", email: "sofia@test.com", priority_score: 85 },
    { name: "Marco Chen", skills: ["ballet", "contemporary", "physical theatre"], bio: "Classically trained dancer, Royal Ballet background.", email: "marco@test.com", priority_score: 92 },
    { name: "Aisha Johnson", skills: ["strings", "classical", "violin"], bio: "First violin, London Philharmonic Youth Orchestra alumna.", email: "aisha@test.com", priority_score: 78 },
    { name: "Lucas Moretti", skills: ["acting", "physical theatre"], bio: "Physical theatre specialist, trained at Lecoq.", email: "lucas@test.com", priority_score: 70 },
    { name: "Emma Larsson", skills: ["comedy", "improv", "acting"], bio: "Stand-up comedian and sketch performer.", email: "emma@test.com", priority_score: 65 },
    { name: "Raj Patel", skills: ["strings", "classical", "cello"], bio: "Solo cellist with international competition experience.", email: "raj@test.com", priority_score: 88 },
    { name: "Yuki Tanaka", skills: ["ballet", "contemporary"], bio: "Contemporary fusion dancer, Tokyo Arts graduate.", email: "yuki@test.com", priority_score: 73 },
    { name: "Carlos Vega", skills: ["acting", "improv", "physical theatre"], bio: "Bilingual performer specializing in immersive theatre.", email: "carlos@test.com", priority_score: 80 },
    // Link one artist to the test-artist user
    { name: "Test Artist (Linked)", skills: ["acting", "improv", "comedy", "ballet"], bio: "Test account artist profile.", email: "test-artist@showflowpro.com", priority_score: 75, user_id: userIds.artist },
  ];

  const { data: artists, error: artErr } = await supabaseAdmin.from("artists").insert(artistNames).select();
  if (artErr) results.push(`Artists error: ${artErr.message}`);
  else results.push(`Created ${artists.length} artists`);

  // 5. Seed availability (next 14 days for each artist)
  if (artists) {
    const availData: any[] = [];
    const today = new Date();
    for (const artist of artists) {
      for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const statuses = ["available", "available", "available", "unavailable", "tentative"] as const;
        availData.push({
          artist_id: artist.id,
          date: d.toISOString().split("T")[0],
          status: statuses[Math.floor(Math.random() * statuses.length)],
        });
      }
    }
    const { error: avErr } = await supabaseAdmin.from("availability").insert(availData);
    if (avErr) results.push(`Availability error: ${avErr.message}`);
    else results.push(`Created ${availData.length} availability records`);
  }

  // 6. Seed bookings
  if (artists && showDates) {
    const bookingsData: any[] = [];
    const statuses = ["suggested", "soft_booked", "confirmed", "confirmed"] as const;
    // Create ~15 bookings spread across show dates and artists
    for (let i = 0; i < 15; i++) {
      const sd = showDates[i % showDates.length];
      const artist = artists[i % artists.length];
      bookingsData.push({
        show_date_id: sd.id,
        artist_id: artist.id,
        status: statuses[Math.floor(Math.random() * statuses.length)],
        is_understudy: i % 5 === 0,
        booked_by: userIds.producer,
        notes: i % 3 === 0 ? "Auto-suggested based on availability" : null,
      });
    }
    const { error: bkErr } = await supabaseAdmin.from("bookings").insert(bookingsData);
    if (bkErr) results.push(`Bookings error: ${bkErr.message}`);
    else results.push(`Created ${bookingsData.length} bookings`);
  }

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
