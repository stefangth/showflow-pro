import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, KeyRound, Mail } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { acceptInvitation, exchangeInvitation, InvitationExchangeError } from '@/data/invitations';
import { captureInvitationToken, clearInvitationToken } from '@/features/auth/invitationToken';
import { ROUTES, roleLabel, roleDescription, type AppRole } from '@/config/app.config';
import { rolesForOrg } from '@/features/auth/orgRoles';
import type { Membership } from '@/data/orgs';
import { useBookingFlow } from '@/hooks/useBookingFlow';
import { useFeature, useEntitlements } from '@/hooks/useEntitlements';
import { useGetRunning } from '@/hooks/useGetRunning';
import type { BookingFlow } from '@/lib/bookingFlow';
import { firstOfferBlockingCount, getRunningState, MINUTES_PER_TASK, type GetRunningModel, type GetRunningState } from '@/lib/getRunning/tasks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { StageMark } from '@/components/brand/StageMark';
import { usePasswordStatus } from '@/hooks/usePasswordStatus';
import { PasswordSetupForm } from '@/components/auth/PasswordSetupForm';

interface AcceptInviteError {
  /** Translation key (in the `auth` namespace) for the error copy, resolved with `t` at
   *  render. Kept as a key rather than resolved copy so this helper can stay module-level. */
  key: string;
  /** Interpolation values for `key` (e.g. the signed-in email). */
  values?: Record<string, string>;
  /** The wrong-email mismatch is the only error with a real in-page remedy: sign out and
   *  land back on this same accept-invite URL, ready to sign in with the invited address.
   *  Every other error (expired, invalid, unauthenticated, unknown) has no such remedy, so
   *  their action is null and the card offers only "Go to dashboard". */
  action: 'switch-account' | null;
}

/**
 * The invitation is scoped to an email, but the `accept_invitation` RPC error never
 * carries the invited address back to the client (see the SQL: "Invitation was issued
 * to a different email"). The signed-in email is the only account identifier this page
 * can truthfully surface, so it is threaded through here rather than left implicit.
 */
function friendlyAcceptError(message: string, signedInEmail?: string | null): AcceptInviteError {
  const m = message.toLowerCase();
  if (m.includes('different email')) {
    return signedInEmail
      ? {
          key: 'acceptInvite.errors.differentEmailSignedIn',
          values: { email: signedInEmail },
          action: 'switch-account',
        }
      : {
          key: 'acceptInvite.errors.differentEmail',
          action: null,
        };
  }
  if (m.includes('expired') || m.includes('invalid')) {
    return {
      key: 'acceptInvite.errors.expired',
      action: null,
    };
  }
  if (m.includes('not authenticated')) {
    return { key: 'acceptInvite.errors.notAuthenticated', action: null };
  }
  return { key: 'acceptInvite.errors.generic', action: null };
}

// A member can hold more than one role in the same org (Admin > People "Roles" editor),
// and fetchMyMemberships returns rows unordered, so picking memberships[0] would show
// an arbitrary role. Same precedence order used across the app for a "primary" role
// (see EditorContext.tsx's roles.includes('admin') ? ... chain).
const ROLE_PRECEDENCE: AppRole[] = ['admin', 'producer', 'artist'];

function primaryRoleForOrg(memberships: Membership[], orgId: string): AppRole | null {
  const roles = rolesForOrg(memberships, orgId);
  return ROLE_PRECEDENCE.find((r) => roles.includes(r)) ?? null;
}

/**
 * What to expect right after landing on the dashboard, by role AND by the joined org's
 * booking flow. A single flattened line per role ("Your dashboard shows what happens
 * next") made no claim at all: on an org that runs an ask pipeline it read as filler
 * beside "Go to dashboard", one line below "Asks arrive by email and land on this
 * page." on that same dashboard's own first-run rail (firstRun.ts's welcomeCopy, which
 * branches this exact distinction on ctx.artistAcceptance for the same reason).
 *
 * `offers` = the booking_flow module is entitled, the org's flow preset is active, and
 * artist_acceptance is on (the org sends asks). `direct` = entitled and active
 * but artist_acceptance is off (bookings go straight to soft_booked, no ask step).
 * `off` = the module is not entitled for this org, OR its flow preset is paused, OR the
 * flow has not loaded yet. Deliberately the safe fallback in all three cases: it names
 * no pipeline, so it can never assert something this org does not do.
 */
export type BookingRunState = 'offers' | 'direct' | 'off';

