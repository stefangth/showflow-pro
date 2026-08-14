import { useTranslation } from 'react-i18next';
import type { HelpRole } from '@/lib/help/types';
import { cn } from '@/lib/utils';

const ROLES: HelpRole[] = ['admin', 'producer', 'artist'];
const TAB_KEY = { admin: 'tabs.admin', producer: 'tabs.producer', artist: 'tabs.artist' } as const;

export function HelpRoleTabs({ role, onRole }: { role: HelpRole; onRole: (r: HelpRole) => void }) {
  const { t } = useTranslation('help');
  return (
    <div className="inline-flex gap-0.5 self-start rounded-lg bg-muted p-[3px]">
      {ROLES.map((r) => (
        <button
          key={r}
          onClick={() => onRole(r)}
          aria-pressed={role === r}
          className={cn(
            'rounded-md px-3.5 py-[7px] text-[13px] transition-colors',
            role === r
              ? 'bg-card font-semibold text-foreground shadow-sm'
              : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          {t(TAB_KEY[r])}
        </button>
      ))}
    </div>
  );
}
