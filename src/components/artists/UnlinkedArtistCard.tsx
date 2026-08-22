import { useTranslation } from 'react-i18next';
import { Theater } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Shown to an artist-role user whose account exists but is not yet linked to a
 * catalog artist row (useMyArtist returns null). The Dashboard and the
 * Availability page both dead-end on the same `if (!artist)` branch, so they
 * render this one card rather than each wording the state on their own — a warm
 * card on one surface and a cold "ask an admin" line on the next is exactly the
 * inconsistency this shared component removes. Each page keeps its own heading;
 * this is only the reassuring body card.
 */
export function UnlinkedArtistCard({ orgName }: { orgName?: string | null }) {
  const { t } = useTranslation('artists');
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-tint text-accent-text">
          <Theater className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="font-display text-lg font-semibold">
            {orgName ? t('unlinked.headingOrg', { orgName }) : t('unlinked.heading')}
          </p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {t('unlinked.body')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
