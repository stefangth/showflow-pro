import type { Lang } from '@/i18n/config';
import type { HelpItem } from '@/lib/help/items';
import { STAGES } from '@/lib/help/stages';
import { HelpItemRow } from './HelpItemRow';

export function HelpStageSection({
  stage,
  items,
  lang,
  openMap,
  onToggle,
}: {
  stage: number;
  items: HelpItem[];
  lang: Lang;
  openMap: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  const s = STAGES[stage];
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[17px] font-semibold tracking-tight text-foreground">{s.title[lang]}</h2>
        <span className="text-xs text-muted-foreground/60">{s.moment[lang]}</span>
      </div>
      <div className="overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card">
        {items.map((i) => (
          <HelpItemRow key={i.id} item={i} lang={lang} open={!!openMap[i.id]} onToggle={() => onToggle(i.id)} />
        ))}
      </div>
    </section>
  );
}
