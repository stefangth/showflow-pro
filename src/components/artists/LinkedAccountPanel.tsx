import { Badge } from "@/components/ui/badge";
import { resolveContactEmail } from "@/lib/identity";

interface LinkedAccountPanelProps {
  /** artists.user_id — null/undefined means unregistered (external talent, no login). */
  userId: string | null | undefined;
  /** artists.email — the booking contact (may be null). */
  bookingEmail: string | null | undefined;
  /** The linked login account; pass only when the viewer is an admin and the member was found. */
  account?: { email: string | null; display_name: string | null };
  /** True while the admin account lookup is in flight. */
  accountLoading?: boolean;
  /** Whether the viewer may see account-level PII (admins). Producers get the badge only. */
  canSeeAccount: boolean;
}

/**
 * Read-only "Linked account" section for ArtistProfileSheet (ADR-0011). Surfaces
 * whether a talent record is tied to a login account and — for admins — the
 * effective digest recipient (digests prefer the login email; see _shared/identity).
 */
export function LinkedAccountPanel({
  userId,
  bookingEmail,
  account,
  accountLoading,
  canSeeAccount,
}: LinkedAccountPanelProps) {
  const isRegistered = !!userId;
  const effectiveDigestEmail = resolveContactEmail({ authEmail: account?.email, bookingEmail });

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Linked account</span>
        <Badge variant={isRegistered ? "secondary" : "outline"}>
          {isRegistered ? "Registered" : "Unregistered — external"}
        </Badge>
      </div>

      {!isRegistered && (
        <p className="text-sm text-muted-foreground">
          No login account. Digests use the booking email{bookingEmail ? ` (${bookingEmail})` : ""}.
        </p>
      )}

      {isRegistered && canSeeAccount && (
        accountLoading ? (
          <p className="text-sm text-muted-foreground">Loading account…</p>
        ) : account ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Account name</dt>
            <dd>{account.display_name ?? "—"}</dd>
            <dt className="text-muted-foreground">Login email</dt>
            <dd>{account.email ?? "—"}</dd>
            <dt className="text-muted-foreground">Digest goes to</dt>
            <dd>{effectiveDigestEmail ?? "—"}</dd>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            Account details unavailable. Digests go to {effectiveDigestEmail ?? "the booking email"}.
          </p>
        )
      )}
    </div>
  );
}
