import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  createDemoOrg,
  fetchCapturedSends,
  fetchDemoState,
  resetDemoOrg,
  runCue,
  updateDemoState,
  wipeDemoOrg,
  type DemoStateRow,
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

/** A demo org's simulation state (volume, prospect label, sim clock, current scene/script). */
export function useDemoState(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["demo", "state", orgId],
    queryFn: () => fetchDemoState(supabase, orgId!),
    enabled: !!orgId,
  });
}

export function useUpdateDemoState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orgId: string; patch: Partial<Pick<DemoStateRow, "volume" | "prospect_label" | "sim_now" | "current_scene_id" | "script_id">> }) =>
      updateDemoState(supabase, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["demo", "state"] }),
  });
}

/** Fires a scripted demo cue. Cues mutate domain data (bookings, offers, ...), so
 *  like reset/wipe this deliberately busts the entire query cache. */
export function useRunCue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orgId: string; cueId: string }) => runCue(supabase, args),
    onSuccess: () => invalidateEverything(qc),
  });
}
