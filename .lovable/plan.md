

## Plan: Casts, City Eligibility, and Per-Date Chat

### 1. Data model

New tables (all RLS-enabled, `authenticated` only):

- **`cities`** — `id`, `name` (unique), `airtable_record_id` (nullable), `created_at`. Mock-seed: Berlin, London, Paris, New York, Madrid. Replaced by Airtable sync later.
- **`casts`** — `id`, `name`, `description`, `created_by`, timestamps. Producers/admins manage.
- **`cast_members`** — `cast_id` ↔ `artist_id` (composite unique). Producers/admins manage.
- **`show_cast_eligibility`** — `show_id`, `city_id`, `cast_id` (composite unique). The "show + city → eligible casts" config. Producers/admins manage.
- **`show_date_cast_eligibility`** — `show_date_id`, `cast_id` (composite unique). Per-date overrides/additions on top of the show-level inheritance. Producers/admins manage.
- **`chats`** — `id`, `show_date_id` (unique, one chat per date), `created_by`, `created_at`. Auto-created on first message.
- **`chat_messages`** — `id`, `chat_id`, `user_id`, `body`, `created_at`. Realtime-enabled.

Schema additions to existing tables:

- **`artists.cast_role`** (text, nullable) — free-text role tag (e.g. "lead violin").
- **`show_dates.city_id`** (uuid, nullable, FK → cities) — needed so we can resolve "this date's eligible casts" by joining show + city.

Helper SQL function `is_chat_participant(_chat_id uuid, _user_id uuid)`:
- Returns true if user is admin/producer, OR is the artist on a `bookings` row with status in (`soft_booked`,`confirmed`) for the chat's `show_date_id`.

RLS using that function:
- `chats` — SELECT/INSERT for participants. UPDATE/DELETE: admin only.
- `chat_messages` — SELECT for participants; INSERT for participants where `user_id = auth.uid()`. No UPDATE/DELETE.

Eligibility resolver (frontend): for a given `show_date`, eligible casts = (show-level casts for `show_date.city_id`) ∪ (per-date overrides). Bookable artists = members of those casts.

### 2. UI — Artists page

- New "Cast role" input on add-artist dialog and on artist card display (small muted line).
- New "Casts" multi-select chip on each artist card showing memberships.
- New "Casts" section (above the artist grid) — for producers/admins: list of casts with member counts, "New Cast" button → dialog (name + description), click a cast → side sheet to add/remove member artists.

### 3. UI — Show detail page

New "Cast eligibility" panel (producer/admin only) above the dates list:
- Per city: multi-select of casts. Saved into `show_cast_eligibility`.
- Helper text: "New dates synced from Airtable inherit this. Override per date below."

On each show date card:
- Show inherited casts as muted chips + "+ Add cast for this date" → adds to `show_date_cast_eligibility`.
- City selector (dropdown of `cities`) on the date itself, drives which inherited casts apply.

Booking panel (`Available Artists`) is now filtered: show only artists who are members of at least one eligible cast for that date (and still respect availability).

### 4. UI — Chat

New `ChatPanel` component on the show-date booking view (right column tab "Chat" alongside "Bookings"):
- Lists messages chronologically, input at the bottom.
- Subscribes via Supabase Realtime to `chat_messages` for live updates.
- Hidden entirely if `show_date.date < now() - 30 days` (archive rule) for non-admins; admins see a muted "Archived" banner and read-only history.
- Top bar: participant count + avatars (booked + soft-booked artists + producers/admins resolved client-side from `bookings` + `user_roles`).
- New "Chats" entry in sidebar → `ChatsListPage` showing all active (non-archived) chats the user is a participant in, grouped by date.

### 5. Settings → new "Casts & Cities" tab

Producers + admins (lift the admin-only gate so producers can access **just this tab** — page-level guard adjusted to allow producer for the casts/cities tabs only).

- **Cities**: list + add/remove (text). Note: "Pulled from Airtable once sync is wired — currently editable for mock data."
- **Casts overview**: link to Artists page (where casts are managed inline).
- **Show eligibility matrix** (admins only): table of shows × cities → which casts eligible. Useful for bulk config.

### 6. Files to create / edit

```text
NEW:
  src/components/casts/CastsSection.tsx       (artists page section)
  src/components/casts/CastDialog.tsx
  src/components/casts/CastMembersSheet.tsx
  src/components/casts/EligibilityPanel.tsx   (show detail)
  src/components/chat/ChatPanel.tsx
  src/components/chat/MessageBubble.tsx
  src/hooks/useChatParticipant.ts
  src/hooks/useEligibleArtists.ts
  src/pages/ChatsListPage.tsx
  src/pages/SettingsPage.tsx                  (add "Casts & Cities" tab)
  supabase/migrations/<ts>_casts_cities_chat.sql

EDIT:
  src/App.tsx                                 (route /chats)
  src/components/layout/AppLayout.tsx         (sidebar entry)
  src/pages/ArtistsPage.tsx                   (cast_role + casts UI)
  src/pages/ShowDetailPage.tsx                (eligibility + city + filtered bookable list + chat tab)
  src/types/index.ts                          (Cast, City, ChatMessage exports)
  src/config/app.config.ts                    (ROUTES.CHATS, CHAT_ARCHIVE_DAYS = 30)
```

### 7. Realtime

Enable Supabase Realtime publication on `chat_messages` (added in the migration). `ChatPanel` uses `supabase.channel()` to subscribe.

### 8. Out of scope (explicit)

- No real Airtable city sync — `cities` is mock + manually editable until the schema lands.
- No push notifications for chat (only in-app via existing notifications table — out of scope here).
- No file/image attachments in chat (text only v1).
- No hard-delete edge function for archived chats — rows remain; UI hides them.

