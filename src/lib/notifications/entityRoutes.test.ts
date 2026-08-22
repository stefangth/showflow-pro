import { describe, it, expect } from "vitest";
import { ROUTES } from "@/config/app.config";
import { notificationTarget, type NotificationRoleContext } from "./entityRoutes";

const admin: NotificationRoleContext = { roles: ["admin"], isSuperAdmin: false };
const producer: NotificationRoleContext = { roles: ["producer"], isSuperAdmin: false };
const artist: NotificationRoleContext = { roles: ["artist"], isSuperAdmin: false };
const superAdmin: NotificationRoleContext = { roles: [], isSuperAdmin: true };
const noRoles: NotificationRoleContext = { roles: [], isSuperAdmin: false };

describe("notificationTarget", () => {
  it("routes booking, show_date, and show_date_offer_tier notifications to the bookings page for admins and producers", () => {
    for (const ctx of [admin, producer, superAdmin]) {
      expect(notificationTarget({ related_entity_type: "booking", related_entity_id: "b1" }, ctx)).toBe(ROUTES.BOOKINGS);
      expect(notificationTarget({ related_entity_type: "show_date", related_entity_id: "d1" }, ctx)).toBe(ROUTES.BOOKINGS);
      expect(notificationTarget({ related_entity_type: "show_date_offer_tier", related_entity_id: "t1" }, ctx)).toBe(ROUTES.BOOKINGS);
    }
  });

  // Regression: booking/show_date/show_date_offer_tier notifications are written FOR
  // artists just as often as for producers (booking_confirmed, offer_expiring, the
  // schedule_change digest, the two highest-volume artist notification types). /bookings
  // is admin/producer only, so an artist clicking one used to be silently bounced by
  // ProtectedRoute. They must land on a route their role can actually reach AND that
  // actually shows the thing the notification is about: AvailabilityPage renders each
  // booked date's status (confirmed/soft_booked/suggested) via its own bookingMap query,
  // which is exactly the content a booking/show_date/tier notification refers to.
  // ArtistDashboard, the previous fallback, has no such per-date list (only a response-
  // rate meter and a pending-offers card), so it stays a second-line fallback below.
  it("routes the same notification types to the artist's availability page, never to the admin-only bookings board", () => {
    expect(notificationTarget({ related_entity_type: "booking", related_entity_id: "b1" }, artist)).toBe(ROUTES.AVAILABILITY);
    expect(notificationTarget({ related_entity_type: "show_date", related_entity_id: "d1" }, artist)).toBe(ROUTES.AVAILABILITY);
    expect(notificationTarget({ related_entity_type: "show_date_offer_tier", related_entity_id: "t1" }, artist)).toBe(ROUTES.AVAILABILITY);
  });

  it("returns null for those types when the caller has no booking-relevant role at all", () => {
    expect(notificationTarget({ related_entity_type: "booking", related_entity_id: "b1" }, noRoles)).toBeNull();
  });

  // Deliberately NOT entitlement-checked: /hire-orders/:id is gated by ROUTE_FEATURES'
  // `hire_orders` FeatureKey, but this module stays pure and role-only (see the docstring
  // above notificationTarget). An org that later disables the module makes an old
  // notification's click land on FeatureDisabledScreen, an explained dead end, not the
  // dead-link-or-bounce class of bug this module exists to prevent. Not a gap to close
  // silently: if this ever needs closing, thread entitlements through
  // NotificationRoleContext the same way pageAccess is threaded today.
  it("routes a hire_order notification to its detail page when an id is present, for any role", () => {
    for (const ctx of [admin, producer, artist]) {
      expect(notificationTarget({ related_entity_type: "hire_order", related_entity_id: "ho-1" }, ctx)).toBe(
        "/contracts/ho-1",
      );
    }
  });

  it("returns null for a hire_order notification with no id", () => {
    expect(notificationTarget({ related_entity_type: "hire_order", related_entity_id: null }, admin)).toBeNull();
  });

  it("routes an airtable_sync_log notification to the airtable settings tab for admins and producers only", () => {
    expect(notificationTarget({ related_entity_type: "airtable_sync_log", related_entity_id: null }, admin)).toBe(
      `${ROUTES.SETTINGS}?tab=airtable`,
    );
    expect(notificationTarget({ related_entity_type: "airtable_sync_log", related_entity_id: null }, producer)).toBe(
      `${ROUTES.SETTINGS}?tab=airtable`,
    );
  });

  // Settings is admin/producer only (ProtectedRoute). Nothing sends this notification
  // type to an artist today, but the mapping must not silently bounce one that did.
  it("returns null for an airtable_sync_log notification when the caller cannot reach Settings", () => {
    expect(notificationTarget({ related_entity_type: "airtable_sync_log", related_entity_id: null }, artist)).toBeNull();
  });

  it("routes cron_job and system notifications to the platform console for super-admins only", () => {
    expect(notificationTarget({ related_entity_type: "cron_job", related_entity_id: "j1" }, superAdmin)).toBe(ROUTES.PLATFORM);
    expect(notificationTarget({ related_entity_type: "system", related_entity_id: null }, superAdmin)).toBe(ROUTES.PLATFORM);
  });

  // PlatformRoute bounces any non-super-admin to /dashboard. Only super-admins receive
  // cron_job/system notifications today, but the mapping itself must not assume that
  // stays true forever.
  it("returns null for cron_job and system notifications when the caller is not a super-admin", () => {
    expect(notificationTarget({ related_entity_type: "cron_job", related_entity_id: "j1" }, admin)).toBeNull();
    expect(notificationTarget({ related_entity_type: "system", related_entity_id: null }, artist)).toBeNull();
  });

  it("returns null for an unrecognised or missing entity type", () => {
    expect(notificationTarget({ related_entity_type: "something_else", related_entity_id: "x" }, admin)).toBeNull();
    expect(notificationTarget({ related_entity_type: null, related_entity_id: null }, admin)).toBeNull();
  });

  // Regression: reachability must come from the SAME registry ProtectedRoute reads
  // (DEFAULT_PAGE_ACCESS, overridable per org via Editor Mode's `pageAccess`), not a
  // second hardcoded admin|producer list. Otherwise an org that edits its page access
  // reintroduces exactly the dead-end/bounce this module exists to prevent.
  describe("per-org Editor Mode page-access overrides", () => {
    it("stops routing a producer to bookings once the org's Editor Mode removes producer access", () => {
      const overridden: NotificationRoleContext = {
        roles: ["producer"], isSuperAdmin: false, pageAccess: { "/dates": ["admin"] },
      };
      expect(notificationTarget({ related_entity_type: "booking", related_entity_id: "b1" }, overridden)).toBeNull();
    });

    it("routes an artist to bookings once the org's Editor Mode grants artist access", () => {
      const overridden: NotificationRoleContext = {
        roles: ["artist"], isSuperAdmin: false, pageAccess: { "/dates": ["admin", "producer", "artist"] },
      };
      expect(notificationTarget({ related_entity_type: "booking", related_entity_id: "b1" }, overridden)).toBe(ROUTES.BOOKINGS);
    });

    it("applies the same override to the airtable settings deep link", () => {
      const granted: NotificationRoleContext = {
        roles: ["artist"], isSuperAdmin: false, pageAccess: { "/settings": ["admin", "producer", "artist"] },
      };
      expect(notificationTarget({ related_entity_type: "airtable_sync_log", related_entity_id: null }, granted)).toBe(
        `${ROUTES.SETTINGS}?tab=airtable`,
      );

      const revoked: NotificationRoleContext = {
        roles: ["producer"], isSuperAdmin: false, pageAccess: { "/settings": ["admin"] },
      };
      expect(notificationTarget({ related_entity_type: "airtable_sync_log", related_entity_id: null }, revoked)).toBeNull();
    });

    it("still reaches bookings and settings as a super-admin regardless of any override, like ProtectedRoute's god-mode bypass", () => {
      const restricted: NotificationRoleContext = {
        roles: [], isSuperAdmin: true, pageAccess: { "/dates": ["admin"], "/settings": ["admin"] },
      };
      expect(notificationTarget({ related_entity_type: "booking", related_entity_id: "b1" }, restricted)).toBe(ROUTES.BOOKINGS);
      expect(notificationTarget({ related_entity_type: "airtable_sync_log", related_entity_id: null }, restricted)).toBe(
        `${ROUTES.SETTINGS}?tab=airtable`,
      );
    });

    it("falls back to DEFAULT_PAGE_ACCESS when no override is present for the path", () => {
      const noOverride: NotificationRoleContext = { roles: ["producer"], isSuperAdmin: false, pageAccess: {} };
      expect(notificationTarget({ related_entity_type: "booking", related_entity_id: "b1" }, noOverride)).toBe(ROUTES.BOOKINGS);
    });

    // Regression: the artist fallback used to be a second hardcoded role check
    // (`ctx.roles.includes("artist") ? ROUTES.DASHBOARD : null`) instead of going through
    // canReachPath like every other branch. An org that uses Editor Mode to drop "artist"
    // from a fallback route would still get pointed there, and ProtectedRoute would bounce
    // them right back to the very page the notification tried to open (an infinite-feeling
    // dead end). Each fallback step must be reachability-checked the same as /bookings
    // itself.
    it("falls through to the dashboard once the org's Editor Mode removes this role's availability access", () => {
      const noAvailability: NotificationRoleContext = {
        roles: ["artist"], isSuperAdmin: false, pageAccess: { "/availability": ["admin", "producer"] },
      };
      expect(notificationTarget({ related_entity_type: "booking", related_entity_id: "b1" }, noAvailability)).toBe(ROUTES.DASHBOARD);
    });

    it("returns null once the org's Editor Mode removes both the availability and dashboard fallbacks", () => {
      const neitherFallback: NotificationRoleContext = {
        roles: ["artist"], isSuperAdmin: false,
        pageAccess: { "/availability": ["admin", "producer"], "/today": ["admin", "producer"] },
      };
      expect(notificationTarget({ related_entity_type: "booking", related_entity_id: "b1" }, neitherFallback)).toBeNull();
    });
  });
});
