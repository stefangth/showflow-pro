import { Eyebrow } from './eyebrow';
import type { Tone } from './tones';

/**
 * Eyebrow, H1, sub line, actions. Every page uses it, so the 32px headline and the
 * -0.6px tracking are decided once. Actions are a slot rather than props: the rule
 * that only one of them may be primary is enforced by review, not by the type.
 */
export function PageHeader({
  eyebrow,
  eyebrowTone = 'accent',
  title,
  sub,
  actions,
}: {
  eyebrow?: string;
  eyebrowTone?: Tone;
  title: string;
  sub?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        {eyebrow && <Eyebrow tone={eyebrowTone}>{eyebrow}</Eyebrow>}
        <h1 className="m-0 mt-1 text-[32px] font-semibold tracking-[-0.6px]">{title}</h1>
        {sub && <p className="m-0 mt-1.5 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2 pt-1.5">{actions}</div>}
    </div>
  );
}
