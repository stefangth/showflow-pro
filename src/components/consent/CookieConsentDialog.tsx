import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useConsent, ConsentChoices } from '@/features/consent/ConsentContext';
import { ROUTES } from '@/config/app.config';
import { Link } from 'react-router-dom';

export function CookieConsentDialog() {
  const { consent, setConsent, preferencesOpen, closePreferences, acceptAll, rejectAll } = useConsent();

  const [draft, setDraft] = useState<ConsentChoices>({
    analytics: consent.analytics,
    sessionReplay: consent.sessionReplay,
    errorTracking: consent.errorTracking,
  });

  const save = () => {
    setConsent(draft);
    closePreferences();
  };

  return (
    <Dialog open={preferencesOpen} onOpenChange={(open) => { if (!open) closePreferences(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Cookie preferences</DialogTitle>
          <DialogDescription>
            Choose which cookies you allow. You can change this at any time.{' '}
            <Link to={ROUTES.PRIVACY} className="underline text-foreground hover:text-primary" onClick={closePreferences}>
              Privacy policy
            </Link>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Strictly necessary</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Authentication session (Supabase). Cannot be disabled.
              </p>
            </div>
            <Switch checked disabled aria-label="Strictly necessary cookies — always enabled" />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Analytics (PostHog)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Page views, feature usage. Used to improve the product.
              </p>
            </div>
            <Switch
              checked={draft.analytics}
              onCheckedChange={(v) => setDraft(d => ({ ...d, analytics: v, sessionReplay: v ? d.sessionReplay : false }))}
              aria-label="Analytics cookies"
            />
          </div>

          <div className="flex items-start justify-between gap-4 pl-4 border-l border-border">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Session replay (PostHog)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Anonymised recording of your interactions. Requires analytics.
              </p>
            </div>
            <Switch
              checked={draft.sessionReplay && draft.analytics}
              disabled={!draft.analytics}
              onCheckedChange={(v) => setDraft(d => ({ ...d, sessionReplay: v }))}
              aria-label="Session replay"
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Error tracking (Sentry)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Crash reports sent to Sentry to help us fix bugs.
              </p>
            </div>
            <Switch
              checked={draft.errorTracking}
              onCheckedChange={(v) => setDraft(d => ({ ...d, errorTracking: v }))}
              aria-label="Error tracking cookies"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => { rejectAll(); closePreferences(); }}>
            Reject all
          </Button>
          <Button variant="outline" size="sm" onClick={() => { acceptAll(); closePreferences(); }}>
            Accept all
          </Button>
          <Button size="sm" onClick={save}>
            Save preferences
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
