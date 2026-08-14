import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrganizationsTab } from "@/components/platform/OrganizationsTab";
import { UsersTab } from "@/components/platform/UsersTab";
import { PlatformAdminsTab } from "@/components/platform/PlatformAdminsTab";
import { PlatformDefaultsTab } from "@/components/platform/PlatformDefaultsTab";
import { SystemHealthTab } from "@/components/platform/SystemHealthTab";
import { PageMini } from "@/components/minis/PageMini";

export default function PlatformPage() {
  const [tab, setTab] = useState("orgs");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Platform Console</h1>
        <p className="text-muted-foreground mt-1">Organizations, users, platform admins and defaults</p>
      </div>
      <PageMini page="platform" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orgs">Organizations</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="admins">Platform Admins</TabsTrigger>
          <TabsTrigger value="defaults">Platform Defaults</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
        </TabsList>
        <TabsContent value="orgs" className="mt-4"><OrganizationsTab /></TabsContent>
        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
        <TabsContent value="admins" className="mt-4"><PlatformAdminsTab /></TabsContent>
        <TabsContent value="defaults" className="mt-4"><PlatformDefaultsTab /></TabsContent>
        <TabsContent value="health" className="mt-4"><SystemHealthTab /></TabsContent>
      </Tabs>
    </div>
  );
}
