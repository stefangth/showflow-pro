import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import NoOrgScreen from '@/pages/NoOrgScreen';
import SuspendedOrgScreen from '@/pages/SuspendedOrgScreen';
import FeatureDisabledScreen from '@/pages/FeatureDisabledScreen';
import AppLayout from '@/components/layout/AppLayout';
import type { AppRole } from '@/config/app.config';
import { ROUTES, requiredFeatureForPath } from '@/config/app.config';
import { DEFAULT_PAGE_ACCESS } from '@/features/editor/types';
import { isImpersonating } from '@/features/auth/orgRoles';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { useEntitlements } from '@/hooks/useEntitlements';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: AppRole[];
}

export function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { user, loading, roles, currentOrg, isSuperAdmin, viewAsRole, viewAsUser } = useAuth();
  const { isEditorMode, pageAccess } = useEditorConfig();
  const { features, isLoading: entitlementsLoading } = useEntitlements();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  // Invite-only: access is org membership. No active org → ask for an invite
  // (super-admins go to the console instead of being trapped).
  if (!currentOrg) {
    return isSuperAdmin ? <Navigate to={ROUTES.PLATFORM} replace /> : <NoOrgScreen />;
  }
  // Super-admins may enter a suspended org (god-mode); members cannot.
  if (currentOrg.status === 'suspended' && !isSuperAdmin) {
    return <SuspendedOrgScreen />;
  }

  // Route-level entitlement gate. While entitlements are still loading, fall
  // through to the existing render path rather than flashing the disabled
  // screen for an org that does have the feature. Super-admins (god-mode)
  // bypass this like they bypass org role gates below.
  const requiredFeature = requiredFeatureForPath(location.pathname);
  const impersonating = isImpersonating({ isSuperAdmin, roles, viewAsRole, viewAsUser });
  if (requiredFeature && !entitlementsLoading && !features.has(requiredFeature) && !(isSuperAdmin && !impersonating)) {
    // A super-admin only reaches this branch while previewing (view-as); keep the
    // editor toolbar (which lives inside AppLayout) on screen so they can exit the
    // preview, and render the disabled screen `embedded` so it centers within
    // AppLayout's <main> instead of overflowing it. A genuine member has no
    // toolbar and gets the standalone full-viewport screen.
    return isSuperAdmin
      ? <AppLayout><FeatureDisabledScreen feature={requiredFeature} embedded /></AppLayout>
      : <FeatureDisabledScreen feature={requiredFeature} />;
  }

  // Admins in editor mode bypass all route role gates — they can navigate anywhere.
  const isRealAdmin = roles.includes('admin');
  if (isEditorMode && isRealAdmin) {
    return <>{children}</>;
  }

  // Platform admins (god-mode) bypass org role gates, like editor-mode admins.
  if (isSuperAdmin) {
    return <>{children}</>;
  }

  // Determine effective required roles: prefer DB-configured access, fall back to prop/defaults.
  const configuredRoles = pageAccess[location.pathname] ?? DEFAULT_PAGE_ACCESS[location.pathname];
  const effectiveRoles = configuredRoles ?? requiredRoles;

  if (effectiveRoles && effectiveRoles.length > 0) {
    const hasRequired = effectiveRoles.some(r => roles.includes(r));
    if (!hasRequired) {
      return <Navigate to={ROUTES.DASHBOARD} replace />;
    }
  }

  return <>{children}</>;
}

/** Gate for the /platform console: platform admins only, no org gating. */
export function PlatformRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isSuperAdmin } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!user) return <Navigate to={ROUTES.LOGIN} replace />;
  if (!isSuperAdmin) return <Navigate to={ROUTES.DASHBOARD} replace />;
  return <>{children}</>;
}
