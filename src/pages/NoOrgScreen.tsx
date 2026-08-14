import { useAuth } from '@/features/auth/AuthContext';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { StageMark } from '@/components/brand/StageMark';

/**
 * Shown by ProtectedRoute when a signed-in user belongs to no organization.
 * Access is membership (invite-only), so there is nothing to show until an org
 * admin invites them and they accept.
 */
export default function NoOrgScreen() {
  const { user, signOut } = useAuth();
  const { t } = useTranslation('auth');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <StageMark variant="tile" size={56} className="mb-6" />
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t('noOrg.title')}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        {user?.email ? (
          <>
            {t('noOrg.signedInAsPrefix')} <span className="text-foreground">{user.email}</span>
            {t('noOrg.bodyWithEmail')}
          </>
        ) : (
          <>{t('noOrg.bodyNoEmail')}</>
        )}
      </p>
      <Button variant="outline" className="mt-6" onClick={signOut}>{t('noOrg.signOut')}</Button>
    </div>
  );
}
