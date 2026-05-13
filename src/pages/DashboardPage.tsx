import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarDays, TrendingUp, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { addDays, format } from 'date-fns';
import { ArtistDashboard } from '@/components/dashboard/ArtistDashboard';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

type DateRow = { id: string; date: string; show_id: string };
type BookingLite = { show_date_id: string; status: string };

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

  const { data: upcomingDates } = useQuery({
    queryKey: ['dashboard-upcoming-dates', todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_dates')
        .select('id, date, show_id, show:shows(slots_per_date)')
        .gte('date', todayStr)
        .neq('status', 'cancelled')
        .order('date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as (DateRow & { show: { slots_per_date: number } })[];
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

  const computeRange = (untilStr: string | null) => {
    const dates = (upcomingDates ?? []).filter(d => !untilStr || d.date <= untilStr);
    const total = dates.length;
    const fullyConfirmed = dates.filter(d => (confirmedCountByDate.get(d.id) ?? 0) >= (d.show?.slots_per_date ?? 1)).length;
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
      to: `/bookings?status=cast_pending&from=${todayStr}`,
      accent: 'text-primary',
    },
    {
      title: 'Next 14 days',
      icon: Clock,
      primary: `${next14.pct}%`,
      primaryLabel: 'cast confirmed',
      sub: `${next14.showCount} show${next14.showCount === 1 ? '' : 's'}`,
      to: `/bookings?status=cast_pending&from=${todayStr}&to=${in14}`,
      accent: 'text-info',
      pctMode: true,
    },
    {
      title: 'Next 30 days',
      icon: TrendingUp,
      primary: `${next30.pct}%`,
      primaryLabel: 'cast confirmed',
      sub: `${next30.showCount} show${next30.showCount === 1 ? '' : 's'}`,
      to: `/bookings?status=cast_pending&from=${todayStr}&to=${in30}`,
      accent: 'text-success',
      pctMode: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Cast confirmation status across upcoming dates.</p>
      </div>

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
