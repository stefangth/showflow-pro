import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROUTES, APP_META } from '@/config/app.config';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
      navigate(ROUTES.DASHBOARD);
    } catch (err: any) {
      toast({ title: 'Login failed', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <Card className="w-full max-w-md shadow-2xl border-0">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
              <Zap className="h-7 w-7 text-primary-foreground" />
            </div>
            <CardTitle className="font-display text-3xl">{APP_META.NAME}</CardTitle>
            <CardDescription>Sign in to manage your bookings</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Password</label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Don't have an account?{' '}
              <Link to={ROUTES.SIGNUP} className="text-primary hover:underline font-medium">Sign up</Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
