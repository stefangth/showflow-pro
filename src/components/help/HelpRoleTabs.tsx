import { useTranslation } from 'react-i18next';
import type { HelpRole } from '@/lib/help/types';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';

const ROLES: HelpRole[] = ['admin', 'producer', 'artist'];
const TAB_KEY = { admin: 'tabs.admin', producer: 'tabs.producer', artist: 'tabs.artist' } as const;

export function HelpRoleTabs({ role, onRole }: { role: HelpRole; onRole: (r: HelpRole) => void }) {
  const { t } = useTranslation('help');
  const options: SegmentedControlOption<HelpRole>[] = ROLES.map((r) => ({
    value: r,
    label: t(TAB_KEY[r]),
  }));
  return <SegmentedControl value={role} onChange={onRole} options={options} className="self-start" />;
}
