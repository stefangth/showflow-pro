import { format } from "date-fns";
import { Copy, X, RefreshCw, Mail, Settings as SettingsIcon } from "lucide-react";
import { type AppRole, roleLabel } from "@/config/app.config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { IconTooltip } from "@/components/common/IconTooltip";
import { ROLE_OPTIONS } from "./roleOptions";
import type { Person } from "./peopleMatch";

export interface PersonRowProps {
  person: Person;
  isSelf: boolean;
  onCopyLink: (token: string) => void;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
  onSetRole: (v: { userId: string; role: AppRole; action: "add" | "remove" }) => void;
  onRequestRemove: (t: { user_id: string; email: string | null }) => void;
  resendPending?: boolean;
  revokePending?: boolean;
  setRolePending?: boolean;
}

/** Two-letter initials from a display name (or the local part of an email as a fallback). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Role badges shown for both invited and active rows — one visual language. Rendered in a fixed-width
 * column (always an element so the column is held even with no roles) so the role badges form one
 * vertical band down the whole directory, across both subgroups.
 */
function RoleBadges({ roles }: { roles: AppRole[] }) {
  if (roles.length === 0) return <div className="hidden sm:block sm:w-44" aria-hidden />;
  return (
    <div className="flex flex-wrap items-center gap-1 sm:w-44 sm:justify-end">
      {roles.map((r) => (
        <Badge key={r} variant="secondary" className="border-border/60 font-normal">{roleLabel(r)}</Badge>
      ))}
    </div>
  );
}

/**
 * One person in the merged directory (rendered as a listitem). A leading avatar anchors the row —
 * tone-coloured initials for a member, a muted envelope for a pending invite. Identity stacks above the
 * controls on mobile and sits inline on ≥sm. Role is rendered as badges for BOTH invited and active
 * people; the Invited/Active split is carried by the subgroup headers in PeopleTab, not a per-row pill.
 * Both row types give their trailing controls an equal fixed-width action zone, and the active zone
 * reserves the Remove slot even on the self row — so the role column and the primary action land in one
 * vertical column down every row, in both subgroups. Destructive controls (revoke, remove) use the
 * theme-aware destructive foreground token (--red-600) so they read apart from the neutral copy/resend/
 * roles controls and stay legible in dark mode.
 */
export function PersonRow({
  person, isSelf, onCopyLink, onResend, onRevoke, onSetRole, onRequestRemove,
  resendPending = false, revokePending = false, setRolePending = false,
}: PersonRowProps) {
  const invited = person.status === "invited";
  const inv = person.invitation;
  const hasName = Boolean(person.displayName);
  // On a pending row, append the last-resend so multiple admins can see it was already resent
  // (and how often) — e.g. "Invited 09/08/2026 · Resent 2× · last 10/08/2026 14:30". The
  // timestamp carries the year to match the sibling "Invited"/"Last seen" metas (an invite can
  // sit pending across a year boundary before it's resent, so the year isn't redundant).
  const resentAt = inv?.last_resent_at ? format(new Date(inv.last_resent_at), "dd/MM/yyyy HH:mm") : "";
  const resentMeta = inv?.last_resent_at
    ? ` · ${(inv.resent_count ?? 1) > 1 ? `Resent ${inv.resent_count}× · last ${resentAt}` : `Resent ${resentAt}`}`
    : "";
  const meta = invited
    ? (inv?.created_at ? `Invited ${format(new Date(inv.created_at), "dd/MM/yyyy")}` : "Awaiting acceptance") + resentMeta
    : (person.lastSignInAt ? `Last seen ${format(new Date(person.lastSignInAt), "dd/MM/yyyy HH:mm")}` : "Never signed in");

  return (
    <div role="listitem" className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-4">
      {/* Identity — avatar + text; full width on mobile, flexes on ≥sm */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar aria-hidden className="h-9 w-9">
          {invited
            ? <AvatarFallback><Mail className="h-4 w-4 text-muted-foreground" /></AvatarFallback>
            : <AvatarFallback seed={person.emailKey}>{initials(person.displayName || person.email)}</AvatarFallback>}
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium" title={person.displayName || person.email}>
              {person.displayName || person.email}
            </p>
            {isSelf && (
              <Badge variant="secondary" className="shrink-0 border-border/60 px-1.5 text-[10px] font-medium uppercase tracking-wide">
                You
              </Badge>
            )}
          </div>
          {/* Only render the email as a subtitle when a distinct name occupies the primary line —
              otherwise the primary line already IS the email (no duplicate). */}
          {hasName && (
            <p className="truncate text-xs text-muted-foreground" title={person.email}>{person.email}</p>
          )}
          <p className="truncate text-xs text-muted-foreground">{meta}</p>
        </div>
      </div>

      {/* Roles + actions — wraps under identity on mobile, fixed columns on ≥sm */}
      <div className="flex flex-wrap items-center gap-2 pl-12 sm:flex-nowrap sm:justify-end sm:pl-0">
        <RoleBadges roles={person.roles} />

        {invited && inv ? (
          <div className="flex items-center justify-end gap-1 sm:w-40">
            <IconTooltip label="Copy invite link">
              <Button size="sm" variant="ghost" className="h-9 w-9 p-0 sm:h-8 sm:w-8" onClick={() => onCopyLink(inv.token)} aria-label={`Copy invite link for ${inv.email}`}>
                <Copy className="h-4 w-4" />
              </Button>
            </IconTooltip>
            <IconTooltip label="Resend invitation">
              <Button size="sm" variant="ghost" className="h-9 w-9 p-0 sm:h-8 sm:w-8" disabled={resendPending} onClick={() => onResend(inv.id)} aria-label={`Resend invitation to ${inv.email}`}>
                <RefreshCw className={`h-4 w-4 ${resendPending ? "animate-spin" : ""}`} />
              </Button>
            </IconTooltip>
            <IconTooltip label="Revoke invitation">
              <Button
                size="sm" variant="ghost"
                className="ml-0.5 h-9 w-9 p-0 text-[var(--red-600)] hover:bg-[var(--red-100)] sm:h-8 sm:w-8"
                disabled={revokePending} onClick={() => onRevoke(inv.id)} aria-label={`Revoke invitation for ${inv.email}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </IconTooltip>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1 sm:w-40">
            {person.userId && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-9 gap-1.5 px-2.5 text-xs sm:h-8" aria-label={`Edit roles for ${person.email}`}>
                    <SettingsIcon className="h-4 w-4" />Roles
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>Roles</DropdownMenuLabel>
                  {ROLE_OPTIONS.map((r) => {
                    const has = person.roles.includes(r);
                    return (
                      <DropdownMenuCheckboxItem
                        key={r}
                        checked={has}
                        disabled={setRolePending}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => onSetRole({ userId: person.userId!, role: r, action: has ? "remove" : "add" })}
                      >
                        {roleLabel(r)}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* Reserve the Remove slot even on the self row so Roles stays in column. */}
            <div className="flex sm:w-[4.75rem] sm:justify-end">
              {!isSelf && person.userId && (
                <Button
                  size="sm" variant="ghost"
                  className="h-9 px-2.5 text-xs text-[var(--red-600)] hover:bg-[var(--red-100)] sm:h-8"
                  onClick={() => onRequestRemove({ user_id: person.userId!, email: person.email })}
                  aria-label={`Remove ${person.displayName || person.email}`}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
