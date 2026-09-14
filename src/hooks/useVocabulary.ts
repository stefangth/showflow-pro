import { useLanguage } from "@/features/i18n/LanguageContext";
import { useOrgKind } from "@/hooks/useOrgKind";
import { VOCABULARY, type Vocabulary } from "@/lib/orgKind";

/** The active org's vocabulary table for the active language, for copy modules that
 *  bypass i18next (Help items, glossary, page minis). Pair with interpolateVocabulary. */
export function useVocabulary(): Vocabulary {
  const kind = useOrgKind();
  const { lang } = useLanguage();
  return VOCABULARY[kind][lang];
}