/** Pure so the branch can be unit tested directly, without mounting the two queries
 *  behind it (useFeature('booking_flow') + useBookingFlow(joined.orgId)). */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveBookingRunState(
  moduleOn: boolean,
  flow: Pick<BookingFlow, 'active' | 'artist_acceptance'> | undefined,
): BookingRunState {
  if (!moduleOn || !flow || !flow.active) return 'off';
  return flow.artist_acceptance ? 'offers' : 'direct';
}

export type HandoffPrimary = 'board' | 'availability' | 'dashboard';

/** Where the success card's primary CTA points, and which summary it shows. Artists have
 *  no Get running board (screen 08), so they go straight to Availability. An admin/producer
 *  whose org has at least one module on gets the board; with no module on there is nothing
 *  to set up, so they fall back to the dashboard. */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveHandoffPrimary(role: AppRole | null, boardHasTasks: boolean): HandoffPrimary {
  if (role === 'artist') return 'availability';
  if (boardHasTasks) return 'board';
  return 'dashboard';
}

export type BoardHandoffState = GetRunningState;

/** The board-summary state, delegating to the shared `getRunningState` so the handoff and
 *  the board it leads to derive their state from one source and can never disagree. */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveBoardHandoffState(model: GetRunningModel): BoardHandoffState {
  return getRunningState(model);
}

// Plain data record, not a component; exported so tests can sweep every role/state line
// directly for dash-free copy.
// eslint-disable-next-line react-refresh/only-export-components
export const NEXT_STEP_LINES: Record<AppRole, Record<BookingRunState, string>> = {
  admin: {
    offers: 'Your dashboard has a short setup list that gets your first asks out.',
    direct: 'Your dashboard has a short setup list that gets your first date booked.',
    off: 'Your dashboard shows what this workspace needs from you next.',
  },
  producer: {
    // Reached only for a nothing-on org (bookingState 'off'); the offers/direct entries
    // stay as data so resolveNextStepLine remains a total resolver, but an org with the
    // booking module on now shows the board summary instead of any producer line.
    offers: 'Dates and asks land on your dashboard, and confirmations are handled by an admin.',
    direct: 'Bookings waiting on your confirmation land on your dashboard.',
    off: 'Your dashboard shows what is waiting on you.',
  },
  artist: {
    offers: 'Asks arrive by email and land on your dashboard.',
    direct: 'Your producer books you directly, and confirmed dates land on your dashboard.',
    off: 'Your dashboard shows what is next for you.',
  },
};

/**
 * Shown for an artist whose invitation could not link a catalog artist row (an admin
 * relinks it later -- see the alert this line sits below). Offers and direct bookings
 * are both `bookings` rows keyed on `artist_id`, so neither NEXT_STEP_LINES.artist.offers
 * nor .direct can come true for this account until that link exists; this line replaces
 * both, regardless of the org's booking state, rather than asserting a claim the account
 * cannot yet act on.
 */
export const ARTIST_NOT_LINKED_NEXT_STEP_LINE =
  'Once an admin links your artist profile, asks and bookings will start landing on your dashboard.';

/**
 * The one next-step sentence for the non-board path: artists (all booking states), and
 * admin/producer only at a nothing-on org (both modules off -> bookingState 'off'). The
 * board summary replaces this for any admin/producer whose org has a module on.
 *
 * 1. `!artistLinked` (artist only): no `artists` row exists yet, so neither the offers nor
 *    the direct-booking promise can come true -- see ARTIST_NOT_LINKED_NEXT_STEP_LINE.
 * 2. Otherwise the plain NEXT_STEP_LINES entry for the role and booking state.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveNextStepLine(
  role: AppRole,
  bookingState: BookingRunState,
  artistLinked = true,
): string {
  if (role === 'artist' && !artistLinked) return ARTIST_NOT_LINKED_NEXT_STEP_LINE;
  return NEXT_STEP_LINES[role][bookingState];
}

interface JoinedState {
  orgId: string;
  artistLinked: boolean;
  /** The signed-in user id at the moment this invite was accepted. `orgs`/`memberships`
   *  come live from AuthContext and can change under a mounted card (cross-tab
   *  sign-out/sign-in, dev autologin re-signing-in as another account); comparing the
   *  CURRENT `user?.id` against this captured value is what lets the render below detect
   *  that and stop asserting facts (org name, role) that were only ever true for the
   *  person who actually accepted. */
  userId: string;
}

