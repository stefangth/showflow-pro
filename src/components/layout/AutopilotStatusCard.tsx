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
 *    paused (`active: false`).
 *  - Shown only for Autopilot behavior — asks go out AND a yes books on its own:
 *    `artist_acceptance && !producer_confirmation`. That is precisely what the card
 *    copy asserts ("Asks go out. A yes becomes a booking."), and it distinguishes
 *    Autopilot from Classic (a yes waits on a producer -> producer_confirmation) and
 *    Direct book (no asks -> !artist_acceptance). Gating on the behavior rather than
 *    the registry preset keeps it correct even when the org's Autopilot flow comes
 *    from a platform template a super-admin has customized (so it no longer equals
 *    the hard-coded fasttrack preset field-for-field).
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

  // Only Autopilot behavior may show this card: asks go out and a yes books on its
  // own. This excludes Classic (a yes waits) and Direct book (no asks), and stays
  // correct when the org's Autopilot flow came from a customized platform template.
  const isAutopilot = flow.artist_acceptance && !flow.producer_confirmation;
  if (!bookingFlowEnabled || !flow.active || !isAutopilot) return null;

  const title = isArtistOnly ? t('sidebar.artist.title') : t('sidebar.producer.title');
  // Shown only when !producer_confirmation, so the producer body is always the
  // auto-confirm variant ("a yes becomes a booking").
  const body = isArtistOnly
    ? t('sidebar.artist.body')
    : t('sidebar.producer.body', { time: hh(offerDigestHour) });
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
