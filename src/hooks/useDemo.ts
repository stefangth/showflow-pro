import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  createDemoOrg,
  fetchCapturedSends,
  resetDemoOrg,
  wipeDemoOrg,
} from "@/data/demo";

/** The demo org's captured-send outbox (diverted emails/PDFs), newest-first. */
export function useCapturedSends(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["demo", "outbox", orgId],
    queryFn: () => fetchCapturedSends(supabase, orgId!),
    enabled: !!orgId,
  });
}

/** A reset/wipe/reseed rewrites everything a demo org shows (bookings, shows,
 *  artists, hire orders, ...), so unlike the single-domain invalidation rule
 *  elsewhere, these mutations deliberately bust the entire query cache rather
 *  than one prefix. */
function invalidateEverything(qc: QueryClient) {
  qc.invalidateQueries();
}

export function useResetDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orgId: string; volume: "small" | "full" }) => resetDemoOrg(supabase, args),
    onSuccess: () => invalidateEverything(qc),
  });
}

export function useWipeDemoOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orgId: string }) => wipeDemoOrg(supabase, args),
    onSuccess: () => invalidateEverything(qc),
  });
}

export function useCreateDemoOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { name: string; slug: string; adminEmail: string; appOrigin: string; volume: "small" | "full" }) =>
      createDemoOrg(supabase, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform"] }),
  });
}
