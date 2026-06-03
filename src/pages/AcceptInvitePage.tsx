import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { acceptInvitation } from '@/data/invitations';
import { ROUTES } from '@/config/app.config';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StageMark } from '@/components/brand/StageMark';
import { toast } from 'sonner';

function friendlyAcceptError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('different email')) {
    return 'This invitation was sent to a different email address. Sign in with that address to accept it.';
  }
  if (m.includes('expired') || m.includes('invalid')) {
    return 'This invitation is invalid or has expired. Ask your organization admin to send a new one.';
  }
  if (m.includes('not authenticated')) {
    return 'Please sign in to accept this invitation.';
  }
  return 'Could not accept the invitation. Please try again, or ask for a new invite.';
}

/**
 * Public route. Accepts an org invitation by token. If the visitor is not signed
 * in, it bounces to /login and returns here afterward; once authenticated it calls
 * accept_invitation, switches to the new org, and lands on the dashboard.
 */
export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { user, loading, switchOrg } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!token) {
      setError('This invitation link is missing its token.');
      return;
    }
    if (!user) {
      const back = `${ROUTES.ACCEPT_INVITE}?token=${token}`;
      navigate(`${ROUTES.LOGIN}?redirect=${encodeURIComponent(back)}`, { replace: true });
      return;
    }
    if (ran.current) return;
    ran.current = true;
    acceptInvitation(supabase, token)
      .then((orgId) => {
        switchOrg(orgId);
        toast.success('Invitation accepted');
        navigate(ROUTES.DASHBOARD, { replace: true });
      })
      .catch((e: unknown) => {
        setError(friendlyAcceptError((e as Error)?.message ?? ''));
      });
  }, [loading, user, token, navigate, switchOrg]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto"><StageMark variant="tile" size={52} /></div>
          <CardTitle className="font-display text-2xl font-semibold tracking-tight">Accept invitation</CardTitle>
          <CardDescription>
            {error ? "We couldn't accept this invitation" : 'Joining your organization…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {error ? (
            <>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" onClick={() => navigate(ROUTES.DASHBOARD)}>Go to dashboard</Button>
            </>
          ) : (
            <div className="flex justify-center py-4">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
