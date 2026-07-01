import { Button } from "@/components/ui/button";
import { resolveContactEmail } from "@/lib/identity";
import { type AccountState } from "@/lib/artistAccount";
import { AccountStatusChip } from "./AccountStatusChip";

interface LinkedAccountPanelProps {
  /** Three-state account status (shared vocabulary). */
  state: AccountState;
  /** artists.user_id — null/undefined means unregistered. */
  userId: string | null | undefined;
  /** artists.email — the booking contact (may be null). */
  bookingEmail: string | null | undefined;
  /** The linked login account; pass only when the viewer is an admin and the member was found. */
  account?: { email: string | null; display_name: string | null };
  /** True while the admin account lookup is in flight. */
  accountLoading?: boolean;
  /** Whether the viewer may see account-level PII (admins). Producers get the status only. */
  canSeeAccount: boolean;
  /** Whether the viewer may invite/resend (admins). */
  canInvite: boolean;
  onInvite?: () => void;
  onResend?: () => void;
  inviteBusy?: boolean;
}

/**
 * Read-only "Linked account" section for ArtistProfileSheet (ADR-0011). One status
 * vocabulary (ACCOUNT_STATE_META) shared with the card chip; admins additionally see
 * the effective digest recipient and an Invite/Resend action.
 */
export function LinkedAccountPanel({
  state, userId, bookingEmail, account, accountLoading, canSeeAccount, canInvite, onInvite, onResend, inviteBusy,
}: LinkedAccountPanelProps) {
  const isRegistered = !!userId;
  const effectiveDigestEmail = resolveContactEmail({ authEmail: account?.email, bookingEmail });

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Linked account</span>
        <AccountStatusChip state={state} />
      </div>

      {state === "none" && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            No login account. Digests use the booking email{bookingEmail ? ` (${bookingEmail})` : ""}.
          </p>
          {canInvite && (
            <Button size="sm" variant="outline" onClick={onInvite} disabled={inviteBusy}>Invite to app</Button>
          )}
        </div>
      )}

      {state === "invited" && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Invite pending — awaiting acceptance.</p>
          {canInvite && (
            <Button size="sm" variant="outline" onClick={onResend} disabled={inviteBusy}>Resend</Button>
          )}
        </div>
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
