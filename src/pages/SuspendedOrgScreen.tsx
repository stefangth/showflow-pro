import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { StageMark } from '@/components/brand/StageMark';

/**
 * Shown by ProtectedRoute when the active organization is suspended. Data is
 * intact but the org is temporarily unavailable to its members. A multi-org user
 * can switch to another (non-suspended) org.
 */
export default function SuspendedOrgScreen() {
  const { currentOrg, orgs, switchOrg, signOut } = useAuth();
  const others = orgs.filter((o) => o.id !== currentOrg?.id && o.status !== 'suspended');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <StageMark variant="tile" size={56} className="mb-6" />
      <h1 className="font-display text-2xl font-semibold tracking-tight">Organization suspended</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        <span className="text-foreground">{currentOrg?.name ?? 'This organization'}</span> is currently suspended.
        Your data is safe, but it's temporarily unavailable. Please contact your platform administrator.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {others.length > 0 && (
          <Button variant="outline" onClick={() => switchOrg(others[0].id)}>
            Switch to {others[0].name}
          </Button>
        )}
        <Button variant="ghost" onClick={signOut}>Sign out</Button>
      </div>
    </div>
  );
}
