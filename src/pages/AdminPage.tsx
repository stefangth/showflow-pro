import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { PeopleTab } from '@/components/admin/people/PeopleTab';
import { fetchAdminAuditLogs, fetchAdminSyncLogs, fetchAdminStats } from '@/data/admin';
import { PageMini } from '@/components/minis/PageMini';

/** Row caps for the admin activity panels. */
const AUDIT_LOG_LIMIT = 50;
const SYNC_LOG_LIMIT = 20;

export default function AdminPage() {
  const { t } = useTranslation('admin');
  const { hasRole, currentOrg } = useAuth();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') || 'people';
  const initialTab = rawTab === 'invites' || rawTab === 'members' ? 'people' : rawTab;
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    if (rawTab === 'invites' || rawTab === 'members') {
      setParams((p) => { p.set('tab', 'people'); return p; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: auditLogs, isError: auditError } = useQuery({
    queryKey: ['admin-audit', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchAdminAuditLogs(supabase, AUDIT_LOG_LIMIT, currentOrg?.id ?? null),
  });

  const { data: syncLogs, isError: syncError } = useQuery({
    queryKey: ['admin-sync', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchAdminSyncLogs(supabase, SYNC_LOG_LIMIT, currentOrg?.id ?? null),
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
        <p className="text-muted-foreground">{t('page.accessRequired')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">{t('page.title')}</h1>
        <p className="text-muted-foreground mt-1">{t('page.subtitle')}</p>
      </div>

      <PageMini page="admin" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: t('stats.shows'), value: stats?.shows ?? 0, icon: Activity },
          { label: t('stats.artists'), value: stats?.artists ?? 0, icon: Users },
          { label: t('stats.bookings'), value: stats?.bookings ?? 0, icon: Database },
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
          <TabsTrigger value="people">{t('tabs.people')}</TabsTrigger>
          <TabsTrigger value="audit">{t('tabs.audit')}</TabsTrigger>
          <TabsTrigger value="sync">{t('tabs.sync')}</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-4">
          <PeopleTab />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">{t('audit.title')}</CardTitle></CardHeader>
            <CardContent>
              {auditError && (
                <Alert variant="destructive" className="mb-3">
                  <AlertDescription>{t('audit.loadError')}</AlertDescription>
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
                {!auditError && auditLogs?.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">{t('audit.empty')}</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">{t('sync.title')}</CardTitle></CardHeader>
            <CardContent>
              {syncError && (
                <Alert variant="destructive" className="mb-3">
                  <AlertDescription>{t('sync.loadError')}</AlertDescription>
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
                      <span className="text-muted-foreground">{t('sync.records', { n: log.records_processed })}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{format(new Date(log.synced_at), 'dd/MM/yyyy HH:mm')}</span>
                  </div>
                )) : (
                  <div className="text-center py-8">
                    <Database className="h-10 w-10 mx-auto text-muted-foreground opacity-30 mb-3" />
                    <p className="text-sm text-muted-foreground">{t('sync.empty')}</p>
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
