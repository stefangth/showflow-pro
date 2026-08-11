import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { StageMark } from '@/components/brand/StageMark';
import { APP_META } from '@/config/app.config';

/**
 * Prefix/suffix halves of the platform-team contact line, cut at the `{{email}}`
 * placeholder in this ONE source template rather than by searching the composed sentence
 * for the address's own value — so the split point is fixed at authoring time and can
 * never land in the wrong place even if a future address happened to recur elsewhere in
 * the wording. APP_META.SUPPORT_EMAIL ships null today (setting a real address is an owner
 * decision), so the line is dark in production.
 */
const SUPPORT_CONTACT_LINE_TEMPLATE = "Your admin can reach the platform team at {{email}}.";
const [SUPPORT_CONTACT_LINE_PREFIX, SUPPORT_CONTACT_LINE_SUFFIX] = SUPPORT_CONTACT_LINE_TEMPLATE.split("{{email}}");

/**
 * The contact-line paragraph, isolated from SuspendedOrgScreen so both branches
 * (an address configured, or not) are directly testable without depending on
 * APP_META's current value. SuspendedOrgScreen always renders it with
 * APP_META.SUPPORT_EMAIL; only tests pass anything else.
 */
export function SupportContactLine({ email }: { email: string | null }) {
  if (!email) return null;
  return (
    <p className="mt-1 max-w-md text-sm text-muted-foreground">
      {SUPPORT_CONTACT_LINE_PREFIX}
      <a href={`mailto:${email}`} className="underline hover:text-foreground">
        {email}
      </a>
      {SUPPORT_CONTACT_LINE_SUFFIX}
    </p>
  );
}

/**
 * Shown by ProtectedRoute when the active organization is suspended. Data is
 * intact but the org is temporarily unavailable to its members. A multi-org user
 * can switch to another (non-suspended) org, or reach the platform team directly
 * when a support address is configured (their own org's admins may themselves be
 * unreachable while the org is suspended).
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
      <SupportContactLine email={APP_META.SUPPORT_EMAIL} />
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
