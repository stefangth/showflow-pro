import { Navigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/AuthContext';
import { useGetRunning } from '@/hooks/useGetRunning';
import { ROUTES } from '@/config/app.config';

/**
 * The authenticated app-entry decider, mounted at ROUTES.HOME ('/').
 *
 * This is the ONLY place that lands a non-artist on the Get running board while
 * their workspace still has open setup tasks. It runs exactly once per app
 * entry — a fresh login (LoginPage / AuthCallbackPage redirect here) or a
 * page open at the app root — and never on in-app navigation, because nothing
 * inside the app links back to '/'. Clicking "Today" goes straight to
 * ROUTES.DASHBOARD, which always renders the Today board and never redirects,
 * so the user can never be bounced off Today onto the board.
 *
 * - Signed out → the login screen.
 * - Artist-only viewer → the dashboard (they have no Get running board).
 * - Non-artist with an incomplete board → Get running (the landing).
 * - Otherwise → the dashboard (Today).
 */
export default function HomeLanding() {
  const { user, loading, hasRole } = useAuth();
  const { model } = useGetRunning();

  if (loading) return <LandingFallback />;
  if (!user) return <Navigate to={ROUTES.LOGIN} replace />;

  const isArtistOnly = hasRole('artist') && !hasRole('producer') && !hasRole('admin');
  if (isArtistOnly) return <Navigate to={ROUTES.DASHBOARD} replace />;

  // Wait for the board model before deciding, so a slow first read can't skip the
  // landing and drop the user on the (still-empty) dashboard. `model` is null only
  // while its reads are in flight.
  if (model === null) return <LandingFallback />;

  if (!model.complete) return <Navigate to={ROUTES.GET_RUNNING} replace />;
  return <Navigate to={ROUTES.DASHBOARD} replace />;
}

function LandingFallback() {
  return (
    <div className="p-6">
      <Skeleton className="h-8 w-64" />
    </div>
  );
}
