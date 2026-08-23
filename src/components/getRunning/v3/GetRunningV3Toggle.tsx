import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunningV3Enabled, useSetGetRunningV3Enabled } from "@/hooks/useGetRunningV3Enabled";

/**
 * Super-admin-only switch for the org's `getrunning_v3_enabled` app_settings override
 * (Task A2's `useGetRunningV3Enabled`/`useSetGetRunningV3Enabled`). Renders `null` for
 * anyone who is not a super-admin, so the toggle is only offered to platform staff. Note
 * this is a UI-level restriction: the underlying app_settings write RLS also permits a
 * plain org admin to set the key directly (see `GETRUNNING_V3_SETTING_KEY`), so this gate
 * governs the surface, not the data layer. Embedded in the Settings mirror by Task B2.
 */
export function GetRunningV3Toggle() {
  const { t } = useTranslation("getRunningV3");
  const { isSuperAdmin } = useAuth();
  const { enabled, isLoading } = useGetRunningV3Enabled();
  const mutation = useSetGetRunningV3Enabled();

  if (!isSuperAdmin) return null;

  const handleCheckedChange = (next: boolean) => {
    mutation.mutate(next, {
      onSuccess: () => toast.success(next ? t("toggle.enabledToast") : t("toggle.disabledToast")),
      onError: () => toast.error(t("toggle.errorToast")),
    });
  };

  return (
    <Card data-testid="get-running-v3-toggle">
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0">
          <p id="getrunning-v3-toggle-label" className="text-control font-medium text-foreground">
            {t("toggle.title")}
          </p>
          <p className="text-caption text-muted-foreground">{t("toggle.description")}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={isLoading || mutation.isPending}
          onCheckedChange={handleCheckedChange}
          aria-labelledby="getrunning-v3-toggle-label"
        />
      </CardContent>
    </Card>
  );
}
