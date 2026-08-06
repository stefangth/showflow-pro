import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useFeature } from "@/hooks/useEntitlements";
import { FEATURE_REGISTRY, type FeatureKey } from "@/lib/entitlements";

/**
 * In-page gate for an org module. When the current org is entitled this is a
 * transparent pass-through. When it is not, `children` are deliberately NOT
 * mounted (that would fire their queries for data the viewer cannot act on);
 * instead the viewer gets a standard notice plus an optional static `preview`
 * the consumer supplies, rendered non-interactive.
 *
 * Copy is derived from FEATURE_REGISTRY so it cannot drift from
 * FeatureDisabledScreen, which gates the route-level equivalent.
 */
export function ModuleGate({ feature, children, preview }: {
  feature: FeatureKey;
  children: ReactNode;
  preview?: ReactNode;
}) {
  const enabled = useFeature(feature);
  if (enabled) return <>{children}</>;
  const def = FEATURE_REGISTRY[feature];
  return (
    <div data-testid={`module-gate-${feature}`} className="space-y-3">
      <Alert>
        <Lock className="h-4 w-4" />
        <AlertTitle>{def.label} is not enabled</AlertTitle>
        <AlertDescription>
          This module is not part of your organization's plan. Contact your ShowFlow
          administrator to enable it.
        </AlertDescription>
      </Alert>
      {preview && (
        <div data-testid="module-gate-preview" aria-hidden className="pointer-events-none select-none opacity-60">
          {preview}
        </div>
      )}
    </div>
  );
}
