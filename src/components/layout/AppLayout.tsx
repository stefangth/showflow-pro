import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { APP_META, ROUTES } from '@/config/app.config';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Zap, LayoutDashboard, BookOpen,
  Clock, Settings, Shield, LogOut, Bell, ChevronLeft, ChevronRight, Menu,
  MessageSquare, Users, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsWarnings } from '@/hooks/useSettingsWarnings';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { EditorToolbar, EditorModeToggle } from '@/features/editor/EditorToolbar';

interface AppLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { to: ROUTES.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard' },
  { to: ROUTES.BOOKINGS, icon: BookOpen, label: 'Shows & Bookings', roles: ['admin', 'producer'] as string[] },
  { to: ROUTES.ARTISTS, icon: Users, label: 'Artists', roles: ['admin', 'producer'] as string[] },
  { to: ROUTES.AVAILABILITY, icon: Clock, label: 'Availability', roles: ['artist'] as string[] },
  { to: ROUTES.CHATS, icon: MessageSquare, label: 'Chats' },
  { to: ROUTES.ADMIN, icon: Shield, label: 'Admin', roles: ['admin'] as string[] },
  { to: ROUTES.SETTINGS, icon: Settings, label: 'Settings', roles: ['admin', 'producer'] as string[] },
];

export default function AppLayout({ children }: AppLayoutProps) {
  const { user, signOut, roles, hasRole, viewAsRole, viewAsUser } = useAuth();
  const { isEditorMode } = useEditorConfig();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { hasAnyWarning } = useSettingsWarnings();

  const isRealAdmin = roles.includes('admin');

  const handleSignOut = async () => {
    await signOut();
    navigate(ROUTES.LOGIN);
  };

  // In editor mode, real admins see all nav items; items hidden for viewAsRole get a dimmed indicator.
  const filteredNav = (isEditorMode && isRealAdmin)
    ? navItems
    : navItems.filter(item => {
        if (!item.roles) return true;
        return item.roles.some(r => hasRole(r as any));
      });

  // Items the simulated role/user wouldn't normally see (for editor visual cue)
  const isHiddenForViewAs = (item: typeof navItems[0]) => {
    if (!isEditorMode) return false;
    if (!item.roles) return false;
    if (viewAsUser) return !item.roles.some(r => viewAsUser.roles.includes(r as any));
    if (viewAsRole === null) return false;
    return !item.roles.includes(viewAsRole);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary">
          <Zap className="h-5 w-5 text-primary-foreground" />
        </div>
        {!collapsed && <span className="font-display text-lg font-bold truncate">{APP_META.NAME}</span>}
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {filteredNav.map(item => {
          const showWarningDot = item.to === ROUTES.SETTINGS && hasAnyWarning;
          const hiddenForRole = isHiddenForViewAs(item);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  hiddenForRole ? 'opacity-40' : '',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )
              }
            >
              <span className="relative shrink-0">
                <item.icon className="h-5 w-5" />
                {showWarningDot && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
                )}
                {hiddenForRole && !collapsed && (
                  <EyeOff className="absolute -bottom-1 -right-1 h-2.5 w-2.5 text-muted-foreground" />
                )}
              </span>
              {!collapsed && (
                <span className="flex items-center gap-2 flex-1 min-w-0">
                  {item.label}
                  {showWarningDot && (
                    <span className="ml-auto h-2 w-2 rounded-full bg-destructive shrink-0" />
                  )}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-border px-3 py-4 space-y-2">
        {!collapsed && (
          <div className="px-3 mb-2">
            <p className="text-sm font-medium truncate">{user?.email}</p>
            <p className="text-xs text-muted-foreground capitalize">{roles.join(', ') || 'No role'}</p>
            {viewAsRole && isEditorMode && !viewAsUser && (
              <Badge variant="outline" className="mt-1 text-xs border-warning text-warning">
                Viewing as: {viewAsRole}
              </Badge>
            )}
            {viewAsUser && isEditorMode && (
              <div className="mt-1 space-y-0.5">
                <Badge variant="outline" className="text-xs border-warning text-warning">
                  Viewing as: {viewAsUser.roles.join(', ') || 'no role'}
                </Badge>
                <p className="text-[10px] font-mono text-warning truncate">{viewAsUser.email}</p>
              </div>
            )}
          </div>
        )}
        <Button variant="ghost" size="sm" className="w-full justify-start gap-3" onClick={handleSignOut}>
          <LogOut className="h-4 w-4" />
          {!collapsed && 'Sign Out'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col border-r border-border bg-card transition-all duration-300',
          collapsed ? 'w-[68px]' : 'w-64'
        )}
      >
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center py-3 border-t border-border hover:bg-muted transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 h-full bg-card shadow-2xl">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between h-14 px-4 border-b border-border bg-card shrink-0">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden font-display font-bold">{APP_META.NAME}</div>
          <div className="flex-1 hidden lg:block" />
          <div className="flex items-center gap-1">
            {isRealAdmin && <EditorModeToggle />}
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
            </Button>
          </div>
        </header>

        {/* Editor toolbar — shown between header and content when editor mode is active */}
        {isEditorMode && isRealAdmin && <EditorToolbar />}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
