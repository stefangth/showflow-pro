import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { StageMark } from '@/components/brand/StageMark';

/**
 * Shown by ProtectedRoute when a signed-in user belongs to no organization.
 * Access is membership (invite-only), so there is nothing to show until an org
 * admin invites them and they accept.
 */
export default function NoOrgScreen() {
  const { user, signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <StageMark variant="tile" size={56} className="mb-6" />
      <h1 className="font-display text-2xl font-semibold tracking-tight">No organization yet</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        {user?.email ? <>You're signed in as <span className="text-foreground">{user.email}</span>, but you're </> : <>You're </>}
        not a member of any organization. Ask an organization admin to invite you by email — once you accept the invitation, you'll land here.
      </p>
      <Button variant="outline" className="mt-6" onClick={signOut}>Sign out</Button>
    </div>
  );
}
