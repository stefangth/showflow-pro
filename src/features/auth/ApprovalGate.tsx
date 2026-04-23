import { useAuth } from './AuthContext';
import PendingApprovalScreen from '@/pages/PendingApprovalScreen';
import RejectedScreen from '@/pages/RejectedScreen';

/**
 * Sits inside ProtectedRoute. Assumes user is already authenticated.
 * Blocks app access while approval is pending or rejected.
 */
export function ApprovalGate({ children }: { children: React.ReactNode }) {
  const { approvalStatus } = useAuth();

  if (approvalStatus === 'pending') return <PendingApprovalScreen />;
  if (approvalStatus === 'rejected') return <RejectedScreen />;
  // 'approved' or 'unknown' (legacy fallback) → render app
  return <>{children}</>;
}
