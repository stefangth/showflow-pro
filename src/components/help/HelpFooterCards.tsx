import { useTranslation } from 'react-i18next';
import type { HelpRole } from '@/lib/help/types';
import { Button } from '@/components/ui/button';

const ESCALATE_KEY = { admin: 'escalate.admin', producer: 'escalate.producer', artist: 'escalate.artist' } as const;

export function HelpFooterCards({ role, orgName }: { role: HelpRole; orgName: string }) {
  const { t } = useTranslation('help');
  return (
    <>
      <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        <div className="rounded-[10px] border-[0.5px] border-border bg-card p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-600">{t('stuck.eyebrow')}</p>
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{t('stuck.body')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm">{t(ESCALATE_KEY[role])}</Button>
            <Button size="sm" variant="outline">{t('stuck.roles')}</Button>
          </div>
        </div>
        <div className="rounded-[10px] border-[0.5px] border-border bg-muted/40 p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-600">{t('support.eyebrow')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('support.body', { org: orgName })}</p>
        </div>
      </section>
      <p className="font-mono text-[11px] text-muted-foreground/60">{t('footnote')}</p>
    </>
  );
}
