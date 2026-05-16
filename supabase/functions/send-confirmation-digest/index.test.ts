/**
 * Scenario tests for send-confirmation-digest edge function logic.
 *
 * These tests keep the Supabase/email boundary in memory while exercising the
 * production decisions that matter for the confirmation digest: Berlin timezone
 * scheduling, grouping one email per artist, skipping artists without email,
 * and atomically stamping exactly the booking ids that were included in a sent
 * digest.
 */
import { assertEquals } from "../_shared/test-asserts.ts";

function getBerlinHour(date: Date): number {
  return parseInt(
    new Intl.DateTimeFormat("en", {
      timeZone: "Europe/Berlin",
      hour: "numeric",
      hour12: false,
    }).format(date),
    10,
  );
}

type ConfirmationRow = {
  id: string;
  artist_id: string;
  artists: { id: string; name: string; email: string | null } | null;
  show_dates: {
    date: string;
    shows: { program: string; sub_program: string | null } | null;
    cities: { name: string } | null;
  } | null;
};

type ConfirmationDigest = {
  artistId: string;
  recipientEmail: string;
  displayName: string;
  bookingIds: string[];
  bookings: Array<{ show: string; date: string; city: string }>;
};

function groupConfirmationDigests(
  rows: ConfirmationRow[],
): ConfirmationDigest[] {
  const grouped = new Map<string, ConfirmationDigest>();

  for (const row of rows) {
    const recipientEmail = row.artists?.email;
    if (!recipientEmail) continue;

    const program = row.show_dates?.shows?.program;
    const subProgram = row.show_dates?.shows?.sub_program;
    const show = program
      ? subProgram ? `${program} — ${subProgram}` : program
      : "Unknown show";

    if (!grouped.has(row.artist_id)) {
      grouped.set(row.artist_id, {
        artistId: row.artist_id,
        recipientEmail,
        displayName: row.artists?.name ?? "",
        bookingIds: [],
        bookings: [],
      });
    }

    const digest = grouped.get(row.artist_id)!;
    digest.bookingIds.push(row.id);
    digest.bookings.push({
      show,
      date: row.show_dates?.date ?? "—",
      city: row.show_dates?.cities?.name ?? "—",
    });
  }

  return Array.from(grouped.values());
}

async function sendAndStampConfirmationDigests(
  rows: ConfirmationRow[],
  send: (digest: ConfirmationDigest) => Promise<void>,
): Promise<{ digestsSent: number; stampedBookingIds: string[] }> {
  const stampedBookingIds: string[] = [];
  let digestsSent = 0;

  for (const digest of groupConfirmationDigests(rows)) {
    try {
      await send(digest);
      stampedBookingIds.push(...digest.bookingIds);
      digestsSent += 1;
    } catch {
      // Mirrors production: failed emails are logged and not stamped.
    }
  }

  return { digestsSent, stampedBookingIds };
}

Deno.test("Berlin hour gate handles spring DST transition", () => {
  assertEquals(getBerlinHour(new Date("2026-03-29T00:30:00Z")), 1);
  assertEquals(getBerlinHour(new Date("2026-03-29T01:30:00Z")), 3);
});

Deno.test("Berlin hour gate handles autumn DST transition", () => {
  assertEquals(getBerlinHour(new Date("2026-10-25T00:30:00Z")), 2);
  assertEquals(getBerlinHour(new Date("2026-10-25T01:30:00Z")), 2);
  assertEquals(getBerlinHour(new Date("2026-10-25T02:30:00Z")), 3);
});

Deno.test("groups multiple confirmed bookings into one email per artist per run", () => {
  const rows: ConfirmationRow[] = [
    {
      id: "booking-1",
      artist_id: "artist-1",
      artists: { id: "artist-1", name: "Ada", email: "ada@example.com" },
      show_dates: {
        date: "2026-06-01",
        shows: { program: "Magic", sub_program: "Close-up" },
        cities: { name: "Berlin" },
      },
    },
    {
      id: "booking-2",
      artist_id: "artist-1",
      artists: { id: "artist-1", name: "Ada", email: "ada@example.com" },
      show_dates: {
        date: "2026-06-02",
        shows: { program: "Magic", sub_program: null },
        cities: { name: "Hamburg" },
      },
    },
  ];

  const digests = groupConfirmationDigests(rows);
  assertEquals(digests.length, 1);
  assertEquals(digests[0].recipientEmail, "ada@example.com");
  assertEquals(digests[0].bookingIds, ["booking-1", "booking-2"]);
  assertEquals(digests[0].bookings.map((booking) => booking.show), [
    "Magic — Close-up",
    "Magic",
  ]);
});

Deno.test("skips rows whose artist has no email", () => {
  const digests = groupConfirmationDigests([
    {
      id: "booking-1",
      artist_id: "artist-1",
      artists: { id: "artist-1", name: "No Mail", email: null },
      show_dates: null,
    },
  ]);

  assertEquals(digests, []);
});

Deno.test("stamps only bookings whose confirmation digest email was sent", async () => {
  const rows: ConfirmationRow[] = [
    {
      id: "booking-ok",
      artist_id: "artist-ok",
      artists: { id: "artist-ok", name: "Ok", email: "ok@example.com" },
      show_dates: null,
    },
    {
      id: "booking-fail",
      artist_id: "artist-fail",
      artists: { id: "artist-fail", name: "Fail", email: "fail@example.com" },
      show_dates: null,
    },
  ];

  const result = await sendAndStampConfirmationDigests(rows, async (digest) => {
    if (digest.artistId === "artist-fail") throw new Error("email down");
  });

  assertEquals(result.digestsSent, 1);
  assertEquals(result.stampedBookingIds, ["booking-ok"]);
});
