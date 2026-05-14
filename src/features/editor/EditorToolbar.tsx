import { Eye, Pencil, Settings, User, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/features/auth/AuthContext';
import type { AppRole } from '@/config/app.config';
import { supabase } from '@/integrations/supabase/client';
import { useEditor } from './EditorContext';
import { EditorSidePanel } from './EditorSidePanel';

interface IamUser {
  id: string;
  email: string | null;
  roles: AppRole[];
  approval_status: string | null;
}

export function EditorToolbar() {
  const { roles, viewAsRole, setViewAsRole, viewAsUser, setViewAsUser } = useAuth();
  const { isEditorMode, enableEditorMode, disableEditorMode, isSidePanelOpen, setSidePanelOpen } = useEditor();

  const isRealAdmin = roles.includes('admin');

  const { data: iamUsers } = useQuery({
    queryKey: ['admin-iam-users'],
    enabled: isRealAdmin && isEditorMode,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-list-users');
      if (error) throw error;
      return ((data?.users ?? []) as IamUser[])
        .filter(u => u.approval_status === 'approved' && u.email)
        .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
    },
    staleTime: 60_000,
  });

  if (!isRealAdmin) return null;

  if (!isEditorMode) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={enableEditorMode}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Enter Editor Mode</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2 bg-warning/10 border-b border-warning/30 text-sm shrink-0">
        <Badge variant="outline" className="border-warning text-warning gap-1.5 shrink-0">
          <Pencil className="h-3 w-3" />
          Editor Mode
        </Badge>

        <Separator orientation="vertical" className="h-5 bg-warning/30" />

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
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="producer">Producer</SelectItem>
              <SelectItem value="artist">Artist</SelectItem>
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
                  <span className="font-mono">{u.email}</span>
                  {u.roles.length > 0 && (
                    <span className="ml-2 text-muted-foreground">— {u.roles.join(', ')}</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator orientation="vertical" className="h-5 bg-warning/30" />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setSidePanelOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" />
          Page Settings
        </Button>

        <div className="ml-auto">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={disableEditorMode}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <EditorSidePanel open={isSidePanelOpen} onOpenChange={setSidePanelOpen} />
    </>
  );
}

/** Toggle button rendered inside the topbar for admins when editor mode is off. */
export function EditorModeToggle() {
  const { roles } = useAuth();
  const { isEditorMode, enableEditorMode, disableEditorMode } = useEditor();

  if (!roles.includes('admin')) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={isEditorMode ? 'secondary' : 'ghost'}
          size="icon"
          className="relative h-8 w-8"
          onClick={isEditorMode ? disableEditorMode : enableEditorMode}
        >
          <Pencil className="h-4 w-4" />
          {isEditorMode && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-background" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isEditorMode ? 'Exit Editor Mode' : 'Enter Editor Mode'}
      </TooltipContent>
    </Tooltip>
  );
}
