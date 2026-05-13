import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, MessageCircleQuestion, Theater } from 'lucide-react';
import { useArtistEligibleDates } from '@/hooks/useArtistEligibleDates';
import { useMyArtist } from '@/hooks/useMyArtist';
import { formatDateDMY } from '@/lib/dates';
import { showLabel } from '@/types';

type AvailRow = { date: string };
type CastMembershipRow = { id: string; role: string | null; cast: { id: string; name: string } | null };

/**
 * Artist dashboard: response rate to eligible dates + list of unanswered offers.
 */
export function ArtistDashboard() {
  const { data: artist } = useMyArtist();
  const { data: eligibleDates } = useArtistEligibleDates();

  const { data: myAvailability } = useQuery({
    queryKey: ['availability', 'response-rate', artist?.id],
    enabled: !!artist?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('availability')
        .select('date')
        .eq('artist_id', artist!.id);
      return (data ?? []) as AvailRow[];
    },
  });

  const { data: myMemberships } = useQuery({
    queryKey: ['my-cast-memberships', artist?.id],
    enabled: !!artist?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cast_members')
        .select('id, role, cast:casts(id, name)')
        .eq('artist_id', artist!.id);
      if (error) throw error;
      return (data ?? []) as unknown as CastMembershipRow[];
    },
  });

  const { responded, total, pct, unanswered } = useMemo(() => {
    const dates = eligibleDates ?? [];
    const respondedSet = new Set((myAvailability ?? []).map((a) => a.date));
    const total = dates.length;
    const respondedCount = dates.filter((d) => respondedSet.has(d.date)).length;
    return {
      total,
      responded: respondedCount,
      pct: total === 0 ? 0 : Math.round((respondedCount / total) * 100),
      unanswered: dates.filter((d) => !respondedSet.has(d.date)),
    };
  }, [eligibleDates, myAvailability]);

  if (!artist) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">Dashboard</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No artist profile linked to your account. Ask an admin to link your account.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Your response rate on dates you've been offered.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link to="/availability?filter=unanswered" className="block">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between mb-4">
                <p className="text-sm text-muted-foreground font-medium">Response rate</p>
                <CalendarDays className="h-8 w-8 text-primary opacity-30" />
              </div>
              <div className="flex items-baseline gap-2 mb-3">
                <p className="text-4xl font-display font-bold">{pct}%</p>
                <p className="text-sm text-muted-foreground">
                  {responded} of {total} dates
                </p>
              </div>
              <div className="space-y-1">
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Click to see unanswered offers →
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <MessageCircleQuestion className="h-4 w-4" />
              Awaiting your response
              <Badge variant="secondary">{unanswered.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {unanswered.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You're all caught up — no pending offers.
              </p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {unanswered.slice(0, 8).map((d) => (
                  <Link
                    key={d.id}
                    to="/availability?filter=unanswered"
                    className="flex items-center justify-between p-2 rounded-md hover:bg-muted text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{showLabel(d.show)}</p>
                      <p className="text-xs text-muted-foreground">{formatDateDMY(d.date)}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      Respond
                    </Badge>
                  </Link>
                ))}
                {unanswered.length > 8 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    +{unanswered.length - 8} more
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <Theater className="h-4 w-4" />
            My Casts
            {(myMemberships?.length ?? 0) > 0 && (
              <Badge variant="secondary">{myMemberships!.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(myMemberships?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">You haven't been added to any casts yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {myMemberships!.map(m => (
                <div key={m.id} className="flex items-center justify-between p-2 rounded-md border border-border">
                  <p className="text-sm font-medium">{m.cast?.name ?? '—'}</p>
                  {m.role ? (
                    <Badge variant="outline" className="text-xs">{m.role}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">No role assigned</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
