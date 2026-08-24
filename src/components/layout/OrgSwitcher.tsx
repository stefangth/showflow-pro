import { useAuth } from '@/features/auth/AuthContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isOrgSuspended } from '@/lib/orgs';

/**
 * Sidebar organization switcher. Renders nothing when there is no active org,
 * a static label for single-org users, and a switcher popover for multi-org users.
 */
export function OrgSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { orgs, currentOrg, switchOrg } = useAuth();
  if (!currentOrg) return null;

  // Single org → static label (collapsed: hidden to save space).
  if (orgs.length <= 1) {
    if (collapsed) return null;
    return (
      <div className="flex items-center gap-2 rounded-field px-2.5 py-2 text-control font-medium text-sidebar-foreground/80">
        <Building2 className="h-[14px] w-[14px] shrink-0" />
        <span className="truncate">{currentOrg.name}</span>
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Switch organization"
          className={cn(
            // This control sits on the sidebar, so it has to wear sidebar tokens.
            // `secondary` ships the page-card surface (--card / --border / elev1),
            // which diverges from --sidebar-background in BOTH modes and in
            // opposite directions: lighter in light, darker in dark. Clearing the
            // fill lets it inherit the sidebar in every theme. The hairline border
            // stays, so the control keeps the affordance a text label needs
            // (see ADR 0012 D2 in components/ui/button.tsx).
            'w-full justify-between gap-2 px-2.5 py-2 h-auto text-control font-medium text-sidebar-foreground/80',
            'bg-transparent border-sidebar-border shadow-none',
            'hover:bg-hover-tint hover:text-sidebar-foreground active:bg-hover-tint',
            collapsed && 'justify-center px-0',
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            <Building2 className="h-[14px] w-[14px] shrink-0" />
            {!collapsed && <span className="truncate">{currentOrg.name}</span>}
          </span>
          {!collapsed && <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {orgs.map((o) => (
          <button
            key={o.id}
            onClick={() => switchOrg(o.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-hover-tint text-left"
          >
            <Check className={cn('h-4 w-4 shrink-0', o.id === currentOrg.id ? 'opacity-100' : 'opacity-0')} />
            <span className="truncate">{o.name}</span>
            {isOrgSuspended(o) && <span className="ml-auto text-eyebrow text-muted-foreground">suspended</span>}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
