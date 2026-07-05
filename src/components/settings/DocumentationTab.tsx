import { lazy, Suspense } from "react";
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
  return <p className="text-sm text-muted-foreground">Loading…</p>;
}

/** Documentation surface. App Logic is public; the System Map is super-admin only. */
export function DocumentationTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const guide = (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">App Logic Guide</CardTitle>
        <CardDescription>
          How ShowFlow works: roles, data model, eligibility, and the full availability → booking flow.
        </CardDescription>
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
        <TabsTrigger value="guide">App Logic</TabsTrigger>
        <TabsTrigger value="map">System Map</TabsTrigger>
        <TabsTrigger value="reference">Reference</TabsTrigger>
      </TabsList>
      <TabsContent value="guide">{guide}</TabsContent>
      <TabsContent value="map">
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Automation Engine Map</CardTitle>
            <CardDescription>
              Every trigger, edge function, database guard, and side effect — click a node for its dossier.
            </CardDescription>
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
            <CardTitle className="font-display">System Map Reference</CardTitle>
            <CardDescription>The full written map (docs/system-map.md).</CardDescription>
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
