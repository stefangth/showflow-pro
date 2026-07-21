import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ROUTES } from "@/config/app.config";
import { FEATURE_REGISTRY, type FeatureKey } from "@/lib/entitlements";

/** Shown to a super-admin who reached a feature-gated page for an org that does not
 *  have the module. They keep read access (they administer entitlements) but every
 *  write would 403 at the edge function, so the page must say so before they try. */
export function FeatureOffBanner({ feature }: { feature: FeatureKey }) {
  return (
    <Alert>
      <AlertDescription>
        {FEATURE_REGISTRY[feature].label} is off for this organization, so changes cannot be saved.{" "}
        <Link to={ROUTES.PLATFORM} className="underline">Enable it</Link> in Platform, Organizations.
      </AlertDescription>
    </Alert>
  );
}
