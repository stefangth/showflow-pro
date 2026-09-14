import { useLayoutEffect } from "react";
import i18n from "@/i18n";
import { isLang, DEFAULT_LANGUAGE } from "@/i18n/config";
import { DEFAULT_ORG_KIND } from "@/lib/orgKind";
import { useLanguage } from "@/features/i18n/LanguageContext";
import { useOrgKind } from "@/hooks/useOrgKind";
import { applyVocabulary } from "./vocabulary";

/**
 * Keeps i18next's default interpolation variables in step with the active org's
 * workspace type and the active language, so every `{{noun}}` in the locale files
 * reads in that org's vocabulary with no per-component wiring. When the table
 * changes, re-announcing the current language makes react-i18next re-render every
 * useTranslation consumer (i18next emits languageChanged unconditionally).
 */
export function VocabularyBridge(): null {
  const kind = useOrgKind();
  const { lang } = useLanguage();
  useLayoutEffect(() => {
    const effective = isLang(i18n.language) ? i18n.language : lang;
    if (applyVocabulary(i18n, kind, effective)) void i18n.changeLanguage(effective);
  }, [kind, lang]);
  // On unmount (sign-out to a layout-less public route: login, accept-invite, privacy,
  // sandbox), drop the org's vocabulary from the i18next singleton so a public page can
  // never render stale workspace-specific words. Reset to the production defaults for the
  // current language. Own effect with empty deps so it fires only on unmount, not between
  // kind/lang changes. Empty is the default state (i18n init seeds the production table).
  useLayoutEffect(() => {
    return () => {
      const effective = isLang(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
      applyVocabulary(i18n, DEFAULT_ORG_KIND, effective);
    };
  }, []);
  return null;
}
