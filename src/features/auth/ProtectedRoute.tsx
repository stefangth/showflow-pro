import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { ApprovalGate } from './ApprovalGate';
import type { AppRole } from '@/config/app.config';
import { ROUTES } from '@/config/app.config';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: AppRole[];
}

export function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { user, loading, roles, approvalStatus } = useAuth();

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

  // Block access until admin approval (or legacy fallback). Role checks only apply once approved.
  if (approvalStatus !== 'approved' && approvalStatus !== 'unknown') {
    return <ApprovalGate>{children}</ApprovalGate>;
  }

  if (requiredRoles && requiredRoles.length > 0) {
    const hasRequired = requiredRoles.some(r => roles.includes(r));
    if (!hasRequired) {
      return <Navigate to={ROUTES.DASHBOARD} replace />;
    }
  }

  return <ApprovalGate>{children}</ApprovalGate>;
}
