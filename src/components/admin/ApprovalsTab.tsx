import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AppRole } from '@/config/app.config';

type ApprovalRow = {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  requested_role: AppRole;
  rejection_reason: string | null;
  created_at: string;
};

export function ApprovalsTab() {
  const qc = useQueryClient();
  const [roleByUser, setRoleByUser] = useState<Record<string, AppRole>>({});
  const [rejectFor, setRejectFor] = useState<ApprovalRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: approvals, isLoading } = useQuery({
    queryKey: ['user-approvals', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_approvals')
        .select('id, user_id, email, display_name, status, requested_role, rejection_reason, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ApprovalRow[];
    },
  });

  // Realtime: refetch on any change
  useEffect(() => {
    const channel = supabase
      .channel('approvals-tab')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_approvals' }, () => {
        qc.invalidateQueries({ queryKey: ['user-approvals'] });
        qc.invalidateQueries({ queryKey: ['admin-iam-users'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const decide = useMutation({
    mutationFn: async (vars: { approval: ApprovalRow; decision: 'approved' | 'rejected'; role?: AppRole; reason?: string }) => {
      const { data, error } = await supabase.functions.invoke('admin-decide-approval', {
        body: {
          approval_id: vars.approval.id,
          decision: vars.decision,
          role: vars.role ?? vars.approval.requested_role,
          rejection_reason: vars.reason ?? null,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.decision === 'approved' ? 'User approved' : 'User rejected');
      qc.invalidateQueries({ queryKey: ['user-approvals'] });
      qc.invalidateQueries({ queryKey: ['admin-iam-users'] });
      setRejectFor(null);
      setRejectReason('');
      setPendingId(null);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed');
      setPendingId(null);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Pending approvals</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : approvals && approvals.length > 0 ? (
          <div className="space-y-3">
            {approvals.map(a => {
              const role = roleByUser[a.user_id] ?? a.requested_role;
              const isBusy = pendingId === a.id;
              return (
                <div key={a.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-border">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{a.display_name || a.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{a.email}</p>
                    <p className="text-xs text-muted-foreground mt-1">Requested {format(new Date(a.created_at), 'dd/MM/yyyy HH:mm')}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={role} onValueChange={(v) => setRoleByUser(s => ({ ...s, [a.user_id]: v as AppRole }))}>
                      <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="artist">Artist</SelectItem>
                        <SelectItem value="producer">Producer</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={isBusy}
                      onClick={() => { setPendingId(a.id); decide.mutate({ approval: a, decision: 'approved', role }); }}
                    >
                      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      <span className="ml-1">Approve</span>
                    </Button>
                    <Button size="sm" variant="outline" disabled={isBusy} onClick={() => setRejectFor(a)}>
                      <X className="h-3 w-3" /> <span className="ml-1">Reject</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No pending approvals</p>
        )}
      </CardContent>

      <Dialog open={!!rejectFor} onOpenChange={(o) => { if (!o) { setRejectFor(null); setRejectReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject signup</DialogTitle>
            <DialogDescription>
              {rejectFor ? `Reject ${rejectFor.display_name || rejectFor.email}? You can add an optional reason that will be emailed to them.` : ''}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectFor(null); setRejectReason(''); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!rejectFor) return;
                setPendingId(rejectFor.id);
                decide.mutate({ approval: rejectFor, decision: 'rejected', reason: rejectReason || undefined });
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
