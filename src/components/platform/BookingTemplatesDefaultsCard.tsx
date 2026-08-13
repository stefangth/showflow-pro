import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchPlatformBookingTemplates,
  savePlatformBookingTemplates,
} from "@/data/platform";
import {
  BOOKING_FLOW_TEMPLATE_DEFAULTS,
  normalizeBookingFlow,
  type BookingFlowTemplates,
  type BookingTemplateName,
} from "@/lib/bookingFlow";
import { useDerivedDraft } from "@/hooks/useDerivedDraft";
import { FlowTimeline } from "@/components/settings/bookingFlow/FlowTimeline";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

const TEMPLATE_LABELS: Record<BookingTemplateName, string> = {
  classic: "Classic",
  fasttrack: "Fast-track",
  direct: "Direct book",
  off: "Off",
};

export function BookingTemplatesDefaultsCard() {
  const qc = useQueryClient();
  const [active, setActive] = useState<BookingTemplateName>("classic");
  const query = useQuery({
    queryKey: ["platform", "booking-flow-templates"],
    queryFn: () => fetchPlatformBookingTemplates(supabase),
  });
  const [templates, setTemplates] = useDerivedDraft<BookingFlowTemplates>(query.data, BOOKING_FLOW_TEMPLATE_DEFAULTS);
  const save = useMutation({
    mutationFn: () => savePlatformBookingTemplates(supabase, templates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform", "booking-flow-templates"] });
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Booking templates saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isLoading || !templates) return <Skeleton className="h-96 w-full" />;
  if (query.isError) return <Alert variant="destructive"><AlertDescription>{(query.error as Error).message}</AlertDescription></Alert>;

  const definition = templates[active];
  const update = (next: Partial<typeof definition>) => setTemplates((current) => ({
    ...current,
    [active]: { ...current[active], ...next },
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking flow templates</CardTitle>
        <CardDescription>
          Templates copied into organizations when selected. Changes here do not rewrite existing organization settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={active} onValueChange={(value) => setActive(value as BookingTemplateName)}>
          <TabsList>
            {(Object.keys(TEMPLATE_LABELS) as BookingTemplateName[]).map((name) => (
              <TabsTrigger key={name} value={name} onClick={() => setActive(name)}>{TEMPLATE_LABELS[name]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <FlowTimeline
          flow={definition.flow}
          times={definition.times}
          onFlowChange={(patch) => update({
            flow: normalizeBookingFlow({ ...definition.flow, ...patch, active: active !== "off" }),
          })}
          onTimesChange={(patch) => update({ times: { ...definition.times, ...patch } })}
          customFields={[]}
          referencePreview="Offer: Candlelight · Apr 30, Berlin"
          allowCustomReference={false}
        />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save booking templates</Button>
      </CardContent>
    </Card>
  );
}
