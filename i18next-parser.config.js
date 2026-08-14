// i18next-parser rebuilds each catalog fresh from source-scan order on every
// run, so a plain `sort: true` (alphabetical) or `sort: false` (scan order)
// both rewrite hand-authored catalogs even when no keys were added or
// removed — the merge never reuses the existing file's on-disk key order.
// `sort` also accepts a compare function (see the sort-keys package), which
// we use to pin the exact key order that src/i18n/locales/{en,de}/{common,
// help}.json already have on disk, so a dry-run extract leaves them
// byte-identical. New keys (not yet in this list) sort alphabetically after
// all known keys, so future extraction still works normally.
const EXISTING_KEY_ORDER = [
  // src/i18n/locales/{en,de}/common.json (en/de share the same key order)
  'nav',
  'workspace',
  'catalog',
  'system',
  'dashboard',
  'bookings',
  'hireOrders',
  'availability',
  'chats',
  'help',
  'productions',
  'artists',
  'admin',
  'settings',
  'platform',
  'breadcrumb',
  'home',
  'account',
  'language',
  'profile',
  'signOut',
  // src/i18n/locales/{en,de}/help.json (en/de share the same key order)
  'eyebrow',
  'hero',
  'lede',
  'tabs',
  'producer',
  'artist',
  'search',
  'filter',
  'all',
  'new',
  'badge',
  'ok',
  'count_unfiltered_one',
  'count_unfiltered_other',
  'count_filtered',
  'empty',
  'title',
  'body',
  'clear',
  'glossaryHeading',
  'stuck',
  'support',
  'footnote',
];

const KEY_RANK = new Map(EXISTING_KEY_ORDER.map((key, index) => [key, index]));

// sort-keys (used internally by i18next-parser) calls this per sibling
// group with bare key names, so a flat map is enough: as long as no two
// sibling groups disagree on the relative order of a shared key name, one
// global rank table reproduces every group's original order.
function preserveExistingOrder(a, b) {
  const rankA = KEY_RANK.has(a) ? KEY_RANK.get(a) : Infinity;
  const rankB = KEY_RANK.has(b) ? KEY_RANK.get(b) : Infinity;
  if (rankA !== rankB) return rankA - rankB;
  return a < b ? -1 : a > b ? 1 : 0;
}

export default {
  locales: ['en', 'de'],
  defaultNamespace: 'common',
  input: ['src/**/*.{ts,tsx}'],
  output: 'src/i18n/locales/$LOCALE/$NAMESPACE.json',
  keySeparator: '.',
  namespaceSeparator: false, // we pass ns via useTranslation('dashboard'); keys are dotted
  sort: preserveExistingOrder,
  failOnUpdate: false, // extract mode writes; the check script flips this on
  keepRemoved: true,   // do not delete keys the parser can't see (help content lives in TS modules)
};
