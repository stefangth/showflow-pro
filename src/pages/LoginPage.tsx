import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES, APP_META } from '@/config/app.config';
import { useConsent } from '@/features/consent/ConsentContext';
import { motion } from 'framer-motion';
import { StageMark } from '@/components/brand/StageMark';

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'The email or password is incorrect. Please try again.';
  }
  if (m.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in. Check your inbox for the confirmation link.';
  }
  if (m.includes('rate') || m.includes('too many')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (m.includes('network') || m.includes('failed to fetch')) {
    return 'Network error. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const { signIn } = useAuth();
  const { openPreferences } = useConsent();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
      // Honor a relative ?redirect= (e.g. the accept-invite flow); never an absolute/external URL.
      const redirect = searchParams.get('redirect');
      navigate(redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : ROUTES.DASHBOARD);
    } catch (err: any) {
      setError(friendlyAuthError(err?.message ?? 'Something went wrong. Please try again.'));
      setPassword('');
      requestAnimationFrame(() => emailRef.current?.focus());
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto">
              <StageMark variant="tile" size={52} />
            </div>
            <CardTitle className="font-display text-[26px] font-semibold tracking-tight">{APP_META.NAME}</CardTitle>
            <CardDescription>Sign in to manage your bookings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert
              variant="destructive"
              aria-live="assertive"
              aria-atomic="true"
              className={!error ? 'hidden' : ''}
            >
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error ?? ''}</AlertDescription>
            </Alert>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <Input
                  id="email"
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (error) setError(null); }}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">Password</label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); if (error) setError(null); }}
                  placeholder="••••••••"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>

            <p className="text-center text-xs text-muted-foreground">
              New here?{' '}
              <a
                href="https://showflow.pro/signup"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-foreground hover:text-primary"
              >
                Book a demo
              </a>
            </p>
            <p className="text-center text-xs text-muted-foreground">
              <Link to={ROUTES.PRIVACY} className="underline hover:text-foreground">
                Privacy
              </Link>
              {' · '}
              <Link to={ROUTES.IMPRESSUM} className="underline hover:text-foreground">
                Impressum
              </Link>
              {' · '}
              <button onClick={openPreferences} className="underline hover:text-foreground">
                Cookie settings
              </button>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
