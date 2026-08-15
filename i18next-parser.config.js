// i18next-parser rebuilds each catalog fresh from source-scan order on every
// run, so a plain `sort: true` (alphabetical) or `sort: false` (scan order)
// both rewrite hand-authored catalogs even when no keys were added or
// removed — the merge never reuses the existing file's on-disk key order.
// `sort` also accepts a compare function (see the sort-keys package), which
// we use to pin the exact key order that src/i18n/locales/{en,de}/{common,
// help}.json already have on disk, so a dry-run extract leaves them
// byte-identical. New keys (not yet in this list) sort alphabetically after
// all known keys, so future extraction still works normally.
//
// LOCAL-ONLY BY DECISION (2026-08-15): the parser stays an authoring aid and is
// deliberately NOT gated in CI. Two independent noise sources make a byte- or
// key-identical `--fail-on-update` gate impossible to keep green without also
// suppressing genuine signal:
//
//   1. Cross-namespace ordering. This single flat rank table cannot preserve
//      on-disk order across namespaces whose sibling groups disagree on a shared
//      key's relative order (e.g. `dashboard` orders `artist` before `producer`
//      while `help.json` orders `producer` before `artist`) — no global rank
//      reproduces both.
//   2. Plural over-generation. For any `t(key, {count})` call the parser emits
//      speculative `key_one`/`key_other` variants (empty-valued), even where the
//      copy is intentionally a SINGLE form that does not vary with count
//      (e.g. artists `import.done.errorsSuffix` = ", {{count}} need attention").
//      There is no per-key opt-out, and a genuinely-missing key is ALSO emitted
//      empty-valued — indistinguishable from the speculative plurals — so any
//      heuristic that filters the noise also hides the real drift.
//
// The gate would be redundant regardless: genuine drift is already caught by the
// existing CI gates — a key referenced in code but absent from a catalog is a
// `tsc` compile error (resources are typed via `typeof en<Namespace>` in
// src/i18n/react-i18next.d.ts), en/de parity is `src/i18n/keyParity.test.ts`,
// and paste-throughs/style are `translationCompleteness.test.ts` + `copyLint.test.ts`.
// So `npm run i18n:check` remains a LOCAL convenience only (it will report the
// ordering/plural rewrites above; that is expected, not a failure to fix).
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
