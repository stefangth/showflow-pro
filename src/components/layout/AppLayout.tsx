import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { APP_META, ROUTES } from '@/config/app.config';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  LayoutDashboard, BookOpen,
  Clock, Settings, Shield, LogOut, Bell, ChevronLeft, ChevronRight, Menu,
  MessageSquare, Users, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsWarnings } from '@/hooks/useSettingsWarnings';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { EditorToolbar, EditorModeToggle } from '@/features/editor/EditorToolbar';
import { StageMark } from '@/components/brand/StageMark';
import { NotificationsList } from '@/components/layout/NotificationsList';
import { useNotifications } from '@/hooks/useNotifications';

interface AppLayoutProps {
  children: React.ReactNode;
}

const ROUTE_TO_FILE: Record<string, string> = {
  [ROUTES.DASHBOARD]:    'DashboardPage.tsx',
  [ROUTES.BOOKINGS]:     'ShowsBookingsPage.tsx',
  [ROUTES.ARTISTS]:      'ArtistsPage.tsx',
  [ROUTES.AVAILABILITY]: 'AvailabilityPage.tsx',
  [ROUTES.ADMIN]:        'AdminPage.tsx',
  [ROUTES.SETTINGS]:     'SettingsPage.tsx',
  [ROUTES.CHATS]:        'ChatsListPage.tsx',
};

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
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { hasAnyWarning } = useSettingsWarnings();
  const { data: notifications = [] } = useNotifications();

  const isRealAdmin = roles.includes('admin');
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleSignOut = async () => {
    await signOut();
    navigate(ROUTES.LOGIN);
  };

  const filteredNav = (isEditorMode && isRealAdmin)
    ? navItems
    : navItems.filter(item => {
        if (!item.roles) return true;
        return item.roles.some(r => hasRole(r as any));
      });

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
      <div className="flex items-center gap-2.5 px-3.5 py-4 border-b border-border">
        <StageMark variant="tile" size={32} className="shrink-0" />
        {!collapsed && (
          <span className="font-display text-[15px] font-semibold tracking-[-0.02em] truncate">
            {APP_META.NAME}
          </span>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
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
                  'flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] font-medium transition-colors',
                  hiddenForRole ? 'opacity-40' : '',
                  isActive
                    ? 'bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-200'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )
              }
            >
              <span className="relative shrink-0">
                <item.icon className="h-[18px] w-[18px]" />
                {showWarningDot && (
                  <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-destructive ring-2 ring-background" />
                )}
                {hiddenForRole && !collapsed && (
                  <EyeOff className="absolute -bottom-1 -right-1 h-2.5 w-2.5 text-muted-foreground" />
                )}
              </span>
              {!collapsed && (
                <span className="flex items-center gap-2 flex-1 min-w-0">
                  {item.label}
                  {showWarningDot && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                  )}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-border px-2 py-3 space-y-1">
        {!collapsed && (
          <div className="px-2.5 mb-1.5">
            <p className="text-[13px] font-medium truncate">{user?.email}</p>
            <p className="text-[11px] text-muted-foreground capitalize">{roles.join(', ') || 'No role'}</p>
            {viewAsRole && isEditorMode && !viewAsUser && (
              <Badge variant="outline" className="mt-1 border-warning text-warning">
                Viewing as: {viewAsRole}
              </Badge>
            )}
            {viewAsUser && isEditorMode && (
              <div className="mt-1 space-y-0.5">
                <Badge variant="outline" className="border-warning text-warning">
                  Viewing as: {viewAsUser.roles.join(', ') || 'no role'}
                </Badge>
                <p className="text-[10px] font-mono text-warning truncate">{viewAsUser.email}</p>
              </div>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2.5 text-muted-foreground hover:text-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="h-[18px] w-[18px]" />
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
          'hidden lg:flex flex-col border-r border-border bg-card transition-all duration-300 shrink-0',
          collapsed ? 'w-[68px]' : 'w-[220px]'
        )}
      >
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex items-center justify-center py-3 border-t border-border hover:bg-muted transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-[220px] h-full bg-card shadow-elev3">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — 52 px */}
        <header className="flex items-center justify-between h-[52px] px-4 border-b border-border bg-card shrink-0">
          <button
            className="lg:hidden p-1 -ml-1 rounded-md hover:bg-muted transition-colors"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden flex items-center gap-2">
            <StageMark variant="tile" size={24} />
            <span className="font-display font-semibold text-[15px] tracking-[-0.02em]">{APP_META.NAME}</span>
          </div>
          <div className="flex-1 hidden lg:block" />
          <div className="flex items-center gap-1">
            {isRealAdmin && <EditorModeToggle />}

            {/* Notification bell — wired to NotificationsList popover */}
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                      <Bell className="h-[18px] w-[18px]" />
                      {unreadCount > 0 && (
                        <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                      )}
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Notifications</TooltipContent>
              </Tooltip>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-80 p-0"
              >
                <NotificationsList />
              </PopoverContent>
            </Popover>
          </div>
        </header>

        {/* Editor toolbar */}
        {isEditorMode && isRealAdmin && <EditorToolbar />}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {isEditorMode && isRealAdmin && (
            <div className="mb-4">
              <Badge variant="neutral" className="font-mono">
                {ROUTE_TO_FILE[location.pathname] ?? 'Unknown page'}
              </Badge>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
