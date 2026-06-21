import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type State =
  | { kind: 'loading' }
  | { kind: 'valid' }
  | { kind: 'already' }
  | { kind: 'invalid'; message: string }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'invalid', message: 'Missing unsubscribe token.' });
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON_KEY } },
        );
        const data = await res.json();
        if (!res.ok) {
          setState({ kind: 'invalid', message: data.error || 'Invalid token.' });
          return;
        }
        if (data.valid === false && data.reason === 'already_unsubscribed') {
          setState({ kind: 'already' });
          return;
        }
        setState({ kind: 'valid' });
      } catch (e) {
        setState({ kind: 'invalid', message: (e as Error).message });
      }
    })();
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setState({ kind: 'submitting' });
    try {
      const { data, error } = await supabase.functions.invoke('handle-email-unsubscribe', {
        body: { token },
      });
      if (error) throw error;
      if (data?.success === false && data?.reason === 'already_unsubscribed') {
        setState({ kind: 'already' });
        return;
      }
      setState({ kind: 'done' });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-8 space-y-6 text-center">
        <h1 className="font-display text-[26px] font-semibold tracking-tight">Email preferences</h1>

        {state.kind === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p>Validating your unsubscribe link…</p>
          </div>
        )}

        {state.kind === 'valid' && (
          <>
            <p className="text-muted-foreground">
              Click below to unsubscribe from ShowFlow emails. You can still
              receive critical account-related messages.
            </p>
            <Button onClick={confirm} className="w-full">
              Confirm unsubscribe
            </Button>
          </>
        )}

        {state.kind === 'submitting' && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p>Updating your preferences…</p>
          </div>
        )}

        {state.kind === 'done' && (
          <div className="flex flex-col items-center gap-3 text-foreground">
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <p>You've been unsubscribed. Sorry to see you go.</p>
          </div>
        )}

        {state.kind === 'already' && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <p>You're already unsubscribed — no further action needed.</p>
          </div>
        )}

        {state.kind === 'invalid' && (
          <div className="flex flex-col items-center gap-3 text-destructive">
            <XCircle className="h-10 w-10" />
            <p>{state.message}</p>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="flex flex-col items-center gap-3 text-destructive">
            <XCircle className="h-10 w-10" />
            <p>Something went wrong: {state.message}</p>
          </div>
        )}
      </Card>
    </main>
  );
}
