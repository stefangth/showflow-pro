import { useAuth } from "@/features/auth/AuthContext";
import { useFeature } from "@/hooks/useEntitlements";
import { PermissionsMatrix } from "./PermissionsMatrix";

/** Admin-only: the org's rights matrix, gated to org mode for the current org.
 *  Hire-order rows hide when the org lacks the hire_orders module. */
export function PermissionsTab() {
  const { currentOrg } = useAuth();
  const hireOrders = useFeature("hire_orders");
  if (!currentOrg) return null;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Roles and permissions</h2>
        <p className="text-sm text-muted-foreground">
          Choose what producers can do. Admins always have every right. Sensitive rights ask for confirmation.
        </p>
      </div>
      <PermissionsMatrix orgId={currentOrg.id} mode="org" moduleEnabled={(m) => (m === "hire_orders" ? hireOrders : true)} />
    </div>
  );
}
