import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, Settings as SettingsIcon } from 'lucide-react';
import { format } from 'date-fns';
import { Users, Activity, Database } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ApprovalsTab } from '@/components/admin/ApprovalsTab';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const ALL_ROLES: Array<'admin' | 'producer' | 'artist'> = ['admin', 'producer', 'artist'];

type IamUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  roles: string[];
  approval_status: 'pending' | 'approved' | 'rejected' | null;
};

export default function AdminPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const initialTab = params.get('tab') || 'approvals';
  const [tab, setTab] = useState(initialTab);

  const { data: pendingCount } = useQuery({
    queryKey: ['user-approvals', 'count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('user_approvals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      return count ?? 0;
    },
  });

  const { data: iamUsers } = useQuery({
    queryKey: ['admin-iam-users'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-list-users');
      if (error) throw error;
      return (data?.users ?? []) as IamUser[];
    },
    enabled: hasRole('admin'),
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

  // Realtime invalidation for approvals (drives badge count)
  useEffect(() => {
    const channel = supabase
      .channel('admin-page-approvals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_approvals' }, () => {
        qc.invalidateQueries({ queryKey: ['user-approvals'] });
        qc.invalidateQueries({ queryKey: ['admin-iam-users'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const handleTabChange = (v: string) => {
    setTab(v);
    setParams((p) => { p.set('tab', v); return p; }, { replace: true });
  };

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
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Admin Panel</h1>
        <p className="text-muted-foreground mt-1">Identity & access management, audit trail, sync status</p>
      </div>

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
                <p className="text-[26px] font-display font-semibold">{s.value}</p>
              </div>
              <s.icon className="h-8 w-8 text-primary opacity-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="approvals" className="relative">
            Approvals
            {pendingCount && pendingCount > 0 ? (
              <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1.5 text-xs">{pendingCount}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          <TabsTrigger value="sync">Sync Status</TabsTrigger>
        </TabsList>

        <TabsContent value="approvals" className="mt-4">
          <ApprovalsTab />
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">Identity & access</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {iamUsers?.map((u) => (
                  <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border border-border">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{u.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Joined {format(new Date(u.created_at), 'dd/MM/yyyy')}
                        {u.last_sign_in_at ? ` · Last seen ${format(new Date(u.last_sign_in_at), 'dd/MM/yyyy HH:mm')}` : ' · Never signed in'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {u.approval_status && (
                        <Badge
                          variant="outline"
                          className={
                            u.approval_status === 'approved' ? 'border-success text-success' :
                            u.approval_status === 'rejected' ? 'border-destructive text-destructive' :
                            'border-warning text-warning'
                          }
                        >
                          {u.approval_status}
                        </Badge>
                      )}
                      {u.roles.length > 0 ? (
                        u.roles.map(r => (
                          <Badge key={r} variant="secondary" className="text-xs capitalize">{r}</Badge>
                        ))
                      ) : (
                        <Badge variant="outline" className="text-xs">No role</Badge>
                      )}
                      <RoleAssignPopover userId={u.id} currentRoles={u.roles} />
                    </div>
                  </div>
                ))}
                {iamUsers?.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No users</p>}
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
                      <span className="text-xs text-muted-foreground">{format(new Date(log.created_at), 'dd/MM/yyyy HH:mm')}</span>
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
                    <span className="text-xs text-muted-foreground">{format(new Date(log.synced_at), 'dd/MM/yyyy HH:mm')}</span>
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

function RoleAssignPopover({ userId, currentRoles }: { userId: string; currentRoles: string[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const setRole = useMutation({
    mutationFn: async ({ role, action }: { role: 'admin' | 'producer' | 'artist'; action: 'add' | 'remove' }) => {
      const { data, error } = await supabase.functions.invoke('admin-set-role', {
        body: { user_id: userId, role, action },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-iam-users'] });
      toast({ title: 'Role updated' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
          <SettingsIcon className="h-3 w-3 mr-1" />Roles
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="end">
        {ALL_ROLES.map((r) => {
          const has = currentRoles.includes(r);
          return (
            <button
              key={r}
              onClick={() => setRole.mutate({ role: r, action: has ? 'remove' : 'add' })}
              className="flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-muted text-left capitalize"
            >
              <Check className={cn('h-4 w-4 mr-2', has ? 'opacity-100' : 'opacity-0')} />
              {r}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
