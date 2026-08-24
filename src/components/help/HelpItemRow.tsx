import { Plus, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Lang } from '@/i18n/config';
import type { HelpItem } from '@/lib/help/items';

export function HelpItemRow({
  item,
  lang,
  open,
  onToggle,
}: {
  item: HelpItem;
  lang: Lang;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('help');
  return (
    // The id is the scroll anchor for `/help?item=<id>` deep links (see HelpPage).
    <div id={`help-${item.id}`} className="border-b-[0.5px] border-border last:border-b-0">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-hover-tint"
      >
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{item.q[lang]}</span>
        {item.status === 'new' ? (
          <span className="shrink-0 rounded bg-accent-tint px-1.5 py-0.5 text-eyebrow font-semibold text-accent-text">
            {t('badge.new')}
          </span>
        ) : (
          <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-eyebrow font-semibold text-success">
            {t('badge.ok')}
          </span>
        )}
        <span className="w-5 shrink-0 text-center text-muted-foreground/60" aria-hidden="true">
          {open ? <Minus className="inline h-3.5 w-3.5" /> : <Plus className="inline h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 px-4 pb-4 duration-150">
          <p className="mb-2.5 max-w-[78ch] text-sm leading-relaxed text-foreground">{item.a[lang]}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-well-tint px-1.5 py-0.5 font-mono text-eyebrow text-muted-foreground">
              {item.surface}
            </span>
            <span className="font-mono text-eyebrow text-muted-foreground/60">{item.id}</span>
          </div>
        </div>
      )}
    </div>
  );
}
