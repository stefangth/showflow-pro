import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { Shield, Users, Activity, Database } from 'lucide-react';

export default function AdminPage() {
  const { hasRole } = useAuth();

  const { data: users } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*, user_roles(role)');
      return data ?? [];
    },
  });

  const { data: auditLogs } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: async () => {
      const { data } = await supabase
        .from('booking_audit_log')
        .select('*, booking:bookings(artist:artists(name))')
        .order('created_at', { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const { data: syncLogs } = useQuery({
    queryKey: ['admin-sync'],
    queryFn: async () => {
      const { data } = await supabase
        .from('airtable_sync_log')
        .select('*')
        .order('synced_at', { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [shows, artists, bookings] = await Promise.all([
        supabase.from('shows').select('*', { count: 'exact', head: true }),
        supabase.from('artists').select('*', { count: 'exact', head: true }),
        supabase.from('bookings').select('*', { count: 'exact', head: true }),
      ]);
      return { shows: shows.count ?? 0, artists: artists.count ?? 0, bookings: bookings.count ?? 0 };
    },
  });

  if (!hasRole('admin')) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Admin Panel</h1>
        <p className="text-muted-foreground mt-1">System management and monitoring</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Shows', value: stats?.shows ?? 0, icon: Activity },
          { label: 'Total Artists', value: stats?.artists ?? 0, icon: Users },
          { label: 'Total Bookings', value: stats?.bookings ?? 0, icon: Database },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-6 flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-display font-bold">{s.value}</p>
              </div>
              <s.icon className="h-8 w-8 text-primary opacity-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          <TabsTrigger value="sync">Sync Status</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">User Management</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {users?.map((u: any) => (
                  <div key={u.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                    <div>
                      <p className="font-medium text-sm">{u.display_name || 'Unnamed'}</p>
                      <p className="text-xs text-muted-foreground">{u.user_id}</p>
                    </div>
                    <div className="flex gap-1">
                      {u.user_roles?.map((r: any) => (
                        <Badge key={r.role} variant="secondary" className="text-xs capitalize">{r.role}</Badge>
                      ))}
                      {(!u.user_roles || u.user_roles.length === 0) && (
                        <Badge variant="outline" className="text-xs">No role</Badge>
                      )}
                    </div>
                  </div>
                ))}
                {users?.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No users</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">Booking Audit Trail</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {auditLogs?.map((log: any) => (
                  <div key={log.id} className="flex items-center justify-between p-3 rounded-lg border border-border text-sm">
                    <div>
                      <span className="font-medium">{log.action}</span>
                      {log.booking?.artist?.name && <span className="text-muted-foreground"> — {log.booking.artist.name}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {log.old_status && <Badge variant="outline" className="text-xs">{log.old_status}</Badge>}
                      {log.old_status && log.new_status && <span className="text-muted-foreground">→</span>}
                      {log.new_status && <Badge variant="secondary" className="text-xs">{log.new_status}</Badge>}
                      <span className="text-xs text-muted-foreground">{format(new Date(log.created_at), 'MMM d, HH:mm')}</span>
                    </div>
                  </div>
                ))}
                {auditLogs?.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No audit logs yet</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">Airtable Sync Status</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {syncLogs && syncLogs.length > 0 ? syncLogs.map((log: any) => (
                  <div key={log.id} className="flex items-center justify-between p-3 rounded-lg border border-border text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={log.status === 'success' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>
                        {log.status}
                      </Badge>
                      <span>{log.sync_type}</span>
                      <span className="text-muted-foreground">{log.records_processed} records</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{format(new Date(log.synced_at), 'MMM d, HH:mm')}</span>
                  </div>
                )) : (
                  <div className="text-center py-8">
                    <Database className="h-10 w-10 mx-auto text-muted-foreground opacity-30 mb-3" />
                    <p className="text-sm text-muted-foreground">Airtable sync is currently mocked. Enable it in app config to start syncing.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
