import { useAuth } from '@/features/auth/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, Users, BookOpen, AlertTriangle, TrendingUp, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

export default function DashboardPage() {
  const { user, roles, hasRole } = useAuth();

  const { data: shows } = useQuery({
    queryKey: ['shows-count'],
    queryFn: async () => {
      const { count } = await supabase.from('shows').select('*', { count: 'exact', head: true });
      return count ?? 0;
    },
  });

  const { data: upcomingDates } = useQuery({
    queryKey: ['upcoming-dates'],
    queryFn: async () => {
      const { data } = await supabase
        .from('show_dates')
        .select('*, show:shows(title)')
        .gte('date', format(new Date(), 'yyyy-MM-dd'))
        .order('date', { ascending: true })
        .limit(10);
      return data ?? [];
    },
  });

  const { data: artists } = useQuery({
    queryKey: ['artists-count'],
    queryFn: async () => {
      const { count } = await supabase.from('artists').select('*', { count: 'exact', head: true });
      return count ?? 0;
    },
  });

  const { data: activeBookings } = useQuery({
    queryKey: ['active-bookings'],
    queryFn: async () => {
      const { count } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .in('status', ['suggested', 'soft_booked', 'confirmed']);
      return count ?? 0;
    },
  });

  const { data: recentBookings } = useQuery({
    queryKey: ['recent-bookings'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bookings')
        .select('*, artist:artists(name), show_date:show_dates(date, show:shows(title))')
        .order('created_at', { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const statusColor: Record<string, string> = {
    suggested: 'bg-info/10 text-info',
    soft_booked: 'bg-warning/10 text-warning',
    confirmed: 'bg-success/10 text-success',
    cancelled: 'bg-destructive/10 text-destructive',
    open: 'bg-muted text-muted-foreground',
    partially_filled: 'bg-warning/10 text-warning',
    fully_filled: 'bg-success/10 text-success',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back. Here's what's happening.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Shows', value: shows ?? 0, icon: CalendarDays, color: 'text-primary' },
          { label: 'Artists', value: artists ?? 0, icon: Users, color: 'text-accent' },
          { label: 'Active Bookings', value: activeBookings ?? 0, icon: BookOpen, color: 'text-success' },
          { label: 'Upcoming Dates', value: upcomingDates?.length ?? 0, icon: Clock, color: 'text-info' },
        ].map((stat, i) => (
          <motion.div key={stat.label} variants={fadeUp} initial="initial" animate="animate" transition={{ delay: i * 0.1 }}>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="text-3xl font-display font-bold mt-1">{stat.value}</p>
                  </div>
                  <stat.icon className={`h-10 w-10 ${stat.color} opacity-20`} />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming dates */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Upcoming Show Dates</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingDates && upcomingDates.length > 0 ? (
              <div className="space-y-3">
                {upcomingDates.map((d: any) => (
                  <div key={d.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="font-medium text-sm">{d.show?.title ?? 'Unknown Show'}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(d.date), 'MMM d, yyyy')}</p>
                    </div>
                    <Badge variant="secondary" className={statusColor[d.status] ?? ''}>
                      {d.status.replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No upcoming dates</p>
            )}
          </CardContent>
        </Card>

        {/* Recent bookings */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Recent Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            {recentBookings && recentBookings.length > 0 ? (
              <div className="space-y-3">
                {recentBookings.map((b: any) => (
                  <div key={b.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="font-medium text-sm">{b.artist?.name ?? 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.show_date?.show?.title} — {b.show_date?.date ? format(new Date(b.show_date.date), 'MMM d') : ''}
                      </p>
                    </div>
                    <Badge variant="secondary" className={statusColor[b.status] ?? ''}>
                      {b.status.replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No bookings yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
