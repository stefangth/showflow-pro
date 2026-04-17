import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { APP_META, ROUTES } from '@/config/app.config';
import { Button } from '@/components/ui/button';
import {
  Zap, LayoutDashboard, CalendarDays, Users, BookOpen,
  Clock, Settings, Shield, LogOut, Bell, ChevronLeft, ChevronRight, Menu, X
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { to: ROUTES.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard' },
  { to: ROUTES.SHOWS, icon: CalendarDays, label: 'Shows' },
  { to: ROUTES.ARTISTS, icon: Users, label: 'Artists' },
  { to: ROUTES.BOOKINGS, icon: BookOpen, label: 'Bookings' },
  { to: ROUTES.AVAILABILITY, icon: Clock, label: 'Availability' },
  { to: ROUTES.ADMIN, icon: Shield, label: 'Admin', roles: ['admin'] as string[] },
  { to: ROUTES.SETTINGS, icon: Settings, label: 'Settings', roles: ['admin'] as string[] },
];

export default function AppLayout({ children }: AppLayoutProps) {
  const { user, signOut, roles, hasRole } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate(ROUTES.LOGIN);
  };

  const filteredNav = navItems.filter(item => {
    if (!item.roles) return true;
    return item.roles.some(r => hasRole(r as any));
  });

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
        {filteredNav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div className="border-t border-border px-3 py-4 space-y-2">
        {!collapsed && (
          <div className="px-3 mb-2">
            <p className="text-sm font-medium truncate">{user?.email}</p>
            <p className="text-xs text-muted-foreground capitalize">{roles.join(', ') || 'No role'}</p>
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
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
          </Button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
