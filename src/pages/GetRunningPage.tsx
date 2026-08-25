import { Navigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { GetRunningBoardV3 } from "@/components/getRunning/v3/GetRunningBoardV3";
import { ROUTES } from "@/config/app.config";

/**
 * The `/get-running` onboarding board. The Wireflow v3 board is the only board; it owns its
 * own loading, "nothing to set up", and retirement states. The route is admin/producer-only
 * (nav item gated the same way), so an artist only reaches here by direct URL and is bounced
 * to Availability before any board markup renders.
 */
export default function GetRunningPage() {
  const { hasRole } = useAuth();
  if (!hasRole("admin") && !hasRole("producer")) {
    return <Navigate to={ROUTES.AVAILABILITY} replace />;
  }
  return <GetRunningBoardV3 context="page" />;
}
