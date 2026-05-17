import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarDays, TrendingUp, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { addDays, format } from 'date-fns';
import { toast } from 'sonner';
import { ArtistDashboard } from '@/components/dashboard/ArtistDashboard';
import { useSubProgramSlots, effectiveSlots } from '@/hooks/useSubProgramSlots';
import { formatDateDMY } from '@/lib/dates';
import { showLabel } from '@/types';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

type DateRow = { id: string; date: string; show_id: string };
type BookingLite = { show_date_id: string; status: string };
type SoftBookedRow = {
  id: string;
  is_understudy: boolean;
  artist: { id: string; name: string } | null;
  show_date: { id: string; date: string; show: { program: string | null; sub_program: string | null } | null } | null;
};

export default function DashboardPage() {
  const { hasRole } = useAuth();
  if (hasRole('artist') && !hasRole('producer') && !hasRole('admin')) {
    return <ArtistDashboard />;
  }
  return <ProducerDashboard />;
}

function ProducerDashboard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = format(today, 'yyyy-MM-dd');
  const in14 = format(addDays(today, 14), 'yyyy-MM-dd');
  const in30 = format(addDays(today, 30), 'yyyy-MM-dd');

  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const slotDefaults = useSubProgramSlots();

  const { data: upcomingDates } = useQuery({
    queryKey: ['dashboard-upcoming-dates', todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_dates')
        .select('id, date, show_id, show:shows(program, sub_program)')
        .gte('date', todayStr)
        .neq('status', 'cancelled')
        .order('date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as (DateRow & { show: { program: string | null; sub_program: string | null } })[];
    },
  });

  const { data: confirmedBookings } = useQuery({
    queryKey: ['bookings', 'confirmed-dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('show_date_id, status')
        .eq('status', 'confirmed');
      if (error) throw error;
      return (data ?? []) as BookingLite[];
    },
  });

  const confirmedCountByDate = (() => {
    const map = new Map<string, number>();
    (confirmedBookings ?? []).forEach(b => {
      map.set(b.show_date_id, (map.get(b.show_date_id) ?? 0) + 1);
    });
    return map;
  })();

  const { data: softBookedRows } = useQuery({
    queryKey: ['bookings', 'soft-booked'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, is_understudy, artist:artists(id, name), show_date:show_dates!inner(id, date, show:shows(program, sub_program))')
        .eq('status', 'soft_booked')
        .order('show_date(date)', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as SoftBookedRow[];
    },
  });

  const bulkConfirm = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      setSelected(new Set());
      toast.success('Bookings confirmed');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDecline = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: 'producer_declined' })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      setSelected(new Set());
      toast.success('Bookings declined');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const allIds = useMemo(() => (softBookedRows ?? []).map(r => r.id), [softBookedRows]);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const computeRange = (untilStr: string | null) => {
    const dates = (upcomingDates ?? []).filter(d => !untilStr || d.date <= untilStr);
    const total = dates.length;
    const fullyConfirmed = dates.filter(d => {
      const cfg = effectiveSlots(slotDefaults, d.show?.program, d.show?.sub_program);
      if (!cfg) return false; // unconfigured pairs cannot count as fully confirmed
      const totalSlots = cfg.main_cast + cfg.understudies;
      return (confirmedCountByDate.get(d.id) ?? 0) >= totalSlots;
    }).length;
    const pct = total === 0 ? 0 : Math.round((fullyConfirmed / total) * 100);
    const showCount = new Set(dates.map(d => d.show_id)).size;
    return { total, pct, showCount };
  };

  const all = computeRange(null);
  const next14 = computeRange(in14);
  const next30 = computeRange(in30);

  const cards = [
    {
      title: 'Live & upcoming',
      icon: CalendarDays,
      primary: `${all.total}`,
      primaryLabel: all.total === 1 ? 'live date' : 'live dates',
      pct: all.pct,
      to: `/bookings?status=partially_filled&from=${todayStr}`,
      accent: 'text-primary',
    },
    {
      title: 'Next 14 days',
      icon: Clock,
      primary: `${next14.pct}%`,
      primaryLabel: 'cast confirmed',
      sub: `${next14.showCount} show${next14.showCount === 1 ? '' : 's'}`,
      to: `/bookings?status=partially_filled&from=${todayStr}&to=${in14}`,
      accent: 'text-info',
      pctMode: true,
    },
    {
      title: 'Next 30 days',
      icon: TrendingUp,
      primary: `${next30.pct}%`,
      primaryLabel: 'cast confirmed',
      sub: `${next30.showCount} show${next30.showCount === 1 ? '' : 's'}`,
      to: `/bookings?status=partially_filled&from=${todayStr}&to=${in30}`,
      accent: 'text-success',
      pctMode: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Cast confirmation status across upcoming dates.</p>
      </div>

      {/* Ready to confirm */}
      {(softBookedRows?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="font-display flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4 text-warning" />
                Ready to Confirm
                <Badge variant="secondary">{softBookedRows!.length}</Badge>
              </CardTitle>
              {selected.size > 0 && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="text-xs"
                    disabled={bulkConfirm.isPending || bulkDecline.isPending}
                    onClick={() => bulkConfirm.mutate([...selected])}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Confirm {selected.size}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs hover:bg-destructive/10 hover:text-destructive"
                    disabled={bulkConfirm.isPending || bulkDecline.isPending}
                    onClick={() => bulkDecline.mutate([...selected])}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Decline {selected.size}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {/* Select-all header */}
              <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 text-xs text-muted-foreground">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                <span className="flex-1">Artist</span>
                <span className="w-40">Date / Show</span>
                <span className="w-20 text-right">Type</span>
              </div>
              {softBookedRows!.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggleOne(row.id)}
                  />
                  <span className="flex-1 text-sm font-medium truncate">
                    {row.artist?.name ?? '—'}
                  </span>
                  <div className="w-40 min-w-0">
                    <p className="text-sm truncate">{showLabel(row.show_date?.show as any)}</p>
                    <p className="text-xs text-muted-foreground">{formatDateDMY(row.show_date?.date ?? '')}</p>
                  </div>
                  <div className="w-20 text-right">
                    <Badge variant="outline" className="text-xs">
                      {row.is_understudy ? 'Understudy' : 'Main'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c, i) => (
          <motion.div key={c.title} variants={fadeUp} initial="initial" animate="animate" transition={{ delay: i * 0.1 }}>
            <Link to={c.to} className="block">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-4">
                    <p className="text-sm text-muted-foreground font-medium">{c.title}</p>
                    <c.icon className={`h-8 w-8 ${c.accent} opacity-30`} />
                  </div>
                  <div className="flex items-baseline gap-2 mb-3">
                    <p className="text-4xl font-display font-bold">{c.primary}</p>
                    <p className="text-sm text-muted-foreground">{c.primaryLabel}</p>
                  </div>
                  {c.pctMode ? (
                    <p className="text-sm text-muted-foreground">{c.sub}</p>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Cast confirmed</span>
                        <span className="font-medium">{c.pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${c.pct}%` }} />
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-3">Click to see pending shows →</p>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
