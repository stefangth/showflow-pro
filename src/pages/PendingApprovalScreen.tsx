import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';

export default function PendingApprovalScreen() {
  const { signOut, user } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
              <Clock className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="font-display text-2xl">Awaiting approval</CardTitle>
            <CardDescription>
              Thanks for signing up{user?.email ? `, ${user.email}` : ''}. Your account is being reviewed by an administrator.
              You'll receive an email as soon as it's approved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={signOut}>Sign out</Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
