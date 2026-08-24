import { useTranslation } from 'react-i18next';
import type { Lang } from '@/i18n/config';
import { GLOSSARY } from '@/lib/help/glossary';
import { termLabel } from '@/i18n/terms';

export function HelpGlossary({ lang }: { lang: Lang }) {
  const { t } = useTranslation('help');
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-title-sm font-semibold tracking-tight text-foreground">{t('glossaryHeading')}</h2>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {GLOSSARY.map((g) => (
          <div key={g.term} className="rounded-card border-[0.5px] border-border bg-card p-3.5">
            <p className="mb-1 text-control font-semibold text-foreground">{termLabel(g.term, lang)}</p>
            <p className="text-control leading-relaxed text-muted-foreground">{g.def[lang]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
