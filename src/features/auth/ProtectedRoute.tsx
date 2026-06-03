import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import NoOrgScreen from '@/pages/NoOrgScreen';
import SuspendedOrgScreen from '@/pages/SuspendedOrgScreen';
import type { AppRole } from '@/config/app.config';
import { ROUTES } from '@/config/app.config';
import { DEFAULT_PAGE_ACCESS } from '@/features/editor/types';
import { useEditorConfig } from '@/features/editor/EditorContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: AppRole[];
}

export function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { user, loading, roles, currentOrg } = useAuth();
  const { isEditorMode, pageAccess } = useEditorConfig();
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

  // Invite-only: access is org membership. No active org → ask for an invite.
  if (!currentOrg) {
    return <NoOrgScreen />;
  }
  if (currentOrg.status === 'suspended') {
    return <SuspendedOrgScreen />;
  }

  // Admins in editor mode bypass all route role gates — they can navigate anywhere.
  const isRealAdmin = roles.includes('admin');
  if (isEditorMode && isRealAdmin) {
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
