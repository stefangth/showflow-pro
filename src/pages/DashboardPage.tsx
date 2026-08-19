import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { useGetRunning } from '@/hooks/useGetRunning';
import { hasLandedGetRunning, markLandedGetRunning } from '@/lib/getRunning/landing';
import { ROUTES } from '@/config/app.config';
import { ArtistDashboard } from '@/components/dashboard/ArtistDashboard';
import TodayContainer from '@/components/today/TodayPage';

export default function DashboardPage() {
  const { hasRole, currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const isArtistOnly = hasRole('artist') && !hasRole('producer') && !hasRole('admin');
  // Onboarding gate: on the FIRST dashboard visit of a session, while the Get running board
  // still has open tasks, a non-artist lands on the board instead of the (still-empty)
  // dashboard — the board is the priority until the workspace is set up. This is a one-time
  // post-login landing, NOT a persistent guard: once it has fired we mark it consumed
  // (session-scoped, see lib/getRunning/landing.ts), so any later navigation to the
  // dashboard renders it normally and can never be trapped back on the board. The redirect
  // also never fires once `model.complete` flips true (a fully-set-up org, or a nothing-on
  // org whose empty task set is trivially complete).
  // `useGetRunning` is called unconditionally (rules of hooks) and reuses the exact reads
  // the sidebar's nav-visibility hook already issued, so this is a cache hit. Only redirect
  // once we positively know the board is incomplete: while `model` is null (loading) the
  // dashboard renders rather than being gated behind these reads.
  const { model } = useGetRunning();
  // Reading the flag during render is pure; the WRITE is deferred to the effect below so a
  // render React discards (StrictMode double-invoke, an interrupted concurrent render, or a
  // future Suspense boundary on this route) can't consume the one-time landing without the
  // <Navigate> actually committing. The effect runs only on a committed render, coupling the
  // mark to the redirect. shouldLand is recomputed each render, so it self-corrects.
  const shouldLandOnGetRunning =
    !isArtistOnly && !!orgId && !!model && !model.complete && !hasLandedGetRunning(orgId);
  useEffect(() => {
    if (shouldLandOnGetRunning && orgId) markLandedGetRunning(orgId);
  }, [shouldLandOnGetRunning, orgId]);
  if (isArtistOnly) {
    return <ArtistDashboard />;
  }
  if (shouldLandOnGetRunning) {
    return <Navigate to={ROUTES.GET_RUNNING} replace />;
  }
  return <TodayContainer />;
}
