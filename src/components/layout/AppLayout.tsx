import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { isImpersonating } from '@/features/auth/orgRoles';
import { ROUTES, roleLabel } from '@/config/app.config';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconTooltip } from '@/components/common/IconTooltip';
import { Settings, LogOut, Bell, ChevronLeft, ChevronRight, Menu, EyeOff, User, Lock, Check, Languages } from 'lucide-react';
import { NAV_ITEMS, visibleNavItems, groupNavBySections, isHiddenForViewAs, type NavLabelKey } from '@/components/layout/navItems';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/features/i18n/LanguageContext';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { useSettingsWarnings } from '@/hooks/useSettingsWarnings';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { EditorToolbar, EditorModeToggle, EditorPageBadge } from '@/features/editor/EditorToolbar';
import { StageMark } from '@/components/brand/StageMark';
import { BrandWordmark } from '@/components/brand/BrandWordmark';
import { OrgSwitcher } from '@/components/layout/OrgSwitcher';
import { NotificationsList } from '@/components/layout/NotificationsList';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useNotifications } from '@/hooks/useNotifications';
import { useNavCounts } from '@/hooks/useNavCounts';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useEntitlements } from '@/hooks/useEntitlements';
import { toast } from 'sonner';
import type { AppRole } from '@/types';

interface AppLayoutProps {
  children: React.ReactNode;
}

const ROUTE_TO_LABEL: Record<string, string> = Object.fromEntries(NAV_ITEMS.map((i) => [i.to, i.label]));
const ROUTE_TO_LABELKEY: Record<string, NavLabelKey | undefined> = Object.fromEntries(NAV_ITEMS.map((i) => [i.to, i.labelKey]));
const SECTION_KEY = { workspace: 'nav.workspace', catalog: 'nav.catalog', system: 'nav.system' } as const;

