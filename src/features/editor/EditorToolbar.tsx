import { Eye, Pencil, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/features/auth/AuthContext';
import { useEditor } from './EditorContext';
import { EditorSidePanel } from './EditorSidePanel';

export function EditorToolbar() {
  const { roles, viewAsRole, setViewAsRole } = useAuth();
  const { isEditorMode, enableEditorMode, disableEditorMode, isSidePanelOpen, setSidePanelOpen } = useEditor();

  const isRealAdmin = roles.includes('admin');
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
            value={viewAsRole ?? '__real__'}
            onValueChange={v => setViewAsRole(v === '__real__' ? null : v as 'admin' | 'producer' | 'artist')}
          >
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__real__">My Role</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="producer">Producer</SelectItem>
              <SelectItem value="artist">Artist</SelectItem>
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
