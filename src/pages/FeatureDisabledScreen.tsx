import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { StageMark } from '@/components/brand/StageMark';
import { ROUTES } from '@/config/app.config';
import { FEATURE_REGISTRY, type FeatureKey } from '@/lib/entitlements';

/**
 * Shown by ProtectedRoute when a route is gated behind an entitlement (see
 * ROUTE_FEATURES / requiredFeatureForPath in app.config.ts) that the current
 * org does not have enabled. Mirrors SuspendedOrgScreen's layout.
 */
export default function FeatureDisabledScreen({ feature }: { feature: FeatureKey }) {
  const def = FEATURE_REGISTRY[feature];
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <StageMark variant="tile" size={56} className="mb-6" />
      <h1 className="font-display text-2xl font-semibold tracking-tight">{def.label} is not enabled</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        This module is not part of your organization's plan. Contact your ShowFlow administrator to enable it.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button asChild variant="secondary">
          <Link to={ROUTES.DASHBOARD}>Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
