import appLogicMd from "../../../docs/app-logic.md?raw";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownDoc } from "./MarkdownDoc";
import { SystemMapCanvas } from "./SystemMapCanvas";
import { SystemMapReference } from "./SystemMapReference";

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
            <SystemMapCanvas />
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
            <SystemMapReference />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
