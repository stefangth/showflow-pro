import { ROUTES, type AppRole } from "@/config/app.config";
import { DEFAULT_PAGE_ACCESS, type PageAccessConfig } from "@/features/editor/types";

/** The two `related_entity_*` columns every notification-producing edge function
 *  writes (see docs/system-map.md for the writers). Kept as a narrow structural
 *  type rather than importing the full Database row so this stays a pure,
 *  dependency-free module. */
export interface NotificationEntityRef {
  related_entity_type: string | null;
  related_entity_id: string | null;
}

/**
 * The clicking user's role context, just enough to pick a destination that
 * ProtectedRoute (src/features/auth/ProtectedRoute.tsx) will actually let them
 * reach. `roles` are the real (non-view-as) org roles for the active org, same
 * as ProtectedRoute's own role gate — an editor-mode admin's view-as simulation
 * is a UI-only overlay that still bypasses every route gate, so it plays no part
 * here (see AuthContext.roles / hasRole).
 */
export interface NotificationRoleContext {
  roles: AppRole[];
  isSuperAdmin: boolean;
  /**
   * The active org's Editor Mode page-access overrides (`useEditorConfig().pageAccess`),
   * keyed by route path — the same value ProtectedRoute reads. Optional/empty when the
   * caller hasn't wired Editor Mode; the DEFAULT_PAGE_ACCESS registry below still applies.
   */
  pageAccess?: PageAccessConfig;
}

/**
 * Can this caller reach `path` through ProtectedRoute? Mirrors ProtectedRoute's own
 * precedence exactly: an org's Editor Mode override (`pageAccess[path]`) wins over the
 * static `DEFAULT_PAGE_ACCESS` registry, and a super-admin bypasses role gates entirely
 * (god-mode). This is deliberately the SAME registry ProtectedRoute reads rather than a
 * second hardcoded role list, so an org that edits its page access (Settings → the
 * Editor toolbar) can't silently reopen the dead-end/bounce this module exists to
 * prevent. A path with no configured access at all (neither override nor default) is
 * treated as reachable by anyone, matching ProtectedRoute's own fall-through when it has
 * no `requiredRoles` either — not a case any route this module targets currently hits,
 * since /bookings and /settings both carry a DEFAULT_PAGE_ACCESS entry.
 *
 * One deliberate divergence from ProtectedRoute: an admin in Editor Mode bypasses ALL route
 * role gates there (`isEditorMode && isRealAdmin`, checked before the role-gate branch this
 * function mirrors), so such an admin can in fact reach a route this function would say is
 * unreachable for their role. This function has no way to know the clicking session is in
 * Editor Mode (that lives in EditorContext, not the role context passed in here), so it is
 * not mirrored. The only resulting failure mode is a false negative: that admin sees no
 * chevron/deep link on a row they could actually follow, never a bounce off a route
 * ProtectedRoute would reject. That is the same "silence beats a guaranteed bounce"
 * trade-off this module already accepts elsewhere.
 */
function canReachPath(path: string, ctx: NotificationRoleContext): boolean {
  if (ctx.isSuperAdmin) return true;
  const effectiveRoles = ctx.pageAccess?.[path] ?? DEFAULT_PAGE_ACCESS[path];
  if (!effectiveRoles || effectiveRoles.length === 0) return true;
  return effectiveRoles.some((r) => ctx.roles.includes(r));
}

/**
 * The in-app route a notification's related entity should deep-link to when its
 * bell-popover row is clicked, or null when the type is unrecognised, the
 * clicking user's role cannot reach the destination route, or (for hire_order,
 * the one per-record destination among today's types) the id is missing.
 *
 * Booking, show_date, and show_date_offer_tier notifications are written for
 * BOTH producers/admins (cast_escalation_requested, hire_orders_ready) and
 * artists (booking_confirmed, offer_expiring, schedule_change: the two
 * highest-volume artist notification types). /bookings is admin/producer only
 * BY DEFAULT (an org can widen or narrow that through Editor Mode, see
 * canReachPath above), so an ARTIST who cannot reach it falls back through two
 * further routes, each canReachPath-checked in turn:
 *  1. /availability (AvailabilityPage) FIRST, because it renders exactly the
 *     content these notification types refer to: every eligible date's own
 *     booking status (confirmed/soft_booked/suggested), sourced from the same
 *     `bookings` table via its own bookingMap query.
 *  2. /dashboard (ArtistDashboard) second, which shows a response-rate meter
 *     and a pending-offers card but no per-date booking list — a real fallback,
 *     just a less specific one than /availability.
 * A producer or admin who loses /bookings access gets null rather than either
 * artist fallback, since neither renders booking-notification content for
 * them. Each step is reachability-checked, not just role-checked, so an org
 * that ALSO uses Editor Mode to drop "artist" from one or both fallback routes
 * doesn't get pointed at a route ProtectedRoute would just bounce them back out
 * of. An artist who can reach none of the three gets null: silence beats a
 * guaranteed bounce.
 *
 * airtable_sync_log and cron_job/system are similarly gated on the roles that
 * can reach /settings (also override-aware) and /platform (fixed to
 * super-admins, PlatformRoute takes no pageAccess) respectively, even though
 * only admins/producers and super-admins are the actual senders today (see
 * airtable-poll and cron-health-watcher) — the mapping itself should not
 * assume that never changes.
 *
 * hire_order is deliberately NOT entitlement-checked against ROUTE_FEATURES'
 * `hire_orders` gate the way the role-reachability branches above are checked
 * against page access: that would require this pure, role-only module to also
 * carry the current org's entitlement set (a second context shape threaded
 * through NotificationsList), for a route that already degrades gracefully.
 * An org that later disables hire_orders lands a stale notification's click on
 * FeatureDisabledScreen, an explained dead end, not a silent bounce loop.
 * /availability carries the same kind of ROUTE_FEATURES gate (`booking_flow`)
 * for the same reason, and it degrades the same way. The practical exposure is
 * narrower, though: the booking engine that ever creates a booking/show_date/
 * tier notification in the first place is itself gated behind the booking_flow
 * entitlement (see the booking_flow key decision in docs/adr/README.md), so
 * this path is only reachable via a notification that outlived a later
 * disablement of the module, not a routine click.
 */
export function notificationTarget(n: NotificationEntityRef, ctx: NotificationRoleContext): string | null {
  switch (n.related_entity_type) {
    case "booking":
    case "show_date":
    case "show_date_offer_tier":
      if (canReachPath(ROUTES.BOOKINGS, ctx)) return ROUTES.BOOKINGS;
      if (!ctx.roles.includes("artist")) return null;
      if (canReachPath(ROUTES.AVAILABILITY, ctx)) return ROUTES.AVAILABILITY;
      return canReachPath(ROUTES.DASHBOARD, ctx) ? ROUTES.DASHBOARD : null;
    case "hire_order":
      return n.related_entity_id ? ROUTES.HIRE_ORDER_DETAIL.replace(":id", n.related_entity_id) : null;
    case "airtable_sync_log":
      return canReachPath(ROUTES.SETTINGS, ctx) ? `${ROUTES.SETTINGS}?tab=airtable` : null;
    case "cron_job":
    case "system":
      return ctx.isSuperAdmin ? ROUTES.PLATFORM : null;
    default:
      return null;
  }
}
