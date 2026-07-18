import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAllCities } from '@/hooks/useAllCities';
import { fetchOrgProducers } from '@/data/orgs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

// Sentinel value used in Selects to represent "Any" / unscoped — Radix Select
// forbids empty-string SelectItem values.
const ANY_SCOPE = '__any__';

type ProgramSubProgramPair = { program: string; sub_program: string };
type ShowAssignmentRow = { id: string; producer_user_id: string; program: string; sub_program: string | null; city_id: string | null };

interface Props {
  /** Raw currentOrg?.id — kept undefined-able to preserve exact React Query keys. */
  currentOrgId: string | undefined;
  canEnter: boolean;
}

/**
 * Settings → Production Ownership. Self-contained: owns its own assignments,
 * producers, and program/sub-program queries + realtime + add/remove form state.
 * Does not touch the page-level settings draft.
 */
export function ProductionOwnershipTab({ currentOrgId, canEnter }: Props) {
  const qc = useQueryClient();
  const { data: cities } = useAllCities(canEnter);

  const { data: showProgramSubProgramPairs } = useQuery({
    queryKey: ['shows-program-sub-programs', currentOrgId],
    enabled: canEnter,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shows')
        .select('program, sub_program')
        .not('program', 'is', null)
        .not('sub_program', 'is', null);
      if (error) throw error;
      const seen = new Set<string>();
      const pairs: ProgramSubProgramPair[] = [];
      (data ?? []).forEach(r => {
        const key = `${r.program}::${r.sub_program}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ program: r.program as string, sub_program: r.sub_program as string });
        }
      });
      pairs.sort((a, b) => a.program.localeCompare(b.program) || a.sub_program.localeCompare(b.sub_program));
      return pairs;
    },
  });

  const { data: showAssignments } = useQuery({
    queryKey: ['show-assignments'],
    enabled: canEnter,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_assignments')
        .select('id, producer_user_id, program, sub_program, city_id')
        .order('program').order('sub_program').order('created_at');
      if (error) throw error;
      return (data ?? []) as ShowAssignmentRow[];
    },
  });

  const { data: producerUsers } = useQuery({
    queryKey: ['producer-users', currentOrgId],
    enabled: canEnter && !!currentOrgId,
    queryFn: () => fetchOrgProducers(supabase, currentOrgId!),
  });

  useEffect(() => {
    if (!canEnter) return;
    const channel = supabase
      .channel('show_assignments_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'show_assignments' }, () => {
        qc.invalidateQueries({ queryKey: ['show-assignments'] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [canEnter, qc]);

  const [newAssignProgram, setNewAssignProgram] = useState('');
  const [newAssignSubProgram, setNewAssignSubProgram] = useState('');
  const [newAssignCityId, setNewAssignCityId] = useState('');
  const [newAssignUserId, setNewAssignUserId] = useState('');

  const addAssignment = useMutation({
    mutationFn: async () => {
      if (!currentOrgId) throw new Error('No active organization');
      const { error } = await supabase.from('show_assignments').insert({
        producer_user_id: newAssignUserId,
        program: newAssignProgram,
        sub_program: newAssignSubProgram || null,
        city_id: newAssignCityId || null,
        org_id: currentOrgId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['show-assignments'] });
      setNewAssignProgram('');
      setNewAssignSubProgram('');
      setNewAssignCityId('');
      setNewAssignUserId('');
      toast.success('Assignment added');
    },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to add assignment'),
  });

  const deleteAssignment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('show_assignments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['show-assignments'] });
      toast.success('Assignment removed');
    },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to remove'),
  });

  return (
    <div className="mt-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Production Ownership</CardTitle>
          <CardDescription>
            Map producer users to show scopes for notification routing. The most-specific match wins:
            (program + sub-program + city) beats (program + city) beats (program + sub-program) beats (program only).
            Admins are always fallback recipients.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add assignment form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Producer</Label>
              <Select value={newAssignUserId} onValueChange={setNewAssignUserId}>
                <SelectTrigger><SelectValue placeholder="Select producer…" /></SelectTrigger>
                <SelectContent>
                  {(producerUsers ?? []).map(u => (
                    <SelectItem key={u.user_id} value={u.user_id}>
                      {u.display_name ?? u.user_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Program</Label>
              <Select value={newAssignProgram} onValueChange={(v) => { setNewAssignProgram(v); setNewAssignSubProgram(''); }}>
                <SelectTrigger><SelectValue placeholder="Select program…" /></SelectTrigger>
                <SelectContent>
                  {Array.from(new Set((showProgramSubProgramPairs ?? []).map(p => p.program))).sort().map(prog => (
                    <SelectItem key={prog} value={prog}>{prog}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sub-program (optional)</Label>
              <Select value={newAssignSubProgram || ANY_SCOPE} onValueChange={(v) => setNewAssignSubProgram(v === ANY_SCOPE ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Any sub-program" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_SCOPE}>Any</SelectItem>
                  {Array.from(new Set((showProgramSubProgramPairs ?? []).filter(p => p.program === newAssignProgram).map(p => p.sub_program))).sort().map(sp => (
                    <SelectItem key={sp} value={sp}>{sp}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">City (optional)</Label>
              <Select value={newAssignCityId || ANY_SCOPE} onValueChange={(v) => setNewAssignCityId(v === ANY_SCOPE ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Any city" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_SCOPE}>Any</SelectItem>
                  {(cities ?? []).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={!newAssignUserId || !newAssignProgram || addAssignment.isPending}
              onClick={() => addAssignment.mutate()}
            >
              <Plus className="h-4 w-4 mr-1" />Add
            </Button>
          </div>

          {/* Existing assignments */}
          {(showAssignments?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground pt-2">No assignments yet.</p>
          ) : (
            <div className="space-y-1.5 pt-2">
              {showAssignments!.map((a) => {
                const producer = producerUsers?.find(u => u.user_id === a.producer_user_id);
                const city = cities?.find(c => c.id === a.city_id);
                return (
                  <div key={a.id} className="flex items-center gap-3 text-sm p-2 rounded-md border border-border">
                    <span className="font-medium w-32 shrink-0 truncate">
                      {producer?.display_name ?? a.producer_user_id.slice(0, 8)}
                    </span>
                    <span className="flex-1 text-muted-foreground">
                      {a.program}
                      {a.sub_program ? ` / ${a.sub_program}` : ''}
                      {city ? ` — ${city.name}` : ''}
                    </span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {a.sub_program && a.city_id ? 'Exact' : a.city_id ? 'City' : a.sub_program ? 'Sub' : 'Program'}
                    </Badge>
                    <button
                      onClick={() => deleteAssignment.mutate(a.id)}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                      aria-label="Remove assignment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
