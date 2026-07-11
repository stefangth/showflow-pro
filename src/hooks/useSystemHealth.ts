import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchCronHealth, fetchEdgeFnMetrics, fetchEmailHealth } from "@/data/platform";
import { EMAIL_HEALTH, SYSTEM_HEALTH } from "@/config/app.config";

export function useCronHealth() {
  return useQuery({
    queryKey: ["platform", "cron-health"],
    queryFn: () => fetchCronHealth(supabase),
    refetchInterval: SYSTEM_HEALTH.refetchMs,
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
