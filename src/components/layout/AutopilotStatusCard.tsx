import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthContext';
import { useBookingFlow, useFlowTimes } from '@/hooks/useBookingFlow';
import { useFeature } from '@/hooks/useEntitlements';
import { hh, BOOKING_FLOW_DEFAULTS } from '@/lib/bookingFlow';
import { BOOKING_ENGINE_DEFAULTS, ROUTES } from '@/config/app.config';

/**
 * Sidebar "Autopilot" status module — prototype:
 * .superpowers/sdd/2026-08-18-autopilot-today-and-language/prototype.html (the `aside`
 * block; copy is the `autopilot` object in `renderVals()`). Mounted in AppLayout above the
 * user/profile block.
 *
 * Copy is derived from the org's LIVE booking-flow policy (`useBookingFlow`), never the
 * preset name, so it can never assert behavior the org doesn't actually have:
 *  - Hidden outright when the `booking_flow` module is off for this org, or the flow is
 *    paused (`active: false`) — there is no "autopilot" to describe in either case, and
 *    none of the authored copy has a truthful off-state variant.
 *  - The producer/admin body branches on `producer_confirmation`: when the org keeps the
 *    last word, a yes does NOT become a booking on its own (it soft-books and waits on a
 *    producer to confirm), so `sidebar.producer.bodyConfirm` is used instead of the
 *    shipped `sidebar.producer.body`, whose "a yes becomes a booking" line only holds
 *    for auto-confirm orgs.
 */
export function AutopilotStatusCard() {
  const { t } = useTranslation('today');
  const { hasRole, currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const bookingFlowEnabled = useFeature('booking_flow');
  const flowQ = useBookingFlow();
  const timesQ = useFlowTimes(orgId);
  const flow = flowQ.data ?? BOOKING_FLOW_DEFAULTS;
  const offerDigestHour = timesQ.data?.offerDigestHour ?? BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin;

  const isArtistOnly = hasRole('artist') && !hasRole('producer') && !hasRole('admin');

  if (!bookingFlowEnabled || !flow.active) return null;

  const title = isArtistOnly ? t('sidebar.artist.title') : t('sidebar.producer.title');
  const body = isArtistOnly
    ? t('sidebar.artist.body')
    : t(flow.producer_confirmation ? 'sidebar.producer.bodyConfirm' : 'sidebar.producer.body', {
        time: hh(offerDigestHour),
      });
  const link = isArtistOnly ? t('sidebar.artist.link') : t('sidebar.producer.link');
  const to = isArtistOnly ? ROUTES.AVAILABILITY : `${ROUTES.SETTINGS}?tab=booking`;

  return (
    <div className="mx-2 mt-2 rounded-[10px] border border-sidebar-border bg-background/70 px-3 py-2.5 shadow-elev1">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-sm bg-success" aria-hidden="true" />
        <p className="m-0 text-[12px] font-semibold text-foreground">{title}</p>
      </div>
      <p className="m-0 mt-2 text-[11.5px] leading-4 text-muted-foreground">{body}</p>
      <Link to={to} className="mt-2 block text-[12px] font-medium text-accent-text">
        {link}
      </Link>
    </div>
  );
}
