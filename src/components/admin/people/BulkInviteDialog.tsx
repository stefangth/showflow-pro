// src/components/admin/people/BulkInviteDialog.tsx
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { createInvitation, type Invitation } from "@/data/invitations";
import type { OrgMember } from "@/data/members";
import type { AppRole } from "@/config/app.config";
import { parseEmails, isValidEmail, matchContact } from "./peopleMatch";
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
}

type Kind = "invalid" | "member" | "pending" | "ok";

/** Paste multiple emails, pick one role, invite the clean ones; skips are reported. */
export function BulkInviteDialog({ open, onOpenChange, members, invites }: BulkInviteDialogProps) {
  const { currentOrg } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [role, setRole] = useState<AppRole>("artist");
  const [sending, setSending] = useState(false);

  const rows = useMemo(() => {
    return parseEmails(text).map((email) => {
      let kind: Kind = "ok";
      if (!isValidEmail(email)) kind = "invalid";
      else kind = matchContact(email, members, invites) === "member"
        ? "member"
        : matchContact(email, members, invites) === "pending"
          ? "pending"
          : "ok";
      return { email, kind };
    });
  }, [text, members, invites]);

  const okCount = rows.filter((r) => r.kind === "ok").length;

  const submit = async () => {
    if (!currentOrg || okCount === 0) return;
    setSending(true);
    let sent = 0;
    let failed = 0;
    for (const r of rows) {
      if (r.kind !== "ok") continue;
      try {
        await createInvitation(supabase, { orgId: currentOrg.id, email: r.email, role });
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    const skipped = rows.length - okCount;
    setSending(false);
    qc.invalidateQueries({ queryKey: ["org-invitations"] });
    const parts = [`${sent} invited`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (failed > 0) toast.error(parts.join(" · "));
    else toast.success(parts.join(" · "));
    setText("");
    onOpenChange(false);
  };

  const badgeFor = (kind: Kind) =>
    kind === "ok" ? null : (
      <Badge variant="outline" className="text-xs capitalize">
        {kind === "member" ? "already a member" : kind === "pending" ? "already invited" : "invalid"}
      </Badge>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Bulk invite</DialogTitle>
          <DialogDescription>Paste emails separated by commas, spaces, or new lines.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            rows={5}
            placeholder={"alex@email.com\nsam@email.com"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="producer">Producer</SelectItem>
              <SelectItem value="artist">Artist</SelectItem>
            </SelectContent>
          </Select>
          {rows.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-border p-2">
              {rows.map((r) => (
                <div key={r.email} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{r.email}</span>
                  {badgeFor(r.kind)}
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={sending || okCount === 0}>
            {sending ? "Inviting…" : `Invite ${okCount || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
