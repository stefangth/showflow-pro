import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchCronHealth, fetchEdgeFnLogs, fetchEdgeFnMetrics, fetchEmailHealth, fetchHealthDaily } from "@/data/platform";
import { EMAIL_HEALTH, SYSTEM_HEALTH } from "@/config/app.config";

export function useCronHealth() {
  return useQuery({
    queryKey: ["platform", "cron-health"],
    queryFn: () => fetchCronHealth(supabase),
    refetchInterval: SYSTEM_HEALTH.refetchMs,
  });
}

/** Daily rollup behind the uptime bar. Cheap (one indexed RPC over ~30 days x ~26 functions),
 *  so unlike the Analytics-backed queries below it has no rate-limit concerns. */
export function useHealthDaily() {
  return useQuery({
    queryKey: ["platform", "health-daily", SYSTEM_HEALTH.uptimeDays],
    queryFn: () => fetchHealthDaily(supabase, SYSTEM_HEALTH.uptimeDays),
    refetchInterval: SYSTEM_HEALTH.refetchMs,
    // Supplementary like the other panels: a rollup outage must not blank the tab.
    retry: 1,
  });
}

export function useEdgeFnMetrics() {
  return useQuery({
    queryKey: ["platform", "edge-metrics", SYSTEM_HEALTH.windowMinutes],
    queryFn: () => fetchEdgeFnMetrics(supabase, SYSTEM_HEALTH.windowMinutes),
    refetchInterval: SYSTEM_HEALTH.refetchMs,
    staleTime: Infinity, // the interval is the sole fetch driver — no extra mount/focus refetches (the Analytics PAT is rate-limited to 60/min).
    // Latency is supplementary — a metrics outage must not blank the tab (panels show cron status only).
    retry: 1,
  });
}

/** Error/warning log lines for one function. `enabled` gates the fetch so the
 *  query only fires when a panel row is actually expanded. */
export function useEdgeFnLogs(fn: string, enabled: boolean) {
  return useQuery({
    queryKey: ["platform", "edge-logs", fn, SYSTEM_HEALTH.windowMinutes],
    queryFn: () => fetchEdgeFnLogs(supabase, fn, SYSTEM_HEALTH.windowMinutes),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useEmailHealth(windowMinutes: number = EMAIL_HEALTH.windowMinutes) {
  return useQuery({
    queryKey: ["platform", "email-health", windowMinutes],
    queryFn: () => fetchEmailHealth(supabase, windowMinutes),
    refetchInterval: SYSTEM_HEALTH.refetchMs,
    staleTime: Infinity, // the interval is the sole fetch driver — no extra mount/focus refetches.
    // Resilient — a metrics outage must not blank the tab (mirrors useEdgeFnMetrics above).
    retry: 1,
  });
}