function PostAcceptanceHandoff({
  primaryLabel,
  primaryIsDeadEnd,
  onPrimary,
}: {
  primaryLabel: string;
  primaryIsDeadEnd: boolean;
  onPrimary: () => void;
}) {
  const { t } = useTranslation('auth');
  const passwordStatus = usePasswordStatus();
  const [showSetup, setShowSetup] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const setupContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSetup) return;
    const heading = setupContainerRef.current?.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }, [showSetup]);

  if (setupComplete) {
    return (
      <>
        <p role="status" className="text-sm font-medium text-foreground">
          {t('acceptInvite.handoff.passwordReady')}
        </p>
        <Button variant={primaryIsDeadEnd ? 'outline' : 'default'} onClick={onPrimary}>
          {primaryLabel}
        </Button>
      </>
    );
  }

  if (passwordStatus.isLoading) {
    return <Skeleton aria-label={t('acceptInvite.handoff.checkingMethods')} className="mx-auto h-11 w-full" />;
  }

  if (passwordStatus.isError) {
    return (
      <>
        <p role="status" className="text-sm text-muted-foreground">
          {t('acceptInvite.handoff.manageFromProfile')}
        </p>
        <Button variant={primaryIsDeadEnd ? 'outline' : 'default'} onClick={onPrimary}>
          {primaryLabel}
        </Button>
      </>
    );
  }

  if (passwordStatus.data) {
    return (
      <>
        <Button variant={primaryIsDeadEnd ? 'outline' : 'default'} onClick={onPrimary}>
          {primaryLabel}
        </Button>
      </>
    );
  }

  return (
    <>
      {!showSetup && (
        <div data-testid="sign-in-choices" className="space-y-3 text-left">
          <p className="text-center text-sm font-medium text-foreground">
            {t('acceptInvite.handoff.howSignIn')}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              aria-pressed="false"
              className="min-h-11 h-auto justify-start whitespace-normal px-3 py-3 text-left transition-colors motion-reduce:transition-none focus-visible:ring-2"
              onClick={() => setShowSetup(true)}
            >
              <KeyRound aria-hidden="true" className="shrink-0" />
              <span><span className="block">{t('acceptInvite.handoff.createPassword')}</span><span className="block text-xs font-normal text-muted-foreground">{t('acceptInvite.handoff.createPasswordCaption')}</span></span>
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-pressed="false"
              className="min-h-11 h-auto justify-start whitespace-normal px-3 py-3 text-left transition-colors motion-reduce:transition-none focus-visible:ring-2"
              onClick={onPrimary}
            >
              <Mail aria-hidden="true" className="shrink-0" />
              <span><span className="block">{t('acceptInvite.handoff.continueMagic')}</span><span className="block text-xs font-normal text-muted-foreground">{t('acceptInvite.handoff.continueMagicCaption')}</span></span>
            </Button>
          </div>
        </div>
      )}
      {showSetup && (
        <div
          ref={setupContainerRef}
          aria-live="polite"
          className="animate-in fade-in-0 duration-200 motion-reduce:animate-none text-left"
        >
          <PasswordSetupForm
            mode="setup"
            onSuccess={() => { setSetupComplete(true); setShowSetup(false); }}
            onCancel={() => setShowSetup(false)}
          />
        </div>
      )}
    </>
  );
}

/**
 * Public route. Accepts an org invitation by token. If the visitor is not signed
 * in, it bounces to /login and returns here afterward; once authenticated it calls
 * accept_invitation, refreshes the signed-in user's org memberships, switches to the
 * new org, and renders a success card that says what they joined and what to do next.
 * It no longer auto-navigates to the dashboard: membership already exists by the time
 * this page runs, so there is nothing time-sensitive left to do, and an instant redirect
 * gave the invitee no chance to register what they just joined or what their role means.
 *
 * refreshOrgs runs before switchOrg because AuthContext's memberships/orgs were loaded
 * before this page ran and do not include the membership accept_invitation just created;
 * without the refetch the card would degrade to a heading and a button (no role line, no
 * next-step line) and the org switch would silently no-op (currentOrg falls back to
 * orgs[0] when the target id is not in the list).
 */
