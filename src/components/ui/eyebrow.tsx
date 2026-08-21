import { cn } from '@/lib/utils';
import { TONES, type Tone } from './tones';

/**
 * The uppercase kicker above a title. 11px / 600 / +1.6px tracking, per the type
 * scale. This is the ONLY sanctioned way to render uppercase UI text: before it
 * existed the same label was hand-written four different ways across ~25 files.
 *
 * `section` is the quieter variant used for sidebar and menu group headers
 * (10px / +0.08em), which is a real second size rather than a fifth freehand one.
 */
export function Eyebrow({
  tone = 'neutral',
  section = false,
  className,
  children,
}: {
  tone?: Tone;
  section?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        'm-0 font-semibold uppercase',
        section ? 'text-[10px] tracking-[0.08em]' : 'text-[11px] tracking-[1.6px]',
        TONES[tone].fg,
        className,
      )}
    >
      {children}
    </p>
  );
}
