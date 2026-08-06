import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchMyChats } from '@/data/chats';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CHAT_ARCHIVE_DAYS } from '@/config/app.config';
import { differenceInCalendarDays, format } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import { parseDateOnly } from '@/lib/dates';
import { useReferenceField } from '@/hooks/useBookingFlow';
import { referenceLabel } from '@/lib/bookingFlow';
import { ShowDateDetailSheet } from '@/components/shows/ShowDateDetailSheet';

export default function ChatsListPage() {
  const [activeShowDateId, setActiveShowDateId] = useState<string | null>(null);
  const { reference, customFieldKey } = useReferenceField();
  const { currentOrg } = useAuth();

  const { data: chats, isLoading } = useQuery({
    queryKey: ['my-chats', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchMyChats(supabase, currentOrg?.id ?? null),
  });

  const visible = useMemo(() => {
    const today = new Date();
    return (chats ?? []).filter(c => {
      const d = c.show_date?.date;
      if (!d) return false;
      return differenceInCalendarDays(today, parseDateOnly(d)) <= CHAT_ARCHIVE_DAYS;
    });
  }, [chats]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight flex items-center gap-3">
          <MessageSquare className="h-7 w-7 text-primary" /> Chats
        </h1>
        <p className="text-muted-foreground mt-1">
          One chat per show date. Hidden {CHAT_ARCHIVE_DAYS} days after the show.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      ) : visible.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No active chats.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {visible.map(c => (
            <button
              key={c.id}
              className="text-left w-full"
              onClick={() => setActiveShowDateId(c.show_date?.id ?? null)}
            >
              <Card className="hover:border-primary transition-colors">
                <CardContent className="py-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{referenceLabel({ reference, show: c.show_date?.show ?? null, custom: null, customFieldKey })}</p>
                    <p className="text-sm text-muted-foreground">
                      {c.show_date?.date && format(parseDateOnly(c.show_date.date), 'EEEE, MMM d, yyyy')}
                    </p>
                  </div>
                  <Badge variant="secondary">Open</Badge>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      <ShowDateDetailSheet
        showDateId={activeShowDateId}
        open={!!activeShowDateId}
        onOpenChange={o => { if (!o) setActiveShowDateId(null); }}
      />
    </div>
  );
}
