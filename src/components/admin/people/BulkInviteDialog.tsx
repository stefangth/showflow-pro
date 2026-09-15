// src/components/admin/people/BulkInviteDialog.tsx
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { type Invitation } from "@/data/invitations";
import type { OrgMember } from "@/data/members";
import { type AppRole, roleLabel } from "@/config/app.config";
import { useOrgKind } from "@/hooks/useOrgKind";
import { useInvitationMutations } from "@/hooks/useInvitationMutations";
import { parseEmails, isValidEmail, matchContact } from "./peopleMatch";
import { ROLE_OPTIONS } from "./roleOptions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface BulkInviteDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: OrgMember[];
  invites: Invitation[];
  /**
   * When set, duplicate detection can't be trusted yet (members/invites still loading,
   * or a query errored); sending is held and this string is shown as the reason, matching
   * InviteBar so the disabled Invite is never unexplained. Null = ready.
   */
  dedupeHint?: string | null;
}

type Kind = "invalid" | "member" | "pending" | "ok";

/** Max invitations sent in parallel per chunk, so a large paste stays bounded. */
const SEND_CONCURRENCY = 5;

/** Paste multiple emails, pick one role, invite the clean ones; skips are reported. */
export function BulkInviteDialog({ open, onOpenChange, members, invites, dedupeHint = null }: BulkInviteDialogProps) {
  const { t } = useTranslation("admin");
  const kind = useOrgKind();
  const dedupeUnready = !!dedupeHint;
  const { currentOrg } = useAuth();
  const { createOne, invalidateInvitations } = useInvitationMutations(currentOrg?.id);
  const [text, setText] = useState("");
  const [role, setRole] = useState<AppRole>("artist");
  const [sending, setSending] = useState(false);

  // Clear the paste + role when the dialog closes so a reopen starts fresh.
  // Adjust-during-render on the open->closed transition instead of a
  // setState-in-effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) { setText(""); setRole("artist"); }
  }

  const rows = useMemo(() => {
    return parseEmails(text).map((email) => {
      let kind: Kind;
      if (!isValidEmail(email)) kind = "invalid";
      else {
        const m = matchContact(email, members, invites);
        kind = m === "member" ? "member" : m === "pending" ? "pending" : "ok";
      }
      return { email, kind };
    });
  }, [text, members, invites]);

  const okCount = rows.filter((r) => r.kind === "ok").length;

  const submit = async () => {
    if (!currentOrg || okCount === 0 || dedupeUnready) return;
    setSending(true);
    const okRows = rows.filter((r) => r.kind === "ok");
    let sent = 0;
    const failedEmails: string[] = [];
    // Send in bounded-concurrency chunks so a large paste doesn't serialize one
    // edge-function round-trip per address, while still capping parallel load.
    for (let i = 0; i < okRows.length; i += SEND_CONCURRENCY) {
      const chunk = okRows.slice(i, i + SEND_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((r) => createOne({ email: r.email, role })),
      );
      results.forEach((res, j) => {
        if (res.status === "fulfilled") sent += 1;
        else failedEmails.push(chunk[j].email);
      });
    }
    const failed = failedEmails.length;
    const skipped = rows.length - okCount;
    setSending(false);
    invalidateInvitations();
    const parts = [t("bulk.invited", { n: sent })];
    if (skipped > 0) parts.push(t("bulk.skipped", { n: skipped }));
    if (failed > 0) parts.push(t("bulk.failed", { n: failed }));
    if (failed > 0) {
      // Keep the dialog open and repopulate it with only the failed addresses so a
      // partial failure is retryable without re-pasting (and re-classifying) the rest.
      toast.error(parts.join(" · "));
      setText(failedEmails.join("\n"));
    } else {
      toast.success(parts.join(" · "));
      setText("");
      onOpenChange(false);
    }
  };

  const badgeFor = (kind: Kind) =>
    kind === "ok" ? null : (
      <Badge variant="outline" className="text-xs">
        {kind === "member" ? t("bulk.badgeMember") : kind === "pending" ? t("bulk.badgeInvited") : t("bulk.badgeInvalid")}
      </Badge>
    );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (sending) return; onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">{t("bulk.title")}</DialogTitle>
          <DialogDescription>{t("bulk.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            rows={5}
            placeholder={t("bulk.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>{roleLabel(r, kind)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rows.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1 rounded-card border border-border p-2">
              {rows.map((r) => (
                <div key={r.email} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{r.email}</span>
                  {badgeFor(r.kind)}
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="sm:items-center">
          {dedupeHint && <p className="text-xs text-muted-foreground sm:mr-auto">{dedupeHint}</p>}
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={sending}>{t("actions.cancel")}</Button>
          <Button onClick={submit} disabled={sending || okCount === 0 || dedupeUnready}>
            {sending ? t("bulk.inviting") : `${t("bulk.invite")} ${okCount || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
