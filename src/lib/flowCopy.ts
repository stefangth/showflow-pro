// Central registry for every string that changes with the org's booking flow.
// Copy derives from the normalized flow's switches (artist_acceptance,
// offer_delivery), never from preset names, so custom configs work. Callers
// pass useBookingFlow() data (already normalized; fall back to
// BOOKING_FLOW_DEFAULTS while loading). Frontend-only: no _shared mirror.
// No em- or en-dashes in any string (middot and arrows are fine).

import type { BookingFlow } from "./bookingFlow";

export interface PageCopy {
  title: string;
  subtitle: string;
}

export function availabilityPageCopy(flow: BookingFlow): PageCopy {
  if (!flow.artist_acceptance) {
    return {
      title: "My Dates",
      subtitle: "Your bookings and availability. Block dates you can't perform.",
    };
  }
  return {
    title: "My Offers",
    subtitle: "View your offers and block dates you're unavailable for.",
  };
}

export function bookingsViewCopy(flow: BookingFlow): PageCopy {
  return {
    title: "My Bookings",
    subtitle: flow.artist_acceptance
      ? "Dates you've been offered for, based on your cast eligibility."
      : "Dates you're booked for, based on your cast eligibility.",
  };
}

// Shared by AvailabilityPage and ArtistBookingsView (both kept private copies
// before). suggested/soft_booked are unreachable in direct mode but keep sane
// fallbacks; cancelled only renders in the bookings view.
export function bookingStatusLabels(flow: BookingFlow): Record<string, string> {
  if (!flow.artist_acceptance) {
    return {
      suggested: "Offer pending",
      soft_booked: "Hold placed",
      confirmed: "Booked",
      unanswered: "Not booked",
      cancelled: "Cancelled",
    };
  }
  return {
    suggested: "Offer pending",
    soft_booked: "Hold placed",
    confirmed: "Confirmed",
    unanswered: "No offer yet",
    cancelled: "Cancelled",
  };
}

export interface MeterSpec {
  title: string;
  headerSentence: string;
  footer: string;
  filterUnanswered: boolean;
  countStatuses: string[];
}

export function artistMeter(flow: BookingFlow): MeterSpec {
  if (!flow.artist_acceptance) {
    return {
      title: "Booked dates",
      headerSentence: "Your booked share of the dates you're eligible for.",
      footer: "Click to see your dates →",
      filterUnanswered: false,
      countStatuses: ["confirmed"],
    };
  }
  return {
    title: "Response rate",
    headerSentence: "Your response rate on dates you've been offered.",
    footer: "Click to see pending offers →",
    filterUnanswered: true,
    countStatuses: ["confirmed", "soft_booked"],
  };
}

export function deliveryHint(flow: BookingFlow): string {
  return flow.artist_acceptance && flow.offer_delivery === "immediate"
    ? "Offers email artists immediately when a tier opens."
    : "";
}
