import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { APP_META, ROUTES } from '@/config/app.config';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Settings, LogOut, Bell, ChevronLeft, ChevronRight, Menu, EyeOff } from 'lucide-react';
import { NAV_ITEMS, visibleNavItems } from '@/components/layout/navItems';
import { cn } from '@/lib/utils';
import { useSettingsWarnings } from '@/hooks/useSettingsWarnings';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { EditorToolbar, EditorModeToggle } from '@/features/editor/EditorToolbar';
import { StageMark } from '@/components/brand/StageMark';
import { OrgSwitcher } from '@/components/layout/OrgSwitcher';
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

const ROUTE_TO_LABEL: Record<string, string> = Object.fromEntries(NAV_ITEMS.map((i) => [i.to, i.label]));

export default function AppLayout({ children }: AppLayoutProps) {
  const { user, signOut, roles, hasRole, viewAsRole, viewAsUser, isSuperAdmin } = useAuth();
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

  const filteredNav = visibleNavItems(NAV_ITEMS, { isEditorMode, isRealAdmin, isSuperAdmin, hasRole: (r) => hasRole(r as any) });

  const isHiddenForViewAs = (item: typeof NAV_ITEMS[number]) => {
    if (!isEditorMode) return false;
    if (!item.roles) return false;
    if (viewAsUser) return !item.roles.some(r => viewAsUser.roles.includes(r as any));
    if (viewAsRole === null) return false;
    return !item.roles.includes(viewAsRole);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3.5 py-4 border-b-[0.5px] border-sidebar-border">
        <StageMark variant="mark" size={32} className="shrink-0" />
        {!collapsed && (
          <span className="font-display text-[15px] font-semibold tracking-[-0.02em] truncate">
            {APP_META.NAME}
          </span>
        )}
      </div>

      {/* Org switcher */}
      <div className="px-2 py-2 border-b-[0.5px] border-sidebar-border">
        <OrgSwitcher collapsed={collapsed} />
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
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                    : 'text-sidebar-foreground/70 hover:bg-foreground/[0.04] hover:text-sidebar-foreground'
                )
              }
            >
              <span className="relative shrink-0">
                <item.icon className="h-[14px] w-[14px]" />
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
      <div className="border-t-[0.5px] border-sidebar-border px-2 py-3 space-y-1">
        {!collapsed && (
          <div className="px-1.5 mb-1.5 space-y-1.5">
            <div className="flex items-center gap-2.5">
              <Avatar className="h-7 w-7">
                <AvatarFallback seed={user?.email ?? ''}>
                  {(user?.email?.split('@')[0] ?? '?').slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold truncate">{user?.email}</p>
                <p className="text-[10px] text-muted-foreground capitalize truncate">{roles.join(', ') || 'No role'}</p>
              </div>
            </div>
            {viewAsRole && isEditorMode && !viewAsUser && (
              <Badge variant="outline" className="border-warning text-warning">
                Viewing as: {viewAsRole}
              </Badge>
            )}
            {viewAsUser && isEditorMode && (
              <div className="space-y-0.5">
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
          className="w-full justify-start gap-2.5 text-sidebar-foreground/70 hover:bg-foreground/[0.04] hover:text-sidebar-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="h-[14px] w-[14px]" />
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
          'hidden lg:flex flex-col border-r-[0.5px] border-sidebar-border bg-sidebar transition-all duration-300 shrink-0',
          collapsed ? 'w-[68px]' : 'w-[220px]'
        )}
      >
        {sidebarContent}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex items-center justify-center py-3 border-t-[0.5px] border-sidebar-border hover:bg-foreground/[0.04] transition-colors"
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
          <aside className="relative w-[220px] h-full bg-sidebar shadow-elev3">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — 52 px */}
        <header className="flex items-center gap-3 h-[52px] px-6 border-b-[0.5px] border-border bg-background shrink-0">
          <button
            className="lg:hidden p-1 -ml-1 rounded-md hover:bg-muted transition-colors"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden flex items-center gap-2">
            <StageMark variant="mark" size={24} />
            <span className="font-display font-semibold text-[15px] tracking-[-0.02em]">{APP_META.NAME}</span>
          </div>

          {/* Breadcrumb — current page path (desktop) */}
          <nav aria-label="Breadcrumb" className="hidden lg:flex items-center gap-1.5 text-[13px] min-w-0">
            {location.pathname === ROUTES.DASHBOARD ? (
              <span aria-current="page" className="font-medium text-foreground">Dashboard</span>
            ) : (
              <>
                <Link
                  to={ROUTES.DASHBOARD}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                >
                  Home
                </Link>
                {ROUTE_TO_LABEL[location.pathname] && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                    <span aria-current="page" className="truncate font-medium text-foreground">
                      {ROUTE_TO_LABEL[location.pathname]}
                    </span>
                  </>
                )}
              </>
            )}
          </nav>

          <div className="flex-1" />
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
