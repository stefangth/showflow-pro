import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { StageMark } from '@/components/brand/StageMark';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/config/app.config';
import { FEATURE_REGISTRY, type FeatureKey } from '@/lib/entitlements';

/**
 * Shown by ProtectedRoute when a route is gated behind an entitlement (see
 * ROUTE_FEATURES / requiredFeatureForPath in app.config.ts) that the current
 * org does not have enabled. Mirrors SuspendedOrgScreen's layout.
 *
 * `embedded` swaps the full-viewport `min-h-screen` for `min-h-full` so the
 * screen centers within a constrained parent instead of overflowing it. Used
 * when ProtectedRoute renders this inside AppLayout's `<main>` (which is shorter
 * than the viewport) to keep the editor toolbar reachable for a previewing
 * super-admin; the standalone default is unchanged.
 */
export default function FeatureDisabledScreen({ feature, embedded = false }: { feature: FeatureKey; embedded?: boolean }) {
  const { t } = useTranslation('auth');
  const def = FEATURE_REGISTRY[feature];
  return (
    <div className={cn(
      'flex flex-col items-center justify-center bg-background px-4 text-center',
      embedded ? 'min-h-full' : 'min-h-screen',
    )}>
      <StageMark variant="tile" size={56} className="mb-6" />
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t('featureDisabled.notEnabled', { label: def.label })}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        {t('featureDisabled.body')}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button asChild variant="secondary">
          <Link to={ROUTES.DASHBOARD}>{t('featureDisabled.backToDashboard')}</Link>
        </Button>
      </div>
    </div>
  );
}
