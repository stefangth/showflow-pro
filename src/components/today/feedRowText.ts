import type { TFunction } from "i18next";
import type { FeedRow } from "@/lib/autopilot/today";

/**
 * Renders one feed row's structured values (`count`/`names`/`show`/`date`,
 * see `FeedRowDetail` in `src/lib/autopilot/today.ts`) through the `feed.*`
 * i18n keys — the fix for finding 6 in the Today board review: the data
 * layer (`fetchAutopilotFeed`) used to bake an already-formatted English
 * sentence, and the `feed.*` keys authored for this sat dead. Used by both
 * `DoneForYouFeed` (the row's on-card text) and `TodayPage`'s toast/
 * navigation fallbacks, so they render the exact same text rather than
 * `TodayPage` keeping its own English copy.
 */
export function feedRowText(
  t: TFunction<"today">,
  row: FeedRow,
  opts?: { producerConfirmation?: boolean; canBook?: boolean },
): string {
  switch (row.kind) {
    case "book":
      // A "book" row is an artist saying yes. Whether that yes IS a booking depends
      // on the org's flow: with producer_confirmation on (Classic) it is only a hold
      // until someone books it, so the row may not claim the place is theirs. Who
      // that someone is depends on the VIEWER: a producer whose org revoked
      // `confirm_bookings` cannot book, so the row names an admin instead of telling
      // them to do it. Autopilot orgs (a yes books on its own) keep booked wording.
      if (!opts?.producerConfirmation) {
        return t("feed.book", { count: row.count, names: row.names, show: row.show, date: row.date });
      }
      return opts.canBook === false
        ? t("feed.bookHoldAdmin", { count: row.count, names: row.names, show: row.show, date: row.date })
        : t("feed.bookHold", { count: row.count, names: row.names, show: row.show, date: row.date });
    case "ask":
      return t("feed.ask", { count: row.count, show: row.show, date: row.date });
    case "draft":
      return t("feed.draft", { count: row.count, show: row.show, date: row.date });
    case "notify":
      return t("feed.notify", {
        names: row.names || t("feed.theCast"),
        show: row.show,
        date: row.date,
      });
  }
}
