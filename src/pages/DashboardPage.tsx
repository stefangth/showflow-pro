import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { useCan } from '@/hooks/useCapabilities';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarDays, TrendingUp, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { addDays, format } from 'date-fns';
import { toast } from 'sonner';
import { ArtistDashboard } from '@/components/dashboard/ArtistDashboard';
import { TierAttentionCard } from '@/components/dashboard/TierAttentionCard';
import { DirectBookingCard } from '@/components/dashboard/DirectBookingCard';
import { useDashboardFirstRun } from '@/components/dashboard/firstRun/useDashboardFirstRun';
import { DashboardFirstRun } from '@/components/dashboard/firstRun/DashboardFirstRun';
import { SetupChecklistSheet } from '@/components/setup/SetupChecklistSheet';
import { ModuleGate } from '@/components/layout/ModuleGate';
import { ROUTES } from '@/config/app.config';
import type { FeatureKey } from '@/lib/entitlements';
import { useFeature } from '@/hooks/useEntitlements';
import { showSlots } from '@/lib/settings';
import { formatDateDMY } from '@/lib/dates';
import { useReferenceField, useBookingFlow } from '@/hooks/useBookingFlow';
import { referenceLabel, BOOKING_FLOW_DEFAULTS } from '@/lib/bookingFlow';
import { computeTierAttention, unfilledMainCastDates } from '@/lib/bookingCockpit';
import { deliveryHint } from '@/lib/flowCopy';
import {
  bulkConfirmSoftBooked, bulkDeclineSoftBooked, fetchTierAttention,
  fetchConfirmedBookingsLite, fetchSoftBookedRows,
} from '@/data/bookings';
import { fetchUpcomingShowDates } from '@/data/showDates';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

type ShowRef = { program: string | null; sub_program: string | null; main_cast_slots: number | null; understudy_slots: number | null };
type DateRow = { id: string; date: string; show_id: string };

export default function DashboardPage() {
  const { hasRole } = useAuth();
  if (hasRole('artist') && !hasRole('producer') && !hasRole('admin')) {
    return <ArtistDashboard />;
  }
  return <ProducerDashboard />;
}

/** Producer dashboard booking region: the "Ready to Confirm" bulk-action card plus
 *  both attention cards. One gate for all three, since none is meaningful without
 *  the booking module and every one of them either reads or writes bookings. */
export function ProducerBookingSection({ children }: { children: React.ReactNode }) {
  return <ModuleGate feature="booking_flow">{children}</ModuleGate>;
}

