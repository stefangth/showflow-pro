// Settings > Hire orders > PDF template: a compact summary card that replaces
// the old flat PdfCopyCard (about 50 inputs in a list). Editing itself now
// happens in the full-page template editor (TemplateEditorPage); this card
// only reads the org's current hire_order_theme setting to summarise it and
// links across.

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import { ROUTES } from "@/config/app.config";
import {
  FONT_FAMILIES,
  resolveHireOrderTheme,
  THEME_ROLE_KEYS,
  type HireOrderThemeOverride,
} from "@/lib/hireOrders/pdf/pdfTheme";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

const THEME_DEFAULT: HireOrderThemeOverride = {};

/** True for a non-null object with at least one own key. Same "unchanged means
 *  absent" check TemplateOutline / TemplateInspector / TemplateEditorPage each
 *  keep locally (it is four lines) - a role entry present but hollow (`{}`, or
 *  a stray `null` from hand-edited app_settings JSON) must not count as a
 *  customisation, the same way it must not show as "modified" in the editor
 *  itself. */
function hasOwnKeys(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.keys(value).length > 0;
}

/** "no customised elements" / "1 customised element" / "N customised elements". */
function describeCustomisation(count: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (count === 0) return t("pdfTemplateCard.customisedNone");
  return t("pdfTemplateCard.customisedCount", { count });
}

/** `readOnly` is accepted (not used here — this card's only affordance is a
 *  navigation link, and TemplateEditorPage derives its own read-only state
 *  from the `edit_hire_order_settings` capability) purely so the call site
 *  in HireOrdersTab can pass it uniformly across every card in the list. */
export function PdfTemplateCard({ orgId }: { orgId: string | null; readOnly?: boolean }) {
  const { t } = useTranslation("settingsHireOrders");
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["app-settings", "hire_order_theme", orgId],
    queryFn: () => resolveOrgSetting<HireOrderThemeOverride>(supabase, orgId, "hire_order_theme", THEME_DEFAULT),
    enabled: Boolean(orgId),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  // Read failed: render the error INSTEAD of a summary built from `undefined`.
  // Falling through would show the default theme's numbers as if they were the
  // org's real saved values (same failure mode the other cards on this tab guard
  // against - see HireOrdersTab.test.tsx's "when the settings read fails" suite).
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t("pdfTemplateCard.loadError")} {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }
  const theme = resolveHireOrderTheme(data);
  const family = FONT_FAMILIES.find((f) => f.key === theme.base.fontFamily)?.label ?? "Geist";
  const customised = THEME_ROLE_KEYS.filter((k) => hasOwnKeys(data?.roles?.[k])).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">{t("pdfTemplateCard.title")}</CardTitle>
        <CardDescription>
          {t("pdfTemplateCard.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground" data-testid="tpl-summary">
          {t("pdfTemplateCard.summary", {
            family,
            percent: Math.round(theme.base.scale * 100),
            customised: describeCustomisation(customised, t),
          })}
        </p>
        <Button asChild>
          <Link to={ROUTES.HIRE_ORDER_TEMPLATE}>{t("pdfTemplateCard.openEditor")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
