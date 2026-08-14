import { useTranslation } from 'react-i18next';

/** The "still stuck" guidance card + the support-address note + the footnote.
 *  Both cards are informational: the "still stuck" body already tells each role
 *  who to ask, and neither escalation ("open the date chat", "ask an admin") has a
 *  wireable target from a general Help page, so no action buttons are rendered. */
export function HelpFooterCards() {
  const { t } = useTranslation('help');
  return (
    <>
      <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        <div className="rounded-[10px] border-[0.5px] border-border bg-card p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-600">{t('stuck.eyebrow')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('stuck.body')}</p>
        </div>
        <div className="rounded-[10px] border-[0.5px] border-border bg-muted/40 p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-600">{t('support.eyebrow')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('support.body')}</p>
        </div>
      </section>
      <p className="font-mono text-[11px] text-muted-foreground/60">{t('footnote')}</p>
    </>
  );
}
