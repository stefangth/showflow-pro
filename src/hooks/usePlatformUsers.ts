import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchPlatformUsers, setMembership, removeMembership, linkArtist, manageUser,
  type ManageUserBody,
} from "@/data/platformUsers";
import type { AppRole } from "@/config/app.config";

const KEY = ["platform", "users"] as const;

export function usePlatformUsers() {
  return useQuery({ queryKey: KEY, queryFn: () => fetchPlatformUsers(supabase) });
}

function useInvalidating<T>(fn: (vars: T) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export const useSetMembership = () =>
  useInvalidating((v: { orgId: string; userId: string; role: AppRole; action: "add" | "remove" }) => setMembership(supabase, v));
export const useRemoveMembership = () =>
  useInvalidating((v: { orgId: string; userId: string }) => removeMembership(supabase, v));
export const useLinkArtist = () =>
  useInvalidating((v: { orgId: string; userId: string; artistId: string | null }) => linkArtist(supabase, v));
export const useManageUser = () =>
  useInvalidating((v: ManageUserBody) => manageUser(supabase, v));
