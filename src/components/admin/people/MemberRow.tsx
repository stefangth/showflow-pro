import { format } from "date-fns";
import { Check, Settings as SettingsIcon } from "lucide-react";
import type { AppRole } from "@/config/app.config";
import type { OrgMember } from "@/data/members";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ROLE_OPTIONS } from "./roleOptions";

export interface MemberRowProps {
  member: OrgMember;
  isSelf: boolean;
  onSetRole: (v: { userId: string; role: AppRole; action: "add" | "remove" }) => void;
  setRolePending: boolean;
  onRequestRemove: (t: { user_id: string; email: string | null }) => void;
}

/** One org member: role badges, Active pill, role editor popover, remove trigger. */
export function MemberRow({ member: m, isSelf, onSetRole, setRolePending, onRequestRemove }: MemberRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border">
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{m.display_name || m.email}</p>
        <p className="text-xs text-muted-foreground truncate">{m.email}</p>
        <p className="text-xs text-muted-foreground">
          {m.last_sign_in_at ? `Last seen ${format(new Date(m.last_sign_in_at), "dd/MM/yyyy HH:mm")}` : "Never signed in"}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="secondary" className="text-xs">Active</Badge>
        {m.roles.map((r) => <Badge key={r} variant="secondary" className="text-xs capitalize">{r}</Badge>)}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" aria-label={`Edit roles for ${m.email}`}>
              <SettingsIcon className="h-3 w-3 mr-1" />Roles
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="end">
            {ROLE_OPTIONS.map((r) => {
              const has = m.roles.includes(r);
              return (
                <button
                  key={r}
                  disabled={setRolePending}
                  onClick={() => onSetRole({ userId: m.user_id, role: r, action: has ? "remove" : "add" })}
                  className="flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-muted text-left capitalize disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className={cn("h-4 w-4 mr-2", has ? "opacity-100" : "opacity-0")} />
                  {r}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
        <Button
          size="sm" variant="ghost" className="h-7 px-2 text-xs"
          disabled={isSelf}
          onClick={() => onRequestRemove({ user_id: m.user_id, email: m.email })}
        >
          {isSelf ? "You" : "Remove"}
        </Button>
      </div>
    </div>
  );
}
