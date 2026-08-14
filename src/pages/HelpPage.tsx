import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthContext';
import { useLanguage } from '@/features/i18n/LanguageContext';
import { selectItems, groupByStage, countParams, type HelpFilter } from '@/lib/help/filter';
import type { HelpRole } from '@/lib/help/types';
import { Button } from '@/components/ui/button';
import { HelpRoleTabs } from '@/components/help/HelpRoleTabs';
import { HelpFilters } from '@/components/help/HelpFilters';
import { HelpStageSection } from '@/components/help/HelpStageSection';
import { HelpGlossary } from '@/components/help/HelpGlossary';
import { HelpFooterCards } from '@/components/help/HelpFooterCards';

const ROLE_ORDER: HelpRole[] = ['admin', 'producer', 'artist'];

export default function HelpPage() {
  const { t } = useTranslation('help');
  const { lang } = useLanguage();
  const { roles, currentOrg } = useAuth();
  const orgName = currentOrg?.name ?? '';

  const defaultRole: HelpRole = ROLE_ORDER.find((r) => roles.includes(r)) ?? 'admin';
  const [role, setRole] = useState<HelpRole>(defaultRole);
  const [filter, setFilter] = useState<HelpFilter>('all');
  const [query, setQuery] = useState('');
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  // If the active org changes via the org switcher while this page is mounted, the
  // viewer's roles can change too. Reset the default role tab and collapse open
  // answers for the new org. (Adjusting state during render is React's recommended
  // alternative to a useEffect for "reset state when a value changes".)
  const [seenOrgId, setSeenOrgId] = useState(currentOrg?.id);
  if (seenOrgId !== currentOrg?.id) {
    setSeenOrgId(currentOrg?.id);
    setRole(defaultRole);
    setOpenMap({});
  }

  const matched = selectItems(role, filter, query);
  const groups = groupByStage(matched);
  const c = countParams(role, filter, query, matched);
  const countLabel = c.filtered
    ? t('count_filtered', { matched: c.matched, total: c.total })
    : t('count_unfiltered', { count: c.total, newCount: c.newCount });

  const pickRole = (r: HelpRole) => {
    setRole(r);
    setOpenMap({});
  };
  const toggle = (id: string) => setOpenMap((m) => ({ ...m, [id]: !m[id] }));
  const clearFilters = () => {
    setQuery('');
    setFilter('all');
  };

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-6">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-600">
          {t('eyebrow')}
          {orgName ? ` · ${orgName.toUpperCase()}` : ''}
        </p>
        <h1 className="mb-2 text-balance font-display text-3xl font-semibold tracking-tight text-foreground">
          {t('hero')}
        </h1>
        <p className="max-w-[68ch] text-base leading-relaxed text-muted-foreground">{t('lede')}</p>
      </div>

      <div className="flex flex-col gap-3">
        <HelpRoleTabs role={role} onRole={pickRole} />
        <HelpFilters filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} countLabel={countLabel} />
      </div>

      {groups.map((g) => (
        <HelpStageSection key={g.stage} stage={g.stage} items={g.items} lang={lang} openMap={openMap} onToggle={toggle} />
      ))}

      {groups.length === 0 && (
        <div className="rounded-[10px] border-[0.5px] border-border bg-muted/40 p-8 text-center">
          <p className="mb-1 text-sm font-semibold text-foreground">{t('empty.title')}</p>
          <p className="mb-3.5 text-sm text-muted-foreground">{t('empty.body')}</p>
          <Button onClick={clearFilters}>{t('empty.clear')}</Button>
        </div>
      )}

      <HelpGlossary lang={lang} />
      <HelpFooterCards />
    </div>
  );
}
