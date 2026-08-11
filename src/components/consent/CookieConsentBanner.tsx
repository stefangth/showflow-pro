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
            {/* A consent notice has to name the recipients, or the choice
              *  underneath it is not informed. "A single privacy-friendly
              *  analytics cookie" named none of them and undercounted the
              *  categories the dialog behind this banner actually offers:
              *  product analytics, session replay, and error reports all go to
              *  PostHog, and each takes its own toggle.
              *
              *  Deliberately phrased as collection rather than as script
              *  loading. */}
            <p className="flex-1 text-sm text-muted-foreground">
              We ask before collecting any product analytics, session replay, or error reports.
              Analytics, session replay, and error reports go to PostHog. Sign-in cookies
              are strictly necessary and always on. No advertising, no cross-site tracking. See our {' '}
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
