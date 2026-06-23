import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchCronHealth, type CronHealthRow } from "@/data/platform";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

const STATUS_VARIANT: Record<CronHealthRow["status"], "default" | "destructive" | "secondary" | "outline"> = {
  healthy: "secondary",
  failing: "destructive",
  stale: "destructive",
  unknown: "outline",
};

export function SystemHealthTab() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "cron-health"],
    queryFn: () => fetchCronHealth(supabase),
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Scheduled job health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {isError && (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}
        {(data ?? []).map((j) => (
          <div
            key={j.job_name}
            className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border text-sm"
          >
            <div className="min-w-0">
              <div className="font-medium truncate">{j.job_name}</div>
              <div className="text-muted-foreground text-xs">
                {j.schedule ?? "—"} · last run{" "}
                {j.last_run_at ? new Date(j.last_run_at).toLocaleString() : "—"}
                {j.last_error ? ` · ${j.last_error}` : ""}
              </div>
            </div>
            <Badge variant={STATUS_VARIANT[j.status]}>
              {j.status}
              {j.last_status_code ? ` (${j.last_status_code})` : ""}
            </Badge>
          </div>
        ))}
        {!isLoading && !isError && (data ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">No scheduled-job health recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
