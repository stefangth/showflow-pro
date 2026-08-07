import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { fetchOrgInvitations, createInvitation, revokeInvitation, resendInvitation, acceptInviteUrl } from '@/data/invitations';
import type { AppRole } from '@/config/app.config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconTooltip } from '@/components/common/IconTooltip';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, X, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

/** Org-admin invite management: send invites, list them, copy the accept link, revoke. */
export function InvitesTab() {
  const { currentOrg } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('artist');

  const { data: invites } = useQuery({
    queryKey: ['org-invitations', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchOrgInvitations(supabase, currentOrg!.id),
  });

  const create = useMutation({
    mutationFn: () => createInvitation(supabase, { orgId: currentOrg!.id, email: email.trim(), role }),
    onSuccess: () => {
      setEmail('');
      qc.invalidateQueries({ queryKey: ['org-invitations'] });
      toast.success('Invitation sent');
    },
    onError: (e: Error) => toast.error(e?.message ?? 'Could not send invitation'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(supabase, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-invitations'] });
      toast.success('Invitation revoked');
    },
    onError: (e: Error) => toast.error(e?.message ?? 'Could not revoke invitation'),
  });

  const resend = useMutation({
    mutationFn: (id: string) => resendInvitation(supabase, id),
    onSuccess: () => toast.success('Invitation re-sent'),
    onError: (e: Error) => toast.error(e?.message ?? 'Could not resend invitation'),
  });

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard?.writeText(acceptInviteUrl(token));
      toast.success('Invite link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Invitations</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = email.trim();
            if (!currentOrg) return;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { toast.error('Enter a valid email address'); return; }
            create.mutate();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <Input
            type="email"
            placeholder="invitee@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="producer">Producer</SelectItem>
              <SelectItem value="artist">Artist</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={create.isPending || !email.trim() || !currentOrg}>Invite</Button>
        </form>

        <div className="space-y-2">
          {(invites ?? []).map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{inv.email}</p>
                <p className="text-xs text-muted-foreground capitalize">{inv.role} · {inv.status}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {inv.status === 'pending' ? (
                  <>
                    <IconTooltip label="Copy invite link">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copyLink(inv.token)} aria-label="Copy invite link">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </IconTooltip>
                    <IconTooltip label="Resend invitation">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => resend.mutate(inv.id)} aria-label="Resend invitation">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </IconTooltip>
                    <IconTooltip label="Revoke invitation">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => revoke.mutate(inv.id)} aria-label="Revoke invitation">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </IconTooltip>
                  </>
                ) : (
                  <Badge variant="outline" className="text-xs capitalize">{inv.status}</Badge>
                )}
              </div>
            </div>
          ))}
          {invites?.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No invitations yet — invite a teammate above.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
