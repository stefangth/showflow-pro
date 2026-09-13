import { useAuth } from "@/features/auth/AuthContext";
import { DEFAULT_ORG_KIND, type OrgKind } from "@/lib/orgKind";

/** The active org's workspace type. Production while no org is resolved (cold load,
 *  public pages), mirroring useFeature's registry-default fallback. Presentation
 *  decisions branch on this; vocabulary flows through VocabularyBridge instead. */
export function useOrgKind(): OrgKind {
  const { currentOrg } = useAuth();
  return currentOrg?.org_kind ?? DEFAULT_ORG_KIND;
}
