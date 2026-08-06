import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { Users, Activity, Database } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { InvitesTab } from '@/components/admin/InvitesTab';
import { MembersTab } from '@/components/admin/MembersTab';
import { fetchAdminAuditLogs, fetchAdminSyncLogs, fetchAdminStats } from '@/data/admin';

/** Row caps for the admin activity panels. */
const AUDIT_LOG_LIMIT = 50;
const SYNC_LOG_LIMIT = 20;

export default function AdminPage() {
  const { hasRole, currentOrg } = useAuth();
  const [params, setParams] = useSearchParams();
  const initialTab = params.get('tab') || 'invites';
  const [tab, setTab] = useState(initialTab);

  const { data: auditLogs, isError: auditError } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => fetchAdminAuditLogs(supabase, AUDIT_LOG_LIMIT),
  });

  const { data: syncLogs, isError: syncError } = useQuery({
    queryKey: ['admin-sync'],
    queryFn: () => fetchAdminSyncLogs(supabase, SYNC_LOG_LIMIT),
  });

  const { data: stats } = useQuery({
    queryKey: ['admin-stats', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchAdminStats(supabase, currentOrg?.id ?? null),
  });

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
          <TabsTrigger value="invites">Invites</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          <TabsTrigger value="sync">Sync Status</TabsTrigger>
        </TabsList>

        <TabsContent value="invites" className="mt-4">
          <InvitesTab />
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <MembersTab />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">Booking Audit Trail</CardTitle></CardHeader>
            <CardContent>
              {auditError && (
                <Alert variant="destructive" className="mb-3">
                  <AlertDescription>Failed to load the audit trail.</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                {auditLogs?.map((log) => (
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
                {!auditError && auditLogs?.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No audit logs yet</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">Airtable Sync Status</CardTitle></CardHeader>
            <CardContent>
              {syncError && (
                <Alert variant="destructive" className="mb-3">
                  <AlertDescription>Failed to load the sync status.</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                {syncError ? null : syncLogs && syncLogs.length > 0 ? syncLogs.map((log) => (
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
                    <p className="text-sm text-muted-foreground">No sync events yet. Enable Airtable sync in Settings to start syncing.</p>
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
