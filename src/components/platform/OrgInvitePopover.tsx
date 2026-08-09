import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchOrgInvitations, revokeInvitation, resendInvitation, createInvitation } from "@/data/invitations";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail } from "lucide-react";
import { type AppRole, roleLabel } from "@/config/app.config";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OrgInvitePopover({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("artist");
  const qc = useQueryClient();
  const { data: invites } = useQuery({
    queryKey: ["platform", "org-invites", orgId],
    queryFn: () => fetchOrgInvitations(supabase, orgId),
    enabled: open,
  });
  const pending = (invites ?? []).filter((i) => i.status === "pending");

  const create = useMutation({
    mutationFn: () => createInvitation(supabase, { orgId, email: email.trim(), role }),
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["platform", "org-invites", orgId] });
      toast.success("Invitation sent");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resend = useMutation({
    mutationFn: (id: string) => resendInvitation(supabase, id),
    onSuccess: () => toast.success("Invitation re-sent"),
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(supabase, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform", "org-invites", orgId] }); toast.success("Invitation revoked"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label="Invitations"><Mail className="h-3.5 w-3.5" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 space-y-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = email.trim();
            if (!EMAIL_RE.test(value)) { toast.error("Enter a valid email address"); return; }
            create.mutate();
          }}
          className="flex flex-col gap-1.5 pb-2 mb-1 border-b border-border"
        >
          <Input
            type="email"
            placeholder="invitee@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-8 text-sm"
            required
          />
          <div className="flex gap-1.5">
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{roleLabel("admin")}</SelectItem>
                <SelectItem value="producer">{roleLabel("producer")}</SelectItem>
                <SelectItem value="artist">{roleLabel("artist")}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="submit"
              size="sm"
              className="h-8 px-3 text-xs shrink-0"
              disabled={create.isPending || !email.trim()}
            >
              Invite
            </Button>
          </div>
        </form>
        {pending.length === 0 && <p className="text-sm text-muted-foreground px-1 py-2">No pending invitations</p>}
        {pending.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{i.email}</span>
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => resend.mutate(i.id)}>Resend</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => revoke.mutate(i.id)}>Revoke</Button>
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
