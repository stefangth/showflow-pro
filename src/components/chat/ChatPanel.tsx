import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { MessageBubble } from './MessageBubble';
import { useChatParticipant } from '@/hooks/useChatParticipant';
import { CHAT_ARCHIVE_DAYS } from '@/config/app.config';
import { differenceInCalendarDays } from 'date-fns';
import { MessageSquare, Send, Archive } from 'lucide-react';

interface Props {
  showDateId: string;
  showDate: string; // ISO date string (YYYY-MM-DD)
}

type MessageRow = { id: string; chat_id: string; user_id: string; body: string; created_at: string };

export function ChatPanel({ showDateId, showDate }: Props) {
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: isParticipant, isLoading: participantLoading } = useChatParticipant(showDateId);

  const archived = useMemo(() => {
    const d = new Date(showDate + 'T00:00:00');
    return differenceInCalendarDays(new Date(), d) > CHAT_ARCHIVE_DAYS;
  }, [showDate]);

  const isAdmin = hasRole('admin');

  // Find or create chat
  const { data: chat } = useQuery({
    queryKey: ['chat', showDateId],
    enabled: !!isParticipant,
    queryFn: async () => {
      const { data: existing } = await supabase
        .from('chats')
        .select('*')
        .eq('show_date_id', showDateId)
        .maybeSingle();
      if (existing) return existing;
      const { data: created, error } = await supabase
        .from('chats')
        .insert({ show_date_id: showDateId, created_by: user?.id ?? null })
        .select()
        .single();
      if (error) throw error;
      return created;
    },
  });

  // Messages
  const { data: messages } = useQuery({
    queryKey: ['chat-messages', chat?.id],
    enabled: !!chat,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', chat!.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as MessageRow[];
    },
  });

  // Author display names
  const userIds = useMemo(() => Array.from(new Set((messages ?? []).map(m => m.user_id))), [messages]);
  const { data: profiles } = useQuery({
    queryKey: ['chat-author-profiles', userIds.join(',')],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds);
      const map: Record<string, string> = {};
      (data ?? []).forEach(p => { map[p.user_id] = p.display_name ?? 'User'; });
      return map;
    },
  });

  // Realtime subscription
  useEffect(() => {
    if (!chat?.id) return;
    const channel = supabase
      .channel(`chat:${chat.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${chat.id}` },
        () => qc.invalidateQueries({ queryKey: ['chat-messages', chat.id] })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chat?.id, qc]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages?.length]);

  const send = useMutation({
    mutationFn: async () => {
      const body = draft.trim();
      if (!body || !chat || !user) return;
      const { error } = await supabase.from('chat_messages').insert({
        chat_id: chat.id, user_id: user.id, body,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['chat-messages', chat?.id] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  if (participantLoading) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading chat…</CardContent></Card>;
  }

  if (!isParticipant) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Chat is only available to producers, admins, and artists booked or soft-booked for this date.
        </CardContent>
      </Card>
    );
  }

  if (archived && !isAdmin) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-3 text-sm text-muted-foreground">
          <Archive className="h-4 w-4" />
          This chat was archived {CHAT_ARCHIVE_DAYS} days after the show date.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-[500px]">
      <CardHeader className="border-b border-border py-3 space-y-0">
        <div className="flex items-center justify-between">
          <CardTitle className="font-display text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Chat
          </CardTitle>
          {archived && isAdmin && (
            <Badge variant="secondary" className="text-xs"><Archive className="h-3 w-3 mr-1" />Archived (read-only)</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-3">
        {(messages?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No messages yet. Say hello.</p>
        ) : (
          messages!.map(m => (
            <MessageBubble
              key={m.id}
              body={m.body}
              createdAt={m.created_at}
              authorName={profiles?.[m.user_id] ?? 'User'}
              isMe={m.user_id === user?.id}
            />
          ))
        )}
      </CardContent>

      <div className="border-t border-border p-3">
        <form
          onSubmit={(e) => { e.preventDefault(); if (!archived) send.mutate(); }}
          className="flex gap-2"
        >
          <Input
            placeholder={archived ? 'Archived — read only' : 'Write a message…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={archived || send.isPending}
          />
          <Button type="submit" size="icon" disabled={archived || !draft.trim() || send.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </Card>
  );
}