function ProducerDashboard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = format(today, 'yyyy-MM-dd');
  const in14 = format(addDays(today, 14), 'yyyy-MM-dd');
  const in30 = format(addDays(today, 30), 'yyyy-MM-dd');

  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const role = hasRole('admin') ? 'admin' : 'producer';
  const fr = useDashboardFirstRun(role);
  // Only the bulk Confirm action is capability-gated (decline/cancel is deliberately not).
  const canConfirmBookings = useCan('confirm_bookings');
  const bookingFlowEnabled = useFeature('booking_flow');
  const { reference, customFieldKey } = useReferenceField();
  const flow = useBookingFlow().data ?? BOOKING_FLOW_DEFAULTS;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A stage's openSetup action opens that module's inline setup Sheet at the step, in
  // place — no routing away to Settings/Productions. The dashboard hosts both modules'
  // Sheets and picks by the action's feature. Open state is tracked separately from the
  // selection so the last-opened {feature, step} persists through the Sheet's ~300ms close
  // animation (SetupChecklistSheet keeps its content mounted for the exit) — nulling it on
  // close would flip the content to the other module mid-slide-out.
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupSel, setSetupSel] = useState<{ feature: FeatureKey; step: string } | null>(null);
  const handleOpenSetup = (feature: FeatureKey, step: string) => { setSetupSel({ feature, step }); setSetupOpen(true); };
  // The header card's ghost CTA: a v1 "how this org works" explainer target, same
  // destination the rest of the app already points role explainers at (Settings > Docs).
  const handleGhost = () => navigate(`${ROUTES.SETTINGS}?tab=docs`);

  const { data: upcomingDates } = useQuery({
    queryKey: ['dashboard-upcoming-dates', todayStr, orgId],
    enabled: !!orgId,
    queryFn: () => fetchUpcomingShowDates<DateRow & { show: ShowRef }>(supabase, orgId, todayStr),
  });

  const { data: confirmedBookings } = useQuery({
    queryKey: ['bookings', 'confirmed-dashboard', orgId],
    enabled: !!orgId,
    queryFn: () => fetchConfirmedBookingsLite(supabase, orgId),
  });

  const confirmedCountByDate = (() => {
    const map = new Map<string, number>();
    (confirmedBookings ?? []).forEach(b => {
      map.set(b.show_date_id, (map.get(b.show_date_id) ?? 0) + 1);
    });
    return map;
  })();

  const confirmedMainByDate = useMemo(() => {
    const map = new Map<string, number>();
    (confirmedBookings ?? []).forEach(b => {
      if (!b.is_understudy) map.set(b.show_date_id, (map.get(b.show_date_id) ?? 0) + 1);
    });
    return map;
  }, [confirmedBookings]);

  const directItems = useMemo(
    () => unfilledMainCastDates(
      (upcomingDates ?? []).map(d => ({
        id: d.id, date: d.date, program: d.show?.program ?? null,
        subProgram: d.show?.sub_program ?? null, mainSlots: d.show?.main_cast_slots ?? null,
      })),
      confirmedMainByDate,
    ),
    [upcomingDates, confirmedMainByDate],
  );

  // Both reads feed regions inside ProducerBookingSection, so without the module
  // their results are fetched and then discarded on every dashboard load.
  const { data: softBookedRows } = useQuery({
    queryKey: ['bookings', 'soft-booked', orgId],
    enabled: !!orgId && bookingFlowEnabled,
    queryFn: () => fetchSoftBookedRows(supabase, orgId),
  });

  const { data: attentionRows } = useQuery({
    queryKey: ['bookings', 'tier-attention', orgId],
    enabled: Boolean(orgId) && flow.artist_acceptance && bookingFlowEnabled,
    queryFn: () => fetchTierAttention(supabase, { orgId, today: todayStr }),
  });
  // Deliberately NOT memoized: structural sharing keeps attentionRows
  // reference-equal across refetches, so a memo would freeze the clock and
  // "Expires soon" could never flip from time passing alone. The derivation
  // is a cheap filter/map (same pattern as computeUpNext in the date sheet).
  const attentionItems = computeTierAttention(attentionRows ?? [], new Date());

  const bulkConfirm = useMutation({
    mutationFn: (ids: string[]) => bulkConfirmSoftBooked(supabase, { ids, now: new Date() }),
    onSuccess: ({ affected }, ids) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      setSelected(new Set());
      if (affected < ids.length) {
        toast.error('Some bookings changed — refresh and retry');
      } else {
        toast.success('Bookings confirmed');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDecline = useMutation({
    mutationFn: (ids: string[]) => bulkDeclineSoftBooked(supabase, { ids, now: new Date() }),
    onSuccess: ({ affected }, ids) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      setSelected(new Set());
      if (affected < ids.length) {
        toast.error('Some bookings changed — refresh and retry');
      } else {
        toast.success('Bookings declined');
      }
    },
    onError: (e: Error) => toast.error(e.message),
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
      const cfg = showSlots(d.show);
      if (!cfg) return false; // unconfigured shows cannot count as fully confirmed
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

  // KPI-visibility rule: a fresh org still in first-run with NO real data shows ONLY the
  // first-run surface (its sample queue stands in for the empty body); an org with real
  // data, or a dismissed surface, shows the KPI body too (alongside the surface when it is
  // still showing). Not wrapped in any sample/greyed component -- when it renders, it is
  // the real thing.
  // Safety invariant, no datesSettled guard needed: fr.show shares the exact same
  // ["dashboard-upcoming-dates", today, orgId] query key as upcomingDates below (via
  // useFirstRunMetrics), so it cannot flip true before hasData is accurate.
  const hasData = (upcomingDates?.length ?? 0) > 0;
  const showFirstRun = fr.show && !fr.dismissed;

  return (
    <div className="space-y-6">
      {fr.show && (
        <DashboardFirstRun
          result={fr.result}
          queueRows={fr.queueRows}
          dismissed={fr.dismissed}
          onDismiss={fr.dismiss}
          onUndismiss={fr.undismiss}
          onOpenSetup={handleOpenSetup}
          onGhost={handleGhost}
        />
      )}

      {(!showFirstRun || hasData) && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-[32px] font-semibold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Cast confirmation status across upcoming dates.</p>
          </div>

          <ProducerBookingSection>
            {/* Ready to confirm. Backlog-driven, not policy-driven: under auto-confirm,
                new soft_booked rows do not arise, so the card self-hides; any that
                exist are backlog from a previous policy and need the affordance.
                Inside the module gate: the freeze decision deliberately preserves that
                soft_booked backlog, so an unentitled org is exactly the case where this
                card would otherwise appear with live bulk-write controls. */}
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
                          disabled={bulkConfirm.isPending || bulkDecline.isPending || !canConfirmBookings}
                          title={canConfirmBookings ? undefined : "You don't have permission to confirm bookings"}
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
                          <p className="text-sm truncate">
                            {referenceLabel({ reference, show: row.show_date?.show ?? null, custom: null, customFieldKey })}
                          </p>
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

            {flow.artist_acceptance && (
              <TierAttentionCard
                items={attentionItems}
                hint={deliveryHint(flow)}
                reference={reference}
                customFieldKey={customFieldKey}
              />
            )}

            {!flow.artist_acceptance && (
              <DirectBookingCard items={directItems} reference={reference} customFieldKey={customFieldKey} />
            )}
          </ProducerBookingSection>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((c, i) => (
              <motion.div key={c.title} variants={fadeUp} initial="initial" animate="animate" transition={{ delay: i * 0.1 }}>
                <Link to={c.to} className="block">
                  <Card className="hover:shadow-elev3 transition-shadow cursor-pointer h-full">
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between mb-4">
                        <p className="text-sm text-muted-foreground font-medium">{c.title}</p>
                        <c.icon className={`h-8 w-8 ${c.accent} opacity-30`} />
                      </div>
                      <div className="flex items-baseline gap-2 mb-3">
                        <p className="text-[36px] font-display font-semibold tracking-tight">{c.primary}</p>
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
      )}

      <SetupChecklistSheet
        feature={setupSel?.feature ?? 'booking_flow'}
        orgId={orgId}
        open={setupOpen}
        onOpenChange={setSetupOpen}
        initialStep={setupSel?.step}
      />
    </div>
  );
}