export default function AcceptInvitePage() {
  const routeLocation = useLocation();
  const [token] = useState(() => captureInvitationToken(
    {
      href: `${window.location.origin}${routeLocation.pathname}${routeLocation.search}${routeLocation.hash}`,
      pathname: routeLocation.pathname,
      search: routeLocation.search,
      hash: routeLocation.hash,
    },
    window.history,
    window.sessionStorage,
  ));
  const { user, loading, orgs, memberships, switchOrg, refreshOrgs, signOut } = useAuth();
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [error, setError] = useState<AcceptInviteError | null>(null);
  const [joined, setJoined] = useState<JoinedState | null>(null);
  const [exchangePending, setExchangePending] = useState(false);
  const [exchangeError, setExchangeError] = useState<'throttled' | 'unavailable' | 'unknown' | null>(null);
  const ran = useRef(false);

  // Hooks run unconditionally (before the `if (joined)` return below), keyed on
  // joined?.orgId so they resolve the org actually joined rather than whatever org the
  // shell had open before. useFeature('booking_flow') has no org-override param and
  // reads useAuth().currentOrg directly, which is safe here because switchOrg(orgId)
  // above already ran by the time `joined` is set (same .then callback, batched with
  // setJoined into one render) -- see resolveBookingRunState's doc comment.
  //
  // `role` is resolved here, before the hooks below, purely so it can gate them -- the
  // render-time recomputation inside `if (joined)` was removed; this is now the single
  // source. It is a plain derived value, not a hook, so computing it above other hooks
  // does not disturb hook-call order.
  const role = joined ? primaryRoleForOrg(memberships, joined.orgId) : null;

  // useEntitlements() reads the exact same `['entitlements', currentOrg?.id]` query
  // useFeature('booking_flow') below already subscribes to (react-query dedupes the
  // network fetch on that shared key), called again here purely because useFeature does
  // not expose isLoading. bookingModuleOn fails OPEN to the registry default while this is
  // loading (see useFeature's own doc comment), so `entitlementsLoading` lets the artist
  // next-step line wait for a real answer instead of trusting that default -- otherwise a
  // module-off org could briefly render the offers/direct line before swapping to the
  // correct 'off' state once the real entitlement lands.
  const { isLoading: entitlementsLoading } = useEntitlements();
  // useBookingFlow(joined?.orgId ?? null) is called unconditionally too; the shared hook
  // gates itself off for a null org (enabled: orgId !== null), so no `app_settings` read
  // fires on first mount or on the unauthenticated bounce-to-login path. A disabled query
  // reports isLoading false, so the artist next-step gate is not held up before `joined`
  // exists; the moment it is set the query starts and the readiness gate takes over.
  const bookingModuleOn = useFeature('booking_flow');
  const { data: bookingFlow, isLoading: bookingFlowLoading } = useBookingFlow(joined?.orgId ?? null);
  // The Get running board model, for the admin/producer handoff summary. useGetRunning reads
  // useAuth().currentOrg internally, which is already the joined org by the time `joined` is
  // set (switchOrg ran in the same batched `.then`, same reasoning as useFeature above). It
  // gates its own reads off for a non-admin/non-producer viewer and for a null org, so before
  // `joined` exists a fresh invitee fires no board reads; a multi-org accepter may trigger one
  // harmless cache-warming read for their prior org.
  const getRunning = useGetRunning();

  useEffect(() => {
    if (loading) return;
    if (!token) {
      setError({ key: 'acceptInvite.errors.missingToken', action: null });
      return;
    }
    if (!user) return;
    if (ran.current) return;
    ran.current = true;
    const acceptingUserId = user.id;
    acceptInvitation(supabase, token)
      .then(async ({ orgId, artistLinked }) => {
        await refreshOrgs();
        switchOrg(orgId);
        clearInvitationToken(window.sessionStorage);
        setJoined({ orgId, artistLinked, userId: acceptingUserId });
      })
      .catch((e: unknown) => {
        setError(friendlyAcceptError((e as Error)?.message ?? '', user?.email));
      });
  }, [loading, user, token, navigate, switchOrg, refreshOrgs]);

  // The only in-page remedy any error state has: sign out, then bounce through /login the
  // same way an unauthenticated visit does, so the invitee lands back on this exact URL
  // once they sign in with the invited address. Only reachable when action is
  // 'switch-account', which friendlyAcceptError only ever sets alongside a truthy token.
  const handleSwitchAccount = async () => {
    await signOut();
    const back = ROUTES.ACCEPT_INVITE;
    navigate(`${ROUTES.LOGIN}?redirect=${encodeURIComponent(back)}`, { replace: true });
  };

  const handleExchange = async () => {
    if (!token || exchangePending) return;
    setExchangePending(true);
    setExchangeError(null);
    try {
      const { actionUrl } = await exchangeInvitation(supabase, { token, appOrigin: window.location.origin });
      window.location.assign(actionUrl);
    } catch (error) {
      const kind = error instanceof InvitationExchangeError ? error.kind : 'unknown';
      if (kind === 'unavailable') clearInvitationToken(window.sessionStorage);
      setExchangeError(kind);
    } finally {
      setExchangePending(false);
    }
  };

  if (!loading && !user && token) {
    const retryable = exchangeError === 'throttled' || exchangeError === 'unknown';
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto"><StageMark variant="tile" size={52} /></div>
            <CardTitle className="font-display text-2xl font-semibold tracking-tight">{t('acceptInvite.unauth.title')}</CardTitle>
            <CardDescription>{t('acceptInvite.unauth.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            {exchangeError === 'unavailable' && <p className="text-sm text-muted-foreground">{t('acceptInvite.unauth.unavailable')}</p>}
            {exchangeError === 'throttled' && <p className="text-sm text-muted-foreground">{t('acceptInvite.unauth.throttled')}</p>}
            {exchangeError === 'unknown' && <p className="text-sm text-muted-foreground">{t('acceptInvite.unauth.unknown')}</p>}
            {exchangeError !== 'unavailable' && (
              <Button className="w-full" disabled={exchangePending} onClick={handleExchange}>
                {exchangePending ? t('acceptInvite.unauth.continuing') : retryable ? t('acceptInvite.unauth.tryAgain') : t('acceptInvite.unauth.continue')}
              </Button>
            )}
            {exchangeError === 'unavailable' && (
              <Button className="w-full" variant="outline" onClick={() => navigate(ROUTES.LOGIN, { replace: true })}>
                {t('acceptInvite.unauth.goToSignIn')}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (joined) {
    // orgs/memberships/user come live from AuthContext and can change under this mounted
    // card (cross-tab sign-out/sign-in, dev autologin re-signing-in as another account).
    // If the signed-in id no longer matches who actually accepted this invite, none of
    // the org/role facts below can be trusted for the person now reading the screen --
    // render a neutral card instead of silently swapping to whatever the new session
    // resolves to. See JoinedState.userId.
    if (user?.id !== joined.userId) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center space-y-3">
              <div className="mx-auto"><StageMark variant="tile" size={52} /></div>
              <CardTitle className="font-display text-2xl font-semibold tracking-tight">
                {t('acceptInvite.differentAccount.title')}
              </CardTitle>
              <CardDescription>
                {user?.email
                  ? t('acceptInvite.differentAccount.descriptionEmail', { email: user.email })
                  : t('acceptInvite.differentAccount.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <Button onClick={() => navigate(ROUTES.DASHBOARD, { replace: true })}>{t('acceptInvite.goToDashboard')}</Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    // orgs/memberships resolutions degrade gracefully (org name falls back to a generic
    // phrase, role block is omitted) in case refreshOrgs came back short. `role` itself is
    // resolved above, before this component's hooks, so it can gate them.
    const orgName = orgs.find((o) => o.id === joined.orgId)?.name ?? t('acceptInvite.success.orgFallback');
    const bookingState = resolveBookingRunState(bookingModuleOn, bookingFlow);
    const boardRole = role === 'admin' || role === 'producer';
    // A board-role stays on the board path unless the board has loaded and turned out empty
    // (a nothing-on org). While it is still loading we keep the board path so the summary
    // region shows a skeleton rather than a dashboard line that then swaps once tasks land.
    const boardKnownEmpty =
      boardRole && !getRunning.isLoading && (!getRunning.model || getRunning.model.totalCount === 0);
    const boardHasTasks = boardRole && !boardKnownEmpty;
    const primary = resolveHandoffPrimary(role, boardHasTasks);
    const boardState = getRunning.model ? resolveBoardHandoffState(getRunning.model) : 'blocking';
    const blockingCount = getRunning.model ? firstOfferBlockingCount(getRunning.model) : 0;
    // The artist's availability target is a dead end while their profile is unlinked (it can
    // only say an admin still has to link it), matching the prior dashboard-dead-end demotion.
    const primaryIsDeadEnd = role === 'artist' && !joined.artistLinked;
    const primaryCta = {
      board: { label: t('acceptInvite.board.open'), route: ROUTES.GET_RUNNING },
      availability: { label: t('acceptInvite.goToAvailability'), route: ROUTES.AVAILABILITY },
      dashboard: { label: t('acceptInvite.goToDashboard'), route: ROUTES.DASHBOARD },
    }[primary];

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto"><StageMark variant="tile" size={52} /></div>
            <div aria-label={t('acceptInvite.success.invitationAccepted')} className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
            </div>
            <CardTitle className="font-display text-2xl font-semibold tracking-tight">
              {t('acceptInvite.success.joined', { orgName })}
            </CardTitle>
            {user?.email && (
              // Names the account this happened to, so the reader can confirm they are
              // looking at the join they expect (and, on a shared device, which one).
              <CardDescription>{t('acceptInvite.success.signedInAs', { email: user.email })}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4 text-center" data-testid="accept-invite-success">
            {role && (
              // Role name and description sit in their own block rather than continuing a
              // "You joined as X." sentence: ROLE_DESCRIPTIONS is a third-person,
              // subjectless clause (its own doc comment: "cannot grammatically continue
              // into" a second-person sentence), so pasting it straight after "You joined
              // as Artist." read like "You joined as Artist. Gets booked for shows...",
              // a fragment missing its subject. A label-plus-caption pairing (the same
              // shape PersonRow uses for the same registry) needs no shared subject.
              <div className="rounded-control border border-border bg-well-tint p-3 text-left space-y-1">
                <p className="text-sm font-medium text-foreground">{t('acceptInvite.success.yourRole', { role: roleLabel(role) })}</p>
                <p className="text-sm text-muted-foreground">{roleDescription(role)}</p>
              </div>
            )}
            {!joined.artistLinked && (
              // Ordered above the next-step line, not below it: this is the consequence
              // the invitee may need to act on, so it outranks the (now artist-linking-
              // aware) line beneath it rather than following a claim it then contradicts.
              <Alert className="text-left">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--amber-600)]" />
                <AlertDescription>
                  {t('acceptInvite.success.artistLinkFailed')}
                </AlertDescription>
              </Alert>
            )}
            {primary === 'board' ? (
              getRunning.model && !getRunning.isLoading ? (
                <div className="space-y-1 text-center" data-testid="board-handoff-summary">
                  <p className="text-sm font-medium text-foreground">
                    {boardState === 'blocking'
                      ? t('acceptInvite.board.blocking', { count: blockingCount })
                      : t(`acceptInvite.board.${boardState}`)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {boardState === 'blocking'
                      ? t('acceptInvite.board.blockingSub', { minutes: blockingCount * MINUTES_PER_TASK })
                      : t(`acceptInvite.board.${boardState}Sub`)}
                  </p>
                </div>
              ) : (
                <Skeleton data-testid="board-summary-loading" className="mx-auto h-8 w-3/4" />
              )
            ) : role ? (
              !entitlementsLoading && !bookingFlowLoading ? (
                <p className="text-sm text-muted-foreground">
                  {resolveNextStepLine(role, bookingState, joined.artistLinked)}
                </p>
              ) : (
                // Placeholder for the line above, shown only until the booking-flow and
                // entitlement queries have settled -- see the artist next-step gate for why
                // this must not render NEXT_STEP_LINES against still-loading data.
                <Skeleton data-testid="next-step-line-loading" className="mx-auto h-4 w-3/4" />
              )
            ) : null}
            <PostAcceptanceHandoff
              primaryLabel={primaryCta.label}
              primaryIsDeadEnd={primaryIsDeadEnd}
              onPrimary={() => navigate(primaryCta.route, { replace: true })}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto"><StageMark variant="tile" size={52} /></div>
          <CardTitle className="font-display text-2xl font-semibold tracking-tight">{t('acceptInvite.pending.title')}</CardTitle>
          <CardDescription>
            {error ? t('acceptInvite.pending.errorDescription') : t('acceptInvite.pending.joiningDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {error ? (
            <>
              <p className="text-sm text-muted-foreground">{t(error.key, error.values)}</p>
              <div className="flex flex-col gap-2">
                {error.action === 'switch-account' && (
                  // The one actionable remedy this card can offer: the message above names
                  // the fix ("sign in with that one"), this button does it. Default
                  // (primary) variant, not outline: it is the remedy, so it should not
                  // carry the same visual weight as the passive "Go to dashboard" escape
                  // below, matching the success card's single primary action.
                  <Button onClick={handleSwitchAccount}>
                    {t('acceptInvite.pending.signOutUseAnother')}
                  </Button>
                )}
                <Button variant="outline" onClick={() => navigate(ROUTES.DASHBOARD, { replace: true })}>
                  {t('acceptInvite.goToDashboard')}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex justify-center py-4">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
