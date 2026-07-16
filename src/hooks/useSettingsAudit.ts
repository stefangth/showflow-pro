import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchSettingsAudit } from "@/data/settingsAudit";

export function useSettingsAudit(keys: string[]) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id;
  return useQuery({
    queryKey: ["app-settings", "audit", orgId, ...keys],
    queryFn: () => fetchSettingsAudit(supabase, { orgId: orgId!, keys }),
    enabled: Boolean(orgId),
  });
}