export default function AppLayout({ children }: AppLayoutProps) {
  const { user, signOut, roles, hasRole, viewAsRole, viewAsUser, isSuperAdmin, currentOrg } = useAuth();
  const { isEditorMode } = useEditorConfig();
  const { t } = useTranslation('common');
  const { lang, setLang } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const { hasAnyWarning } = useSettingsWarnings();
  const { data: notifications = [] } = useNotifications();
  const { data: myProfile } = useMyProfile();
  const navCounts = useNavCounts();
  const { features, isLoading: entitlementsLoading } = useEntitlements();

  // The account-menu Popover lives only in the expanded sidebar. Reset its open
  // state when collapsing so it doesn't auto-pop on the next expand.
  useEffect(() => { if (collapsed) setProfileMenuOpen(false); }, [collapsed]);

  const isRealAdmin = roles.includes('admin');
  const unreadCount = notifications.filter(n => !n.read).length;

  const displayName = (myProfile?.display_name?.trim() || user?.email?.split('@')[0] || 'Account');
  const initials = displayName.slice(0, 2).toUpperCase();
  const primaryRole = roles[0];
  const roleText = primaryRole
    ? roleLabel(primaryRole)
    : (isSuperAdmin ? 'Super Admin' : 'No role');
  const profileSubtitle = currentOrg ? `${roleText} · ${currentOrg.name}` : roleText;

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate(ROUTES.LOGIN);
    } catch {
      toast.error('Sign out failed — please try again.');
    }
  };

  const filteredNav = visibleNavItems(NAV_ITEMS, { isEditorMode, isRealAdmin, isSuperAdmin, hasRole: (r) => hasRole(r as AppRole), enabledFeatures: features, entitlementsLoading, impersonating: isImpersonating({ isSuperAdmin, roles, viewAsRole, viewAsUser }) });
  const navGroups = groupNavBySections(filteredNav);

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3.5 py-4 border-b-[0.5px] border-sidebar-border">
        <StageMark variant="mark" size={32} className="shrink-0" />
        {!collapsed && <BrandWordmark className="flex-1" />}
      </div>

      {/* Org switcher */}
      <div className="px-2 py-2 border-b-[0.5px] border-sidebar-border">
        <OrgSwitcher collapsed={collapsed} />
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {navGroups.map(group => (
          <div key={group.section} className="space-y-0.5">
            {!collapsed && (
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                {t(SECTION_KEY[group.section])}
              </p>
            )}
            {group.items.map(item => {
              const showWarningDot = item.to === ROUTES.SETTINGS && hasAnyWarning;
              const hiddenForRole = isHiddenForViewAs(item, { isEditorMode, viewAsRole, viewAsUser });
              const badgeCount = item.badge ? navCounts[item.badge] : 0;
              if (item.locked) {
                return (
                  <div
                    key={item.to}
                    aria-disabled="true"
                    title={`${item.label} is not enabled for this organization`}
                    className="flex cursor-not-allowed items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] font-medium text-muted-foreground/50"
                  >
                    <span className="relative shrink-0">
                      <item.icon className="h-[14px] w-[14px]" />
                    </span>
                    {!collapsed && (
                      <span className="flex flex-1 items-center gap-2 min-w-0">
                        <span className="truncate">{item.labelKey ? t(item.labelKey) : item.label}</span>
                        <Lock className="ml-auto h-3 w-3 shrink-0" />
                      </span>
                    )}
                  </div>
                );
              }
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
                    {/* One corner dot. Warning (destructive) wins over the collapsed
                        count dot (primary) so a config warning is never painted over. */}
                    {(showWarningDot || (collapsed && badgeCount > 0)) && (
                      <span
                        className={cn(
                          'absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-background',
                          showWarningDot ? 'bg-destructive' : 'bg-primary',
                        )}
                      />
                    )}
                    {hiddenForRole && !collapsed && (
                      <EyeOff className="absolute -bottom-1 -right-1 h-2.5 w-2.5 text-muted-foreground" />
                    )}
                  </span>
                  {!collapsed && (
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="truncate">{item.labelKey ? t(item.labelKey) : item.label}</span>
                      {badgeCount > 0 && (
                        <span className="ml-auto shrink-0 rounded-full bg-sidebar-accent px-1.5 py-px text-[10px] font-semibold tabular-nums text-sidebar-accent-foreground">
                          {badgeCount}
                        </span>
                      )}
                      {showWarningDot && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                      )}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User / profile card */}
      <div className="border-t-[0.5px] border-sidebar-border p-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback seed={user?.email ?? ''}>{initials}</AvatarFallback>
            </Avatar>
            <IconTooltip label="Profile" side="right">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-sidebar-foreground/70"
                onClick={() => navigate(ROUTES.PROFILE)}
                aria-label="Profile"
              >
                <User className="h-[14px] w-[14px]" />
              </Button>
            </IconTooltip>
            <IconTooltip label="Sign out" side="right">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-sidebar-foreground/70"
                onClick={handleSignOut}
                aria-label="Sign out"
              >
                <LogOut className="h-[14px] w-[14px]" />
              </Button>
            </IconTooltip>
          </div>
        ) : (
          <div className="rounded-[10px] border border-sidebar-border bg-background/70 px-2.5 py-2 shadow-sm">
            <div className="flex items-center gap-2.5">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback seed={user?.email ?? ''}>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold leading-tight truncate">{displayName}</p>
                <p className="text-[10.5px] text-muted-foreground leading-tight truncate">{profileSubtitle}</p>
              </div>
              <Popover open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
                <IconTooltip label="Account menu" side="top">
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground" aria-label="Account menu">
                      <Settings className="h-[15px] w-[15px]" />
                    </Button>
                  </PopoverTrigger>
                </IconTooltip>
                <PopoverContent align="end" side="top" sideOffset={8} className="w-52 p-1">
                  <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">
                    {t('account.language')}
                  </p>
                  {SUPPORTED_LANGUAGES.map((code) => (
                    <button
                      key={code}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-foreground hover:bg-muted transition-colors"
                      onClick={() => { setLang(code); setProfileMenuOpen(false); }}
                      aria-pressed={lang === code}
                    >
                      <Languages className="h-[14px] w-[14px]" />
                      <span className="flex-1 text-left">{LANGUAGE_LABELS[code]}</span>
                      {lang === code && <Check className="h-[14px] w-[14px] text-accent-600" />}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-border" />
                  <button
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-foreground hover:bg-muted transition-colors"
                    onClick={() => { setProfileMenuOpen(false); navigate(ROUTES.PROFILE); }}
                  >
                    <User className="h-[14px] w-[14px]" /> {t('account.profile')}
                  </button>
                  <button
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-foreground hover:bg-muted transition-colors"
                    onClick={() => { setProfileMenuOpen(false); handleSignOut(); }}
                  >
                    <LogOut className="h-[14px] w-[14px]" /> {t('account.signOut')}
                  </button>
                </PopoverContent>
              </Popover>
            </div>
            {viewAsRole && isEditorMode && !viewAsUser && (
              <Badge variant="outline" className="mt-2 border-warning text-warning">
                Viewing as: {roleLabel(viewAsRole)}
              </Badge>
            )}
            {viewAsUser && isEditorMode && (
              <div className="mt-2 space-y-0.5">
                <Badge variant="outline" className="border-warning text-warning">
                  Viewing as: {viewAsUser.roles.map(roleLabel).join(', ') || 'no role'}
                </Badge>
                <p className="text-[10px] font-mono text-warning truncate">{viewAsUser.email}</p>
              </div>
            )}
          </div>
        )}
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
        <IconTooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right" className="flex w-full">
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center justify-center py-3 border-t-[0.5px] border-sidebar-border hover:bg-foreground/[0.04] transition-colors"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </IconTooltip>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-[var(--veil)]"
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
            <BrandWordmark />
          </div>

          {/* Breadcrumb — current page path (desktop) */}
          <nav aria-label="Breadcrumb" className="hidden lg:flex items-center gap-1.5 text-[13px] min-w-0">
            {location.pathname === ROUTES.DASHBOARD ? (
              <span aria-current="page" className="font-medium text-foreground">{t('nav.dashboard')}</span>
            ) : (
              <>
                <Link
                  to={ROUTES.DASHBOARD}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('breadcrumb.home')}
                </Link>
                {ROUTE_TO_LABEL[location.pathname] && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                    <span aria-current="page" className="truncate font-medium text-foreground">
                      {ROUTE_TO_LABELKEY[location.pathname] ? t(ROUTE_TO_LABELKEY[location.pathname]!) : ROUTE_TO_LABEL[location.pathname]}
                    </span>
                  </>
                )}
              </>
            )}
          </nav>

          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <EditorModeToggle />

            <ThemeToggle />

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
                <NotificationsList onNavigate={() => setNotifOpen(false)} />
              </PopoverContent>
            </Popover>
          </div>
        </header>

        {/* Editor toolbar */}
        <EditorToolbar />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <EditorPageBadge />
          {children}
        </main>
      </div>
    </div>
  );
}
