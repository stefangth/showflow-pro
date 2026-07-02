import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CHAT_ARCHIVE_DAYS } from '@/config/app.config';
import { differenceInCalendarDays, format } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import { showLabel } from '@/types';
import { ShowDateDetailSheet } from '@/components/shows/ShowDateDetailSheet';

type ChatRow = {
  id: string;
  show_date_id: string;
  created_at: string;
  show_date: { id: string; date: string; show_id: string; show: { id: string; program: string | null; sub_program: string | null } } | null;
};

export default function ChatsListPage() {
  const [activeShowDateId, setActiveShowDateId] = useState<string | null>(null);

  const { data: chats, isLoading } = useQuery({
    queryKey: ['my-chats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id, show_date_id, created_at, show_date:show_dates(id, date, show_id, show:shows(id, program, sub_program))')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ChatRow[];
    },
  });

  const today = new Date();

  const visible = useMemo(() => {
    return (chats ?? []).filter(c => {
      const d = c.show_date?.date;
      if (!d) return false;
      return differenceInCalendarDays(today, new Date(d + 'T00:00:00')) <= CHAT_ARCHIVE_DAYS;
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
                    <p className="font-medium">{showLabel(c.show_date?.show ?? { program: null, sub_program: null })}</p>
                    <p className="text-sm text-muted-foreground">
                      {c.show_date?.date && format(new Date(c.show_date.date + 'T00:00:00'), 'EEEE, MMM d, yyyy')}
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
