import { useTranslation } from "react-i18next";
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
  /** Whether the viewer may see account-level PII (admins, or producers with the
   *  `resend_account_invite` capability). Others get the status chip only. */
  canSeeAccount: boolean;
  /** Whether the viewer may invite/create (admins, or producers with the capability). */
  canInvite: boolean;
  /** Whether the viewer may resend a pending invite. Defaults to canInvite; ArtistProfileSheet
   *  gates it on the `resend_account_invite` capability (admins always, producers per-org). */
  canResend?: boolean;
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
  state, userId, bookingEmail, account, accountLoading, canSeeAccount, canInvite, canResend = canInvite, onInvite, onResend, inviteBusy,
}: LinkedAccountPanelProps) {
  const { t } = useTranslation("artists");
  const isRegistered = !!userId;
  const effectiveDigestEmail = resolveContactEmail({ authEmail: account?.email, bookingEmail });

  return (
    <div className="space-y-2 rounded-m border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t("linked.title")}</span>
        <AccountStatusChip state={state} />
      </div>

      {state === "none" && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {bookingEmail
              ? t("linked.noLoginWithEmail", { email: bookingEmail })
              : t("linked.noLoginNoEmail")}
          </p>
          {canInvite && (
            <Button size="sm" variant="outline" onClick={onInvite} disabled={inviteBusy}>{t("linked.inviteToApp")}</Button>
          )}
        </div>
      )}

      {state === "invited" && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t("linked.invitePending")}</p>
          {canResend && (
            <Button size="sm" variant="outline" onClick={onResend} disabled={inviteBusy}>{t("linked.resend")}</Button>
          )}
        </div>
      )}

      {isRegistered && canSeeAccount && (
        accountLoading ? (
          <p className="text-sm text-muted-foreground">{t("linked.loadingAccount")}</p>
        ) : account ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("linked.accountName")}</dt>
            <dd>{account.display_name ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("linked.loginEmail")}</dt>
            <dd>{account.email ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("linked.digestGoesTo")}</dt>
            <dd>{effectiveDigestEmail ?? "—"}</dd>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("linked.detailsUnavailable", { email: effectiveDigestEmail ?? t("linked.theBookingEmail") })}
          </p>
        )
      )}
    </div>
  );
}
