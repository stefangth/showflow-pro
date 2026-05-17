import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { ShieldX } from 'lucide-react';

export default function RejectedScreen() {
  const { signOut, approvalReason } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-destructive/10">
              <ShieldX className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle className="font-display text-2xl">Access denied</CardTitle>
            <CardDescription>
              Your signup request was not approved.
              {approvalReason ? <span className="block mt-2 text-foreground">Reason: {approvalReason}</span> : null}
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
