/**
 * Chat access control — per-show-date chat is gated by booking status.
 *
 * Participants = admins, producers, and artists with a `soft_booked` or
 * `confirmed` booking for the date (see `is_chat_participant` +
 * `useChatParticipant`). A `suggested` offer is NOT enough.
 *
 *   1. Seed a show_date with two artists:
 *        - artist1: `soft_booked`  → participant
 *        - artist2: `suggested`    → non-participant
 *      and pre-create the chat row (ChatsListPage reads `chats` directly under
 *      RLS, so the row must exist for it to be listed at all).
 *   2. artist1 logs in → opens the chat from the Chats list and posts a message
 *      (real UI; asserted in the UI and in the DB).
 *   3. artist2 logs in → the chat is absent from their Chats list (real UI).
 *   4. Cancel artist1's booking → `is_chat_participant` now returns false for
 *      them (DB/RPC; re-driving the full logout/login UI for the guard flip
 *      adds no coverage the RPC doesn't already prove).
 *
 * The seeded show/cast/show_date reuse the booking-fixture tagging so
 * `cleanupBookingFixture()` tears everything down (chats + chat_messages
 * cascade off show_dates via ON DELETE CASCADE).
 */
import { expect, test } from "@playwright/test";
import { loginAsAndAwaitDashboard, navViaSidebar } from "./helpers/auth";
import { deleteUserByEmail, ensureUserWithRole, BOOTSTRAP_ORG_ID } from "./helpers/users";
import { adminClient, tagEmail, E2E_TAG } from "./helpers/supabase";
import {
  cleanupBookingFixture,
  seedBookingFixture,
  type BookingFixture,
} from "./helpers/booking";

const PARTICIPANT_EMAIL = tagEmail("artist-chat-participant", Date.now());
const PARTICIPANT_PASSWORD = "E2eChatParticipant!1";
const OUTSIDER_EMAIL = tagEmail("artist-chat-outsider", Date.now());
const OUTSIDER_PASSWORD = "E2eChatOutsider!1";

let fixture: BookingFixture;
let outsider: { id: string; email: string };
let outsiderArtistId: string;
let chatId: string;
let participantBookingId: string;

test.describe.configure({ mode: "serial" });

test.describe("Chat access control — booking status gates chat participation", () => {
  test.beforeAll(async () => {
    const admin = adminClient();

    await deleteUserByEmail(PARTICIPANT_EMAIL);
    await deleteUserByEmail(OUTSIDER_EMAIL);

    // artist1 (participant) + the full eligible graph.
    fixture = await seedBookingFixture({
      artistEmail: PARTICIPANT_EMAIL,
      artistPassword: PARTICIPANT_PASSWORD,
    });

    // artist2 (outsider): own user + artist row + cast membership.
    const outsiderUser = await ensureUserWithRole(
      OUTSIDER_EMAIL,
      OUTSIDER_PASSWORD,
      "artist"
    );
    outsider = { id: outsiderUser.id, email: outsiderUser.email };

    const { data: artist2, error: a2Err } = await admin
      .from("artists")
      .insert({
        name: `${E2E_TAG}-artist-outsider`,
        user_id: outsiderUser.id,
        email: outsiderUser.email,
        org_id: BOOTSTRAP_ORG_ID,
      })
      .select("id")
      .single();
    if (a2Err || !artist2) throw new Error(`seed outsider artist failed: ${a2Err?.message}`);
    outsiderArtistId = artist2.id;

    const { error: cm2Err } = await admin
      .from("cast_members")
      .insert({ cast_id: fixture.castId, artist_id: artist2.id });
    if (cm2Err) throw new Error(`seed outsider cast_member failed: ${cm2Err.message}`);

    // artist1 → soft_booked (participant); artist2 → suggested (non-participant).
    const { data: pBooking, error: pErr } = await admin
      .from("bookings")
      .insert({
        show_date_id: fixture.showDateId,
        artist_id: fixture.artistId,
        status: "soft_booked",
        is_understudy: false,
      })
      .select("id")
      .single();
    if (pErr || !pBooking) throw new Error(`seed participant booking failed: ${pErr?.message}`);
    participantBookingId = pBooking.id;

    const { error: oErr } = await admin.from("bookings").insert({
      show_date_id: fixture.showDateId,
      artist_id: outsiderArtistId,
      status: "suggested",
      is_understudy: false,
    });
    if (oErr) throw new Error(`seed outsider booking failed: ${oErr.message}`);

    // Pre-create the chat row so ChatsListPage (which reads `chats` directly
    // under RLS) can list it for the participant.
    const { data: chat, error: chatErr } = await admin
      .from("chats")
      .insert({ show_date_id: fixture.showDateId })
      .select("id")
      .single();
    if (chatErr || !chat) throw new Error(`seed chat failed: ${chatErr?.message}`);
    chatId = chat.id;
  });

  test.afterAll(async () => {
    await cleanupBookingFixture();
    await deleteUserByEmail(PARTICIPANT_EMAIL);
    await deleteUserByEmail(OUTSIDER_EMAIL);
  });

  test("soft-booked artist can open the chat and post a message", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, PARTICIPANT_EMAIL, PARTICIPANT_PASSWORD);
    // Chats nav is visible to all roles (no role gate on the nav item).
    await navViaSidebar(page, /^chats$/i);

    // The chat card is labelled by showLabel(program – sub_program).
    const chatCard = page.getByRole("button", { name: /e2e-program/i }).first();
    await expect(chatCard).toBeVisible({ timeout: 15_000 });
    await chatCard.click();

    // ShowDateDetailSheet → ChatPanel renders the message input for participants.
    const input = page.getByPlaceholder(/write a message/i);
    await expect(input).toBeVisible({ timeout: 15_000 });

    const body = `e2e-chat-hello-${Date.now()}`;
    await input.fill(body);
    // The send button is an icon-only submit (no accessible name); submit the
    // single-line input's form by pressing Enter instead.
    await input.press("Enter");

    // Message appears in the thread...
    await expect(page.getByText(body)).toBeVisible({ timeout: 10_000 });

    // ...and the row was written.
    const admin = adminClient();
    const { data: msg } = await admin
      .from("chat_messages")
      .select("id, user_id, body")
      .eq("chat_id", chatId)
      .eq("body", body)
      .maybeSingle();
    expect(msg?.user_id).toBe(fixture.artistUser.id);
  });

  test("suggested-only artist cannot see the chat in their list", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, OUTSIDER_EMAIL, OUTSIDER_PASSWORD);
    await navViaSidebar(page, /^chats$/i);

    // The list resolves to either explicit "No active chats" or simply omits
    // our seeded card. RLS on `chats` should hide it from the non-participant.
    await expect(
      page.getByRole("button", { name: /e2e-program/i })
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test("cancelling the participant's booking revokes chat access", async () => {
    const admin = adminClient();

    // Sanity: participant currently passes the guard.
    const { data: before } = await admin.rpc("is_chat_participant", {
      _chat_id: chatId,
      _user_id: fixture.artistUser.id,
    });
    expect(before).toBe(true);

    const { error } = await admin
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", participantBookingId);
    if (error) throw new Error(`cancel booking failed: ${error.message}`);

    const { data: after } = await admin.rpc("is_chat_participant", {
      _chat_id: chatId,
      _user_id: fixture.artistUser.id,
    });
    expect(after).toBe(false);
  });
});
