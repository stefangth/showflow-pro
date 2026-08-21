import { useAuth } from '@/features/auth/AuthContext';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { StageMark } from '@/components/brand/StageMark';
import { APP_META } from '@/config/app.config';

/**
 * The contact-line paragraph, isolated from SuspendedOrgScreen so both branches
 * (an address configured, or not) are directly testable without depending on
 * APP_META's current value. SuspendedOrgScreen always renders it with
 * APP_META.SUPPORT_EMAIL; only tests pass anything else.
 *
 * The prefix is an authored string and the trailing period is a literal in JSX, so the
 * link is placed at a fixed authoring-time seam rather than by searching the composed
 * sentence for the address's own value. APP_META.SUPPORT_EMAIL ships null today (setting
 * a real address is an owner decision), so the line is dark in production.
 */
export function SupportContactLine({ email }: { email: string | null }) {
  const { t } = useTranslation('auth');
  if (!email) return null;
  return (
    <p className="mt-1 max-w-md text-sm text-muted-foreground">
      {t('suspended.contactLinePrefix')}
      <a href={`mailto:${email}`} className="underline hover:text-foreground">
        {email}
      </a>
      .
    </p>
  );
}

/**
 * Shown by ProtectedRoute when the active organization is suspended. Data is
 * intact but the org is temporarily unavailable to its members. A multi-org user
 * can switch to another (non-suspended) org, or reach the platform team directly
 * when a support address is configured (their own org's admins may themselves be
 * unreachable while the org is suspended).
 */
export default function SuspendedOrgScreen() {
  const { currentOrg, orgs, switchOrg, signOut } = useAuth();
  const { t } = useTranslation('auth');
  const others = orgs.filter((o) => o.id !== currentOrg?.id && o.status !== 'suspended');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <StageMark variant="tile" size={56} className="mb-6" />
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t('suspended.title')}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        <span className="text-foreground">{currentOrg?.name ?? t('suspended.orgFallback')}</span>{t('suspended.body')}
      </p>
      <SupportContactLine email={APP_META.SUPPORT_EMAIL} />
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {others.length > 0 && (
          <Button variant="outline" onClick={() => switchOrg(others[0].id)}>
            {t('suspended.switchTo', { name: others[0].name })}
          </Button>
        )}
        <Button variant="secondary" onClick={signOut}>{t('suspended.signOut')}</Button>
      </div>
    </div>
  );
}
