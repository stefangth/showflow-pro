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
 * `activeSkills` is the picker's own catalog, which excludes archived skills. That split is
 * what lets one handler tell the two collisions apart: a name already in that list is a
 * plain duplicate, while a name that passes the check and is then rejected by the org_id +
 * name unique index must belong to an ARCHIVED skill, which Settings > Skills restores.
 * Copy is reused from `settingsSkills`, where the same two cases are already worded.
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
      toast.error(isNameTaken(e) ? t("toast.collisionArchived", { name }) : toErrorMessage(e, t("toast.addFailed")));
      throw e;
    }
  };
}
