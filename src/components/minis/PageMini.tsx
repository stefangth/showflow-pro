import type { ReactNode } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { isImpersonating } from '@/features/auth/orgRoles';
import { useLanguage } from '@/features/i18n/LanguageContext';
import { useRailDismissed } from '@/components/setup/useRailDismissed';
import { DashboardWelcomeCollapsed } from '@/components/dashboard/firstRun/DashboardWelcomeCollapsed';
import type { Lang } from '@/i18n/config';
import { MINIS, resolveMiniRole, type MiniDef, type MiniRole, type RegisteredPageKey } from '@/lib/minis';
import { ART } from './illustrations';

/** Resume-bar copy (bilingual). Kept here since it is chrome, not per-page content. */
const RESUME_HINT: Record<Lang, string> = {
  en: 'Pick up where you left off',
  de: 'Mach dort weiter, wo du aufgehört hast',
};
const RESUME_CTA: Record<Lang, string> = { en: 'Resume', de: 'Wieder einblenden' };

const STEP_NUMBERS = ['01', '02', '03', '04'] as const;

export interface PageMiniViewProps {
  def: MiniDef;
  role: MiniRole;
  lang: Lang;
  art: readonly [ReactNode, ReactNode, ReactNode, ReactNode];
  dismissed: boolean;
  onHide: () => void;
  onResume: () => void;
}

/** Pure presentational frame — no auth/storage, so it renders in tests directly. */
export function PageMiniView({ def, role, lang, art, dismissed, onHide, onResume }: PageMiniViewProps) {
  const steps = def.variants[role];
  if (!steps) return null;

  if (dismissed) {
    return (
      <DashboardWelcomeCollapsed
        label={def.eyebrow[lang]}
        hint={RESUME_HINT[lang]}
        ctaLabel={RESUME_CTA[lang]}
        onOpen={onResume}
      />
    );
  }

  return (
    <section className="rounded-l border-[0.5px] border-border bg-card p-4" aria-label={def.eyebrow[lang]}>
      <div className="flex items-center gap-3 pb-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {def.eyebrow[lang]}
        </span>
        <span className="flex-1" />
        {def.subnote && (
          <span className="hidden text-[12px] text-muted-foreground/70 sm:inline">{def.subnote[lang]}</span>
        )}
        <button
          type="button"
          onClick={onHide}
          className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {lang === 'de' ? 'Ausblenden' : 'Hide'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-l border-[0.5px] border-border bg-background p-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] font-semibold text-accent-600">{STEP_NUMBERS[i]}</span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-600">
                {step.label[lang]}
              </span>
            </div>
            {art[i]}
            <p className="text-pretty text-[12px] leading-4 text-muted-foreground">{step.text[lang]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Container: resolves the viewer's role + dismissal and renders the mini for `page`. */
export function PageMini({ page }: { page: RegisteredPageKey }) {
  const def = MINIS[page];
  const { hasRole, isSuperAdmin, roles, viewAsRole, viewAsUser, currentOrg } = useAuth();
  const { lang } = useLanguage();
  const orgId = currentOrg?.id ?? null;
  const [dismissed, dismiss, undismiss] = useRailDismissed(`mini.${page}`, orgId);

  const role = resolveMiniRole(def, {
    hasRole,
    isSuperAdmin,
    impersonating: isImpersonating({ isSuperAdmin, roles, viewAsRole, viewAsUser }),
  });
  if (!role) return null;

  return (
    <PageMiniView
      def={def}
      role={role}
      lang={lang}
      art={ART[page]}
      dismissed={dismissed}
      onHide={dismiss}
      onResume={undismiss}
    />
  );
}
