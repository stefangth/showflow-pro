import type { i18n as I18n } from "i18next";
import type { Lang } from "@/i18n/config";
import { VOCABULARY, type OrgKind } from "@/lib/orgKind";

/**
 * Install the (kind, lang) vocabulary as i18next's interpolation.defaultVariables.
 * The Translator reads that object on every t() call, so mutating it is enough for
 * the next render; VocabularyBridge triggers that render. Returns true when the
 * installed table actually changed, so callers can skip the re-render nudge.
 */
export function applyVocabulary(i18n: I18n, kind: OrgKind, lang: Lang): boolean {
  const next = VOCABULARY[kind][lang];
  const interpolation = (i18n.options.interpolation ??= {});
  if (interpolation.defaultVariables === next) return false;
  interpolation.defaultVariables = next;
  return true;
}
