import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/components/ui/eyebrow';

/** The "still stuck" guidance card + the footnote. The card is informational:
 *  the "still stuck" body already tells each role who to ask, and neither
 *  escalation ("open the date chat", "ask an admin") has a wireable target from
 *  a general Help page, so no action button is rendered. */
export function HelpFooterCards() {
  const { t } = useTranslation('help');
  return (
    <>
      <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        <div className="rounded-card border-[0.5px] border-border bg-card p-4">
          <Eyebrow tone="accent" className="mb-2">{t('stuck.eyebrow')}</Eyebrow>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('stuck.body')}</p>
        </div>
      </section>
      <p className="text-eyebrow text-muted-foreground/60">{t('footnote')}</p>
    </>
  );
}
