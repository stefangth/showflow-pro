import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchOrgMembers, removeOrgMember } from "@/data/members";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

/** Super-admin per-org member removal (reuses the org member data layer; RPC guards apply). */
export function OrgMembersPopover({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data: members } = useQuery({
    queryKey: ["members", orgId],
    queryFn: () => fetchOrgMembers(supabase, orgId),
    enabled: open,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeOrgMember(supabase, orgId, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["members", orgId] }); qc.invalidateQueries({ queryKey: ["platform"] }); toast.success("Member removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label="Members"><Users className="h-3.5 w-3.5" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 space-y-2">
        {(members ?? []).length === 0 && <p className="text-sm text-muted-foreground px-1 py-2">No members</p>}
        {(members ?? []).map((m) => (
          <div key={m.user_id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{m.display_name || m.email}</span>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => remove.mutate(m.user_id)}>Remove</Button>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
