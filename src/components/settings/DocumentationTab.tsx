import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import appLogicMd from "../../../docs/app-logic.md?raw";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownDoc } from "./MarkdownDoc";

// Lazy-loaded so the graph data (src/data/systemMap.ts) and the rendered
// system-map.md never enter the main bundle — they load only when a
// super-admin actually opens the System Map / Reference sub-tab.
const SystemMapCanvas = lazy(() =>
  import("./SystemMapCanvas").then((m) => ({ default: m.SystemMapCanvas })),
);
const SystemMapReference = lazy(() =>
  import("./SystemMapReference").then((m) => ({ default: m.SystemMapReference })),
);

function DocLoading() {
  const { t } = useTranslation('settingsDocs');
  return <p className="text-sm text-muted-foreground">{t('documentationTab.loading')}</p>;
}

/** Documentation surface. App Logic is public; the System Map is super-admin only. */
export function DocumentationTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { t } = useTranslation('settingsDocs');

  const guide = (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">{t('documentationTab.guide.title')}</CardTitle>
        <CardDescription>{t('documentationTab.guide.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <MarkdownDoc source={appLogicMd} />
      </CardContent>
    </Card>
  );

  if (!isSuperAdmin) return guide;

  return (
    <Tabs defaultValue="guide" className="space-y-4">
      <TabsList>
        <TabsTrigger value="guide">{t('documentationTab.tabs.guide')}</TabsTrigger>
        <TabsTrigger value="map">{t('documentationTab.tabs.map')}</TabsTrigger>
        <TabsTrigger value="reference">{t('documentationTab.tabs.reference')}</TabsTrigger>
      </TabsList>
      <TabsContent value="guide">{guide}</TabsContent>
      <TabsContent value="map">
        <Card>
          <CardHeader>
            <CardTitle className="font-display">{t('documentationTab.map.title')}</CardTitle>
            <CardDescription>{t('documentationTab.map.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<DocLoading />}>
              <SystemMapCanvas />
            </Suspense>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="reference">
        <Card>
          <CardHeader>
            <CardTitle className="font-display">{t('documentationTab.reference.title')}</CardTitle>
            <CardDescription>{t('documentationTab.reference.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<DocLoading />}>
              <SystemMapReference />
            </Suspense>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
