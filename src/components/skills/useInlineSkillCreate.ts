import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCreateSkill, type Skill } from "@/hooks/useSkills";
import { toErrorMessage } from "@/lib/errors";

/** Postgres unique-violation, however supabase-js hands it back (a plain object with a
 *  `code`, or an Error whose message carries the constraint text). */
function isNameTaken(e: unknown): boolean {
  if (e && typeof e === "object" && (e as { code?: unknown }).code === "23505") return true;
  return /duplicate key|already exists|unique constraint/i.test(toErrorMessage(e, ""));
}

/**
 * The `onCreate` handler behind `SkillPicker`'s inline "New skill" chip: creates the skill
 * and, on failure, says WHY. `SkillPicker` swallows the rejection by design (it only has to
 * keep the selection clean), so without this the producer would get a form that just sits
 * there.
 *
 * `activeSkills` is the picker's own catalog, which excludes archived skills, so a name
 * already in that list is a plain duplicate and is caught with no round trip. A name that
 * passes that check and is then rejected by the org_id + name unique index is USUALLY an
 * archived skill, but not always: the index is case-sensitive while the pre-check is not,
 * and a stale cache, a concurrent create, or a row RLS did not return produce the same
 * rejection. So that branch says the name is taken and offers Settings > Skills as the
 * place to look, rather than promising a Restore that may not be there.
 */
export function useInlineSkillCreate(activeSkills: { id: string; name: string }[]) {
  const { t } = useTranslation("settingsSkills");
  const createSkill = useCreateSkill();

  return async (name: string): Promise<Skill> => {
    if (activeSkills.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      toast.error(t("toast.collisionExists", { name }));
      throw new Error(t("toast.collisionExists", { name }));
    }
    try {
      return await createSkill.mutateAsync(name);
    } catch (e) {
      toast.error(isNameTaken(e) ? t("toast.collisionMaybeArchived", { name }) : toErrorMessage(e, t("toast.addFailed")));
      throw e;
    }
  };
}
