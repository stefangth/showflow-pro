import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchCasts, fetchCastRosterCounts } from '@/data/casts';
import { useAuth } from '@/features/auth/AuthContext';
import { useCan } from '@/hooks/useCapabilities';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CastDialog } from './CastDialog';
import { CastDetailsSheet } from './CastDetailsSheet';
import { Users } from 'lucide-react';
import type { Cast } from '@/types';

interface CastsSectionProps {
  onArtistClick?: (artistId: string) => void;
}

export function CastsSection({ onArtistClick }: CastsSectionProps = {}) {
  const { t } = useTranslation('showsDetail');
  const { hasRole, currentOrg } = useAuth();
  // Page-level visibility: this section only renders on ArtistsPage, which is already
  // admin/producer-gated at the route level. canManageCasts (below) separately governs
  // the mutating controls (create/edit cast, add/remove members) so read access to the
  // cast list and details survives an org disabling the manage_casts capability.
  const canView = hasRole('admin') || hasRole('producer');
  const canManageCasts = useCan('manage_casts');
  const [activeCast, setActiveCast] = useState<Cast | null>(null);

  const { data: casts } = useQuery({
    queryKey: ['casts', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchCasts(supabase, currentOrg?.id ?? null),
  });

  const { data: counts } = useQuery({
    // Roster count, not the active-only coverage count: the sheet this card opens lists
    // every member, so the two must agree.
    queryKey: ['cast-roster-counts', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchCastRosterCounts(supabase, currentOrg?.id ?? null),
  });

  if (!canView) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <Users className="h-5 w-5" /> {t('castsSection.casts')}
        </CardTitle>
        {canManageCasts && <CastDialog />}
      </CardHeader>
      <CardContent>
        {(casts?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t('castsSection.noCasts')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {casts!.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveCast(c)}
                className="text-left p-3 rounded-card border border-border hover:bg-hover-tint transition-colors"
              >
                <p className="font-medium text-sm">{c.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('castsSection.memberCount', { count: counts?.[c.id] ?? 0 })}
                </p>
                {c.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</p>}
              </button>
            ))}
          </div>
        )}
      </CardContent>

      <CastDetailsSheet
        cast={activeCast}
        open={!!activeCast}
        onOpenChange={(o) => { if (!o) setActiveCast(null); }}
        onArtistClick={onArtistClick}
      />
    </Card>
  );
}
