import { useAuth } from '@/features/auth/AuthContext';
import { ArtistDashboard } from '@/components/dashboard/ArtistDashboard';
import TodayContainer from '@/components/today/TodayPage';

/**
 * The /dashboard route. It ALWAYS renders (artists get their dashboard, everyone
 * else gets the Autopilot Today board) and never redirects — clicking "Today"
 * can never bounce the user off it. The one-time Get running landing decision
 * lives at the app entry point instead (see features/auth/HomeLanding.tsx), so
 * it only fires on login or a page open at the app root.
 */
export default function DashboardPage() {
  const { hasRole } = useAuth();
  const isArtistOnly = hasRole('artist') && !hasRole('producer') && !hasRole('admin');
  return isArtistOnly ? <ArtistDashboard /> : <TodayContainer />;
}
