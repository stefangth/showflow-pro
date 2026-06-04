import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import { savePlatformSetting, EMPTY_STARTER_TEMPLATE, type StarterCatalogTemplate } from "@/data/platform";
import { parseLines, serializeLines, parseCasts, serializeCasts } from "./templateText";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

export function PlatformDefaultsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["platform", "starter-template"],
    queryFn: () => resolveOrgSetting<StarterCatalogTemplate>(supabase, null, "starter_catalog_template", EMPTY_STARTER_TEMPLATE),
  });

  const [skills, setSkills] = useState("");
  const [cities, setCities] = useState("");
  const [casts, setCasts] = useState("");

  useEffect(() => {
    if (!data) return;
    setSkills(serializeLines(data.skills ?? []));
    setCities(serializeLines(data.cities ?? []));
    setCasts(serializeCasts(data.casts ?? []));
  }, [data]);

  const save = useMutation({
    mutationFn: () => savePlatformSetting(supabase, "starter_catalog_template", {
      skills: parseLines(skills), cities: parseLines(cities), casts: parseCasts(casts),
    } as never),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform", "starter-template"] }); toast.success("Starter catalog saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Starter catalog template</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          New organizations are seeded with these skills, cities and casts. One item per line. Casts use <code>Name :: Description</code>.
        </p>
        <div className="space-y-1.5"><Label htmlFor="t-skills">Skills</Label><Textarea id="t-skills" rows={6} value={skills} onChange={(e) => setSkills(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="t-cities">Cities</Label><Textarea id="t-cities" rows={3} value={cities} onChange={(e) => setCities(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="t-casts">Casts</Label><Textarea id="t-casts" rows={3} value={casts} onChange={(e) => setCasts(e.target.value)} /></div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save defaults</Button>
      </CardContent>
    </Card>
  );
}
