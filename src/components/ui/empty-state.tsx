import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * Every empty state in the app. The type deliberately makes an empty state without
 * a next action impossible unless you say why: pass `action`, or pass `reason` and
 * explain in the string. State the fact, then the next action.
 *
 * `size="block"` is a page or panel. `size="inline"` is a rail, cell or list.
 */
type Base = { title: string; body?: string; size?: 'block' | 'inline'; icon?: LucideIcon; className?: string };
type WithAction = Base & { action: { label: string; onClick: () => void }; reason?: never };
type WithReason = Base & { action?: never; reason: string };

export function EmptyState(props: WithAction | WithReason) {
  const { title, body, size = 'block', icon: Icon, className, action } = props;

  if (size === 'inline') {
    return (
      <div className={cn('py-2', className)}>
        <p className="m-0 text-[13px] text-muted-foreground">{title}</p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-1.5 text-[13px] font-medium text-accent-text hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-dashed border-border px-8 py-11 text-center', className)}>
      {Icon && (
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="m-0 mt-3.5 text-[22px] font-semibold tracking-[-0.3px]">{title}</p>
      {body && <p className="mx-auto mb-0 mt-2 max-w-[420px] text-[13px] leading-5 text-muted-foreground">{body}</p>}
      {action && (
        <Button variant="secondary" onClick={action.onClick} className="mt-[18px]">
          {action.label}
        </Button>
      )}
    </div>
  );
}
