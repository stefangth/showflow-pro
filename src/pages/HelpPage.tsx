import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthContext';
import { useLanguage } from '@/features/i18n/LanguageContext';
import { useOrgKind } from '@/hooks/useOrgKind';
import { selectItems, groupByStage, countParams, findItem, type HelpFilter } from '@/lib/help/filter';
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
  const orgKind = useOrgKind();
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

  // Deep links. `/help?item=<id>` is what the get-running wizard's "Read more" links
  // carry: switch to the tab that owns the answer, expand it, and scroll it into view.
  // `/help?q=<text>` prefills the search for a topic with no single answer of its own.
  //
  // Tracked by the applied VALUE, not a one-shot boolean, so a later in-app link that
  // only changes the query string still lands, while a re-render with the same params
  // never reopens something the reader deliberately collapsed. Same "adjust state during
  // render" idiom as the org reset above. An unknown id resolves to null and the page
  // renders normally: a stale link from an older build must not blank the help center.
  const [params] = useSearchParams();
  const itemParam = params.get('item');
  const qParam = params.get('q') ?? '';
  const paramKey = `${itemParam ?? ''}|${qParam}`;
  const target = itemParam ? findItem(itemParam) : null;
  const [appliedParams, setAppliedParams] = useState<string | null>(null);
  if (appliedParams !== paramKey) {
    setAppliedParams(paramKey);
    if (target) {
      setRole(target.role);
      setOpenMap({ [target.id]: true });
    }
    if (qParam) setQuery(qParam);
  }

  // Scrolling has to wait for the expanded row to exist, so it runs after the commit that
  // applied the param rather than during it.
  useEffect(() => {
    if (!target) return;
    document.getElementById(`help-${target.id}`)?.scrollIntoView({ block: 'center' });
  }, [target]);

  const matched = selectItems(role, filter, query, orgKind);
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
        {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking/color + two children, not a straight Eyebrow swap */}
        <p className="mb-1.5 text-eyebrow font-semibold uppercase tracking-[0.14em] text-accent-600">
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
        <div className="rounded-card border-[0.5px] border-border bg-well-tint p-8 text-center">
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
