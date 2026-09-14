import { Building2, ChevronUp, Eye, Pencil, Settings, User, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Token } from '@/components/ui/token';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconTooltip } from '@/components/common/IconTooltip';
import { useAuth } from '@/features/auth/AuthContext';
import { cn } from '@/lib/utils';
import { ROUTES, type AppRole, roleLabel } from '@/config/app.config';
import { supabase } from '@/integrations/supabase/client';
import { isOrgSuspended, orgOptionLabel } from '@/lib/orgs';
import { useEditor } from './EditorContext';
import { isImpersonating } from '@/features/auth/orgRoles';
import { canUseEditor } from './editorAccess';
import { EditorSidePanel } from './EditorSidePanel';

interface IamUser {
  id: string;
  email: string | null;
  roles: AppRole[];
}

export function EditorToolbar() {
  const { viewAsRole, setViewAsRole, viewAsUser, setViewAsUser, currentOrg, orgs, switchOrg, isSuperAdmin } = useAuth();
  const { isEditorMode, disableEditorMode, isToolbarHidden, hideToolbar, isSidePanelOpen, setSidePanelOpen } = useEditor();

  const canEdit = canUseEditor(isSuperAdmin);

  // Exiting editor mode means becoming yourself again: drop any active "view as"
  // preview so a leftover impersonation can't silently outlive the toolbar. Hiding
  // the bar (below) deliberately does NOT do this — it keeps the preview alive.
  const exitEditor = () => {
    setViewAsRole(null);
    setViewAsUser(null);
    disableEditorMode();
  };

  const { data: iamUsers } = useQuery({
    queryKey: ['admin-iam-users', currentOrg?.id],
    enabled: canEdit && isEditorMode,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-list-users', {
        body: { org_id: currentOrg?.id },
      });
      if (error) throw error;
      return ((data?.users ?? []) as IamUser[])
        .filter(u => u.email)
        .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
    },
    staleTime: 60_000,
  });

  // The topbar EditorModeToggle is the single entry point into editor mode
  // (see below); this toolbar has nothing to show until editor mode is
  // actually on, so it renders nothing rather than a second, redundant
  // "enter editor mode" affordance. When the bar is hidden (but editor mode
  // is still on) it also renders nothing — the topbar pencil brings it back.
  if (!canEdit || !isEditorMode || isToolbarHidden) return null;

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2 bg-warning/10 border-b border-warning/30 text-sm shrink-0">
        <Badge variant="outline" className="border-warning text-warning gap-1.5 shrink-0">
          <Pencil className="h-3 w-3" />
          Editor Mode
        </Badge>

        <Separator orientation="vertical" className="h-5 bg-warning/30" />

        {orgs.length > 1 && (
          <div className="flex items-center gap-2 shrink-0">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground text-xs">Org:</span>
            <Select
              // `?? ''` keeps the Select controlled; passing undefined would hand it
              // back to Radix as uncontrolled. currentOrg falls back to orgs[0], so the
              // empty case is unreachable today — the placeholder is there so it reads
              // as an empty state rather than a blank trigger if that ever changes.
              value={currentOrg?.id ?? ''}
              // switchOrg clears the impersonated user itself, so every entry point
              // gets that behavior, not just this one.
              onValueChange={v => { if (v !== currentOrg?.id) switchOrg(v); }}
            >
              <SelectTrigger className="h-7 w-44 text-xs" aria-label="Editor organization">
                <SelectValue placeholder="Select organization" />
              </SelectTrigger>
              <SelectContent>
                {orgs.map(o => (
                  <SelectItem
                    key={o.id}
                    value={o.id}
                    className="text-xs"
                    // Entering a suspended org swaps the layout for SuspendedOrgScreen,
                    // taking this toolbar with it — a one-way trip. Super-admins bypass
                    // that check, so it is only a trap for ordinary admins.
                    disabled={isOrgSuspended(o) && !isSuperAdmin}
                  >
                    {orgOptionLabel(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground text-xs">Viewing as:</span>
          <Select
            value={viewAsUser ? '__user__' : (viewAsRole ?? '__real__')}
            onValueChange={v => {
              if (v === '__real__') setViewAsRole(null);
              else if (v !== '__user__') setViewAsRole(v as AppRole);
            }}
            disabled={!!viewAsUser}
          >
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__real__">My Role</SelectItem>
              <SelectItem value="admin">{roleLabel("admin")}</SelectItem>
              <SelectItem value="producer">{roleLabel("producer")}</SelectItem>
              <SelectItem value="artist">{roleLabel("artist")}</SelectItem>
              {viewAsUser && <SelectItem value="__user__" disabled>From user</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground text-xs">as user:</span>
          <Select
            value={viewAsUser?.id ?? '__none__'}
            onValueChange={v => {
              if (v === '__none__') {
                setViewAsUser(null);
                return;
              }
              const u = (iamUsers ?? []).find(x => x.id === v);
              if (u && u.email) {
                setViewAsUser({ id: u.id, email: u.email, roles: u.roles });
              }
            }}
          >
            <SelectTrigger className="h-7 w-52 text-xs">
              <SelectValue placeholder="(none)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">(none)</SelectItem>
              {(iamUsers ?? []).map(u => (
                <SelectItem key={u.id} value={u.id} className="text-xs">
                  <Token>{u.email}</Token>
                  {u.roles.length > 0 && (
                    <span className="ml-2 text-muted-foreground">— {u.roles.map((role) => roleLabel(role)).join(', ')}</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator orientation="vertical" className="h-5 bg-warning/30" />

        <Button
          variant="secondary"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setSidePanelOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" />
          Page Settings
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <IconTooltip label="Hide bar (stay in editor mode)">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={hideToolbar}
              aria-label="Hide editor bar"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
          </IconTooltip>
          <IconTooltip label="Exit editor mode (back to your role)">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={exitEditor}
              aria-label="Exit editor mode"
            >
              <X className="h-4 w-4" />
            </Button>
          </IconTooltip>
        </div>
      </div>

      <EditorSidePanel open={isSidePanelOpen} onOpenChange={setSidePanelOpen} />
    </>
  );
}

/**
 * Which source file backs the route being viewed. Editor-mode only: it is a wayfinding
 * aid for whoever is configuring the page, not product UI.
 */
const ROUTE_TO_FILE: Record<string, string> = {
  [ROUTES.DASHBOARD]:    'DashboardPage.tsx',
  [ROUTES.BOOKINGS]:     'ShowsBookingsPage.tsx',
  [ROUTES.PRODUCTIONS]:  'ProductionsPage.tsx',
  [ROUTES.HIRE_ORDERS]:  'HireOrdersPage.tsx',
  [ROUTES.ARTISTS]:      'ArtistsPage.tsx',
  [ROUTES.AVAILABILITY]: 'AvailabilityPage.tsx',
  [ROUTES.SETTINGS]:     'SettingsPage.tsx',
  [ROUTES.CHATS]:        'ChatsListPage.tsx',
};

/**
 * The page-file badge shown above page content in editor mode. Self-gating, like the
 * toolbar and the toggle, so its host does not have to restate who may see the editor.
 */
export function EditorPageBadge() {
  const { isSuperAdmin } = useAuth();
  const { isEditorMode } = useEditor();
  const location = useLocation();

  if (!isEditorMode || !canUseEditor(isSuperAdmin)) return null;

  return (
    <div className="mb-4">
      <Badge variant="neutral">
        {ROUTE_TO_FILE[location.pathname] ? (
          <Token>{ROUTE_TO_FILE[location.pathname]}</Token>
        ) : (
          'Unknown page'
        )}
      </Badge>
    </div>
  );
}

/** Topbar pencil: enters editor mode when off, and toggles the toolbar's
 *  visibility when on. It intentionally does NOT exit — exiting (and dropping the
 *  "view as" preview) is the toolbar's X, a deliberate, less reversible action. This
 *  is also the only way to bring the bar back after it has been hidden. */
export function EditorModeToggle() {
  const { roles, isSuperAdmin, viewAsRole, viewAsUser } = useAuth();
  const { isEditorMode, enableEditorMode, isToolbarHidden, hideToolbar, showToolbar } = useEditor();

  if (!canUseEditor(isSuperAdmin)) return null;

  // A red pencil is a persistent reminder that the app is being previewed as
  // someone other than the signed-in user. It stays visible even with the editor
  // toolbar hidden, where the "Viewing as" chip is not — so a super-admin can
  // never forget they are looking at a gated/limited view rather than their own.
  // Same predicate the module/nav/route gates use, so the cue never disagrees
  // with what is actually gated.
  const previewingOther = isImpersonating({ isSuperAdmin, roles, viewAsRole, viewAsUser });
  const previewLabel = viewAsUser ? (viewAsUser.email ?? 'another user') : viewAsRole;

  const handleClick = () => {
    if (!isEditorMode) enableEditorMode();
    else if (isToolbarHidden) showToolbar();
    else hideToolbar();
  };

  const label = !isEditorMode
    ? 'Enter editor mode'
    : isToolbarHidden ? 'Show editor bar' : 'Hide editor bar';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={isEditorMode ? 'secondary' : 'ghost'}
          size="icon"
          className="relative h-8 w-8"
          onClick={handleClick}
        >
          <Pencil className={cn('h-4 w-4', previewingOther && 'text-destructive')} />
          {isEditorMode && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-background" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {previewingOther ? `Viewing as ${previewLabel}. ${label}.` : label}
      </TooltipContent>
    </Tooltip>
  );
}
