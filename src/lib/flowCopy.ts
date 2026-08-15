// Central registry for every string that changes with the org's booking flow.
// Copy derives from the normalized flow's switches (artist_acceptance,
// offer_delivery), never from preset names, so custom configs work. Callers
// pass useBookingFlow() data (already normalized; fall back to
// BOOKING_FLOW_DEFAULTS while loading) plus a `t` bound to the `flowCopy`
// namespace (useTranslation('flowCopy')). Frontend-only: no _shared mirror.
// Strings live in src/i18n/locales/{en,de}/flowCopy.json; German ships dark
// behind the language_packages entitlement.

import type { TFunction } from "i18next";
import type { BookingFlow } from "./bookingFlow";

type FlowT = TFunction<"flowCopy">;

export interface PageCopy {
  title: string;
  subtitle: string;
}

export function availabilityPageCopy(flow: BookingFlow, t: FlowT): PageCopy {
  if (!flow.artist_acceptance) {
    return {
      title: t("availabilityPage.direct.title"),
      subtitle: t("availabilityPage.direct.subtitle"),
    };
  }
  return {
    title: t("availabilityPage.offer.title"),
    subtitle: t("availabilityPage.offer.subtitle"),
  };
}

export function bookingsViewCopy(flow: BookingFlow, t: FlowT): PageCopy {
  return {
    title: t("bookingsView.title"),
    subtitle: flow.artist_acceptance
      ? t("bookingsView.offerSubtitle")
      : t("bookingsView.directSubtitle"),
  };
}

// Shared by AvailabilityPage and ArtistBookingsView (both kept private copies
// before). suggested/soft_booked are unreachable in direct mode but keep sane
// fallbacks; cancelled only renders in the bookings view.
export function bookingStatusLabels(flow: BookingFlow, t: FlowT): Record<string, string> {
  if (!flow.artist_acceptance) {
    return {
      suggested: t("statusLabels.direct.suggested"),
      soft_booked: t("statusLabels.direct.soft_booked"),
      confirmed: t("statusLabels.direct.confirmed"),
      unanswered: t("statusLabels.direct.unanswered"),
      cancelled: t("statusLabels.direct.cancelled"),
    };
  }
  return {
    suggested: t("statusLabels.offer.suggested"),
    soft_booked: t("statusLabels.offer.soft_booked"),
    confirmed: t("statusLabels.offer.confirmed"),
    unanswered: t("statusLabels.offer.unanswered"),
    cancelled: t("statusLabels.offer.cancelled"),
  };
}

export interface MeterSpec {
  title: string;
  headerSentence: string;
  footer: string;
  explainer: string;
  filterUnanswered: boolean;
  countStatuses: string[];
}

export function artistMeter(flow: BookingFlow, t: FlowT): MeterSpec {
  if (!flow.artist_acceptance) {
    return {
      title: t("meter.direct.title"),
      headerSentence: t("meter.direct.headerSentence"),
      footer: t("meter.direct.footer"),
      explainer: t("meter.direct.explainer"),
      filterUnanswered: false,
      countStatuses: ["confirmed"],
    };
  }
  return {
    title: t("meter.offer.title"),
    headerSentence: t("meter.offer.headerSentence"),
    footer: t("meter.offer.footer"),
    explainer: t("meter.offer.explainer"),
    filterUnanswered: true,
    countStatuses: ["confirmed", "soft_booked"],
  };
}

export function deliveryHint(flow: BookingFlow, t: FlowT): string {
  return flow.artist_acceptance && flow.offer_delivery === "immediate"
    ? t("deliveryHint")
    : "";
}
