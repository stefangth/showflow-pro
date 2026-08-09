import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES, APP_META } from '@/config/app.config';
import { useConsent } from '@/features/consent/ConsentContext';
import { motion, useReducedMotion } from 'framer-motion';
import { StageMark } from '@/components/brand/StageMark';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { requestLoginLink } from '@/data/authLinks';
import { supabase } from '@/integrations/supabase/client';
import heroShow from '@/assets/auth/hero-show.jpg';

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
  const [linkSending, setLinkSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const { signIn } = useAuth();
  const { openPreferences } = useConsent();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reduce = useReducedMotion();

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
    } catch (err) {
      setError(friendlyAuthError((err as Error).message ?? 'Something went wrong. Please try again.'));
      setPassword('');
      requestAnimationFrame(() => emailRef.current?.focus());
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const onEmailLink = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email address first.');
      emailRef.current?.focus();
      return;
    }
    setLinkSending(true);
    const sent = 'If that email exists, a sign-in link is on its way.';
    try {
      await requestLoginLink(supabase, trimmed, window.location.origin);
      toast.success(sent);
    } catch {
      // Keep the confirmation oracle-safe: identical whether or not the address exists,
      // and on a server fault (the spec's locked no-enumeration decision).
      toast.success(sent);
    } finally {
      setLinkSending(false);
    }
  };

  return (
    // `dark` forces the immersive treatment regardless of the viewer's theme, so
    // the form primitives (Input/Button/Alert) inherit dark tokens automatically.
    <div className="dark relative min-h-screen w-full overflow-hidden bg-[var(--auth-bg)]">
      {/* Base dusk gradient (--auth-hero-gradient in index.css) — instant paint + photo fallback. */}
      <div aria-hidden className="absolute inset-0" style={{ background: 'var(--auth-hero-gradient)' }} />

      {/* Hero photo — brightens/settles in on mount; static when reduced motion. */}
      <motion.img
        src={heroShow}
        alt=""
        loading="eager"
        decoding="async"
        initial={reduce ? false : { opacity: 0, scale: 1.06, filter: 'brightness(0.45)' }}
        animate={{ opacity: 1, scale: 1, filter: 'brightness(1)' }}
        transition={{ duration: reduce ? 0 : 1.1, ease: 'easeOut' }}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: '62% 50%' }}
      />

      {/* Left-weighted scrim for legibility + a soft top fade. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'var(--auth-scrim)' }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-40"
        style={{ background: 'var(--auth-top-fade)' }}
      />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col">
        <main className="flex flex-1 items-center px-6 py-12 sm:px-10 lg:px-20">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.6, ease: 'easeOut', delay: reduce ? 0 : 0.1 }}
            className="w-full max-w-md"
          >
            {/* Wordmark */}
            <div className="mb-7 flex items-center gap-3">
              <StageMark variant="tile" size={36} />
              <span className="font-display text-lg font-semibold tracking-tight text-[var(--auth-fg)]">
                {APP_META.NAME}
              </span>
            </div>

            {/* Headline over the photo */}
            <h1 className="mb-7 max-w-sm text-balance font-display text-3xl font-semibold leading-[1.15] tracking-tight text-[var(--auth-fg)] sm:text-[34px]">
              Casting, scheduling and confirmations, all in one place.
            </h1>

            {/* Frosted glass sign-in card */}
            <div className="rounded-2xl border border-[var(--auth-hairline)] bg-[var(--auth-card)] p-6 text-foreground shadow-2xl backdrop-blur-xl sm:p-7">
              <div className="mb-5">
                <h2 className="text-lg font-semibold">Sign in</h2>
                <p className="mt-1 text-sm text-muted-foreground">Manage your bookings</p>
              </div>

              <Alert
                variant="destructive"
                aria-live="assertive"
                aria-atomic="true"
                className={cn('mb-4', !error && 'hidden')}
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
                <Button type="submit" className="w-full" disabled={loading || linkSending}>
                  {loading ? 'Signing in...' : 'Sign in'}
                </Button>
                {/* Gap the hairline around the label instead of knocking out a filled chip:
                    over the translucent card a card-colored fill would compound and darken. */}
                <div className="my-1 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-[var(--auth-hairline)]" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <span className="h-px flex-1 bg-[var(--auth-hairline)]" />
                </div>
                <Button type="button" variant="default" className="w-full" disabled={loading || linkSending} onClick={onEmailLink}>
                  {linkSending ? 'Sending...' : 'Email me a sign-in link'}
                </Button>
                <div className="mt-3 text-center">
                  <Link
                    to={ROUTES.RESET_PASSWORD}
                    className="inline-block py-2.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Forgot password?
                  </Link>
                </div>
              </form>

              <div className="mt-5 space-y-2 border-t border-[var(--auth-hairline)] pt-4">
                <p className="text-center text-xs text-muted-foreground">
                  New here?{' '}
                  <a
                    href={`${APP_META.MARKETING_URL}/signup`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Book a demo
                  </a>
                </p>
                <p className="text-center text-xs text-muted-foreground">
                  <Link to={ROUTES.PRIVACY} className="underline-offset-2 hover:text-foreground hover:underline">
                    Privacy
                  </Link>
                  {' · '}
                  <Link to={ROUTES.IMPRESSUM} className="underline-offset-2 hover:text-foreground hover:underline">
                    Impressum
                  </Link>
                  {' · '}
                  <button
                    onClick={openPreferences}
                    className="underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Cookie settings
                  </button>
                </p>
              </div>
            </div>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
