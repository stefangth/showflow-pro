import { Button } from '@/components/ui/button';
import { useConsent } from '@/features/consent/ConsentContext';
import { ROUTES } from '@/config/app.config';
import { Link } from 'react-router-dom';
import { CookieConsentDialog } from './CookieConsentDialog';

export function CookieConsentBanner() {
  const { hasDecided, acceptAll, rejectAll, openPreferences, preferencesOpen } = useConsent();

  return (
    <>
      <CookieConsentDialog />
      {!hasDecided && !preferencesOpen && (
        <div
          role="dialog"
          aria-label="Cookie consent"
          aria-live="polite"
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background px-4 py-4 shadow-lg sm:px-6"
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <p className="flex-1 text-sm text-muted-foreground">
              We use strictly necessary cookies for authentication and, with your consent, analytics
              (PostHog incl. session replay) and error tracking (Sentry) to improve the product.{' '}
              <Link to={ROUTES.PRIVACY} className="underline text-foreground hover:text-primary whitespace-nowrap">
                Privacy policy
              </Link>
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={rejectAll}>
                Reject non-essential
              </Button>
              <Button variant="outline" size="sm" onClick={openPreferences}>
                Customize
              </Button>
              <Button size="sm" onClick={acceptAll}>
                Accept all
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
