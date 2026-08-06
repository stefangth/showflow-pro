import type { HireOrderTemplate } from "./terms";

/**
 * Code fallback for the platform terms library (`hire_order_terms_library`), the
 * catalogue an org imports a COPY of into its own `hire_order_terms`. It is not a
 * platform default on `hire_order_terms`: silent inheritance would let a later
 * platform edit change contract text an org is already issuing (spec §2.1).
 *
 * Ids are `platform-` prefixed on purpose. Orders persist `terms_variant` as a
 * free-form id, and the bare ids "lean" / "standard" / "full" are rewritten by the
 * legacy branch in `normalizeTermsSetting`.
 *
 * The wording below is a product-agnostic drafting starting point and has not had
 * legal review. Treat sign-off as a release gate; no code path depends on it.
 */
export const HIRE_ORDER_STARTER_TERMS: HireOrderTemplate[] = [
  {
    id: "platform-standard-engagement",
    name: "Standard engagement",
    clauses: [
      {
        title: "Engagement",
        body: "The artist is engaged for the dates, venue and sessions set out on this order. Call and performance times may move by up to 60 minutes with reasonable notice. A change of date or venue requires the artist's agreement.",
      },
      {
        title: "Fee and payment",
        body: "The fee stated on this order is gross and covers rehearsal and performance for the dates listed. It is payable within 14 days of the final engagement date, against an invoice where one is required.",
      },
      {
        title: "Cancellation",
        body: "Either party may cancel without fee up to 21 days before the first engagement date. After that point the full fee remains payable, unless the artist is replaced by agreement between the parties.",
      },
      {
        title: "Travel and lodging",
        body: "Travel and lodging are carried by the production unless this order states otherwise.",
      },
      {
        title: "Recording and publicity",
        body: "The production may photograph and record the engagement for archive and promotional use. Commercial exploitation beyond that requires a separate written agreement.",
      },
      {
        title: "Illness and force majeure",
        body: "If the artist cannot appear through illness, or through an event outside the control of either party, the parties will agree a replacement or an adjusted fee in good faith. Notice must be given as soon as the situation is known.",
      },
      {
        title: "Governing law",
        body: "This engagement is governed by the law of the country in which the hiring party is registered.",
      },
    ],
  },
  {
    id: "platform-guest-per-session",
    name: "Guest artist, per session",
    clauses: [
      {
        title: "Engagement",
        body: "The artist is engaged as a guest for the sessions listed on this order. Each session is booked and paid for separately. Sessions added later require a new order.",
      },
      {
        title: "Fee and payment",
        body: "The fee stated is per session and is payable within 14 days of the final session, against an invoice where one is required. A session cancelled by the production inside the notice period below is treated as performed.",
      },
      {
        title: "Cancellation",
        body: "Either party may cancel a session without fee up to 14 days before it takes place. Inside 14 days the session fee remains payable.",
      },
      {
        title: "Travel and lodging",
        body: "Travel and lodging for guest artists are carried by the production, and booked by the production unless agreed otherwise in advance.",
      },
      {
        title: "Recording and publicity",
        body: "The production may photograph and record the sessions for archive and promotional use. Commercial exploitation beyond that requires a separate written agreement.",
      },
      {
        title: "Governing law",
        body: "This engagement is governed by the law of the country in which the hiring party is registered.",
      },
    ],
  },
];
