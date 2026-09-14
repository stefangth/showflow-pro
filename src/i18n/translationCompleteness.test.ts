import { describe, it, expect } from 'vitest';
import { resources } from './index';
import { VOCABULARY } from '@/lib/orgKind';

/** Flatten a nested catalog to { 'dotted.key': stringValue } leaves. */
function leaves(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      leaves(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else if (typeof obj === 'string') {
    out[prefix] = obj;
  }
  return out;
}

// keyParity guarantees de/en share the same keys and copyLint guards dashes +
// formal "Sie" address, but nothing checks that a German value is actually German
// rather than English left in place: tsc validates JSON shape and the whole suite
// renders in English. This catches a de string accidentally identical to its en
// counterpart (a paste-through). Values that are legitimately identical across both
// languages (proper nouns, symbol/interpolation-only strings) are allowlisted with
// the reason they match; every other identical pair fails the test.
const IDENTICAL_OK: Record<string, string> = {
  // calendar surface
  'bookings.calendar.lens.agenda': 'loanword "Agenda", identical in German (die Agenda)',
  'bookings.calendar.needsYou.note.atRisk': 'interpolation + punctuation only ("{{slots}}, {{lead}}."), no translatable words',
  'availability.calendar.day.session': 'domain loanword "Session", kept untranslated (matches showsDetail.showDateForm.session)',
  'availability.calendar.allDates.headerSession': 'domain loanword "Session", kept untranslated',
  'availability.calendar.allDates.headerShow': 'loanword "Show", kept untranslated across the app (matches settingsCastsCoverage)',

  'bookings.filters.status': '"Status" is identical in German',
  'bookings.producer.sortAsc': 'interpolation + arrow only, no translatable words',
  'bookings.producer.sortDesc': 'interpolation + arrow only, no translatable words',

  // settings namespace (core shell)
  'settings.nav.items.skills': 'loanword "Skills", kept untranslated across the app',
  'settings.organization.slugLabel': 'technical term "Slug", never translated',
  'settings.permissions.row.admin': 'role name "Admin" is not translated (ROLE_LABELS)',
  'settings.permissions.row.roleRight': 'interpolation only ("{{role}}: {{label}}"), no words',

  // settingsCastsCoverage
  'settingsCastsCoverage.coverage.showsTitle': 'whole value is one vocabulary variable, resolved per language by the vocabulary table',
  'settingsCastsCoverage.coverage.castsTitle': 'whole value is one vocabulary variable, resolved per language by the vocabulary table',

  // settingsSkills
  'settingsSkills.header.title': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'settingsSkills.table.headSkill': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'settingsSkills.table.headArtists': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',

  // settingsTrust
  'settingsTrust.orgDataCard.regionLabel': '"Region" is identical in German',

  // settingsAirtable
  'settingsAirtable.eyebrow.connected': 'proper noun + interpolation only ("Airtable · {{baseName}} › {{tableName}}")',
  'settingsAirtable.eyebrow.default': 'proper noun "Airtable"',
  'settingsAirtable.overview.connection.tableViewFallbackView': 'Airtable UI name "Grid view"',
  'settingsAirtable.manageDialog.token.maskedValue': 'masked dots, not language-dependent',
  'settingsAirtable.manageDialog.baseTable.baseIdPlaceholder': "Airtable base-id format example",
  'settingsAirtable.manageDialog.baseTable.tableNamePlaceholder': 'example Airtable table name ("Shows")',
  'settingsAirtable.manageDialog.baseTable.viewPlaceholder': 'Airtable UI name "Grid view"',
  'settingsAirtable.activityTab.colStatus': '"Status" is identical in German',
  'settingsAirtable.catalogTab.blankKeyPlaceholder': 'punctuation glyph "·"',
  'settingsAirtable.consoleTabs.sync': 'loanword "Sync"',
  'settingsAirtable.mappingTab2.optional': '"optional" is identical in German',
  'settingsAirtable.overviewTab.rowToken': '"Token" is identical in German',
  'settingsAirtable.setupWizard.keyPlaceholder': 'Airtable token-prefix convention "pat…"',
  'settingsAirtable.console.badge.ok': 'short status abbreviation "ok", kept unlocalized',
  'settingsAirtable.connection.tokenLabel': '"Token" is identical in German (matches overviewTab.rowToken)',
  'settingsAirtable.connection.baseTableRow': 'interpolation + punctuation only ("{{base}} › {{table}} · {{view}} · {{frequency}}"), no translatable words',
  'settingsAirtable.source.airtable': 'brand name "Airtable", identical in German',

  // settingsBookingFlow
  'settingsBookingFlow.flowRail.actorSystem': '"System" is identical in German',
  'settingsBookingFlow.flowPresets.names.fasttrack': 'loanword "Autopilot", kept untranslated in German by design',

  // settingsHireOrders
  'settingsHireOrders.hireOrdersTab.rail.systemActor': '"System" is identical in German',
  'settingsHireOrders.letterheadFields.legalNamePlaceholder': 'example company name (proper noun)',
  'settingsHireOrders.templateInspector.colors.text': '"Text" is identical in German',
  'settingsHireOrders.templateInspector.textSectionHeading': '"Text" is identical in German',

  // settingsEmailTemplates
  'settingsEmailTemplates.emailTemplatesTab.groups.System': '"System" is identical in German',
  'settingsEmailTemplates.emailTemplateInspector.text': '"Text" is identical in German',
  'settingsEmailTemplates.emailTemplateInspector.weightOptions.medium': 'typographic loanword "Medium"',
  'settingsEmailTemplates.emailTemplateInspector.weightOptions.semibold': 'typographic loanword "Semibold"',
  'settingsEmailTemplates.emailTemplateInspector.roleLabels.header': 'loanword "Header"',
  'settingsEmailTemplates.emailTemplateInspector.roleLabels.button': 'loanword "Button"',
  'settingsEmailTemplates.emailTemplateInspector.roleLabels.footer': 'loanword "Footer"',
  'settingsEmailTemplates.emailEditorMeta.sections.header': 'loanword "Header"',
  'settingsEmailTemplates.emailEditorMeta.sections.footer': 'loanword "Footer"',

  // settingsRolesRights
  'settingsRolesRights.tab.presets.standard': '"Standard" is identical in German',
  'settingsRolesRights.editingPicker.productionTeam': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'settingsRolesRights.changeLog.transition': 'interpolation + arrow only ("{{from}} -> {{to}}")',
  'settingsRolesRights.capabilityGroups.artists': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'settingsRolesRights.capabilityGroups.hireOrders': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',

  // admin
  'admin.bulk.placeholder': 'example email addresses only (alex@email.com / sam@email.com)',

  // artists
  'artists.page.title': 'whole value is one vocabulary variable, resolved per language by the vocabulary table',
  'artists.page.skillsLabel': 'whole value is one vocabulary variable, resolved per language by the vocabulary table',
  'artists.page.castsLabel': 'whole value is one vocabulary variable, resolved per language by the vocabulary table',
  'artists.sheet.skillsLabel': 'whole value is one vocabulary variable, resolved per language by the vocabulary table',
  'artists.sheet.name': '"Name" is identical in German',
  'artists.sheet.statusLabel': '"Status" is identical in German',
  'artists.import.fields.name': '"Name" is identical in German',
  'artists.import.review.colName': '"Name" is identical in German',
  'artists.import.review.colStatus': '"Status" is identical in German',

  // productions
  'productions.page.title': 'whole value is one vocabulary variable, resolved per language by the vocabulary table',
  'productions.form.kindUnderstudy': 'whole value is one vocabulary variable, resolved per language by the vocabulary table',

  // hireOrdersPages
  'hireOrdersPages.ordersTable.colArtist': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.ordersTable.colStatus': '"Status" is identical in German',
  'hireOrdersPages.blockerList.legalNamePlaceholder': 'example company name (proper noun)',
  'hireOrdersPages.wizard.reviewArtist': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.wizard.artists': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.wizard.colArtist': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.wizard.emailPlaceholder': 'example email address',
  'hireOrdersPages.wizard.feePlaceholder': 'numeric placeholder "0.00"',
  'hireOrdersPages.slideOver.artist': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.provenanceChip.showflow': 'abbreviation "SF" of the ShowFlow proper noun',
  'hireOrdersPages.hireOrdersPage.title': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.ordersTable.colOrder': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.mapStep.cast': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.generateDialog.producer': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.ordersCard.hireOrder': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.ordersCard.hireOrders': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.detailPage.title': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.editPage.cast': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.reviewStep.colArtist': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.reviewStep.colStatus': '"Status" is identical in German',
  'hireOrdersPages.generateDialog.artist': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'hireOrdersPages.editPage.sectionEngagement': '"Engagement" is identical in German',
  'hireOrdersPages.editPage.sessionsPlaceholder': 'time example "19:00 · 21:00"',

  // showsDetail
  'showsDetail.showDateSheet.tabs.chat': 'loanword "Chat", identical in German',
  'showsDetail.cockpitRail.chat': 'loanword "Chat", identical in German',
  'showsDetail.cockpitRail.details': 'common word "Details", identical in German (matches profile.details.title)',
  'showsDetail.showDateForm.session': 'domain loanword "Session"',
  'showsDetail.showDateForm.sessionPlaceholder': 'time-format symbol "HH:MM"',
  'showsDetail.showDateSheet.castFallback': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'showsDetail.showDateSheet.assignedArtists.understudies': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'showsDetail.showDateSheet.tabs.cast': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'showsDetail.showDateSheet.tabs.order': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'showsDetail.showDateForm.production': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'showsDetail.cockpitFooter.hireOrder': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'showsDetail.castDetails.eyebrow': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'showsDetail.castsSection.casts': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'showsDetail.showDateSheet.titleFallback': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'showsDetail.cockpitRail.date': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',

  // chats
  'chats.list.title': 'loanword "Chats", identical in German',
  'chats.panel.title': 'loanword "Chat", identical in German',

  // profile
  'profile.details.title': 'common word "Details", identical in German',
  'profile.notifications.channelAria': 'pure interpolation template ("{{category}} {{channel}}"), no prose',

  // onboarding
  'onboarding.stageChain.side.chats': 'loanword "Chats", kept untranslated across the app (matches chats.list.title)',
  'onboarding.stageChain.modules.hire': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'onboarding.stageChain.tag.showsAndBookings': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'onboarding.stageChain.tag.hireOrders': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'onboarding.stageChain.artist.hireName': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'onboarding.stageChain.org.datesName': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
  'onboarding.stageChain.org.hireName': 'whole value is one vocabulary variable, so both languages carry the same token and the noun resolves per language at runtime',
};

describe('German catalog is translated (not English left in place)', () => {
  for (const ns of [
    'bookings', 'availability',
    'settings', 'settingsDocs', 'settingsCastsCoverage', 'settingsSkills', 'settingsTrust',
    'settingsAirtable', 'settingsBookingFlow', 'settingsHireOrders', 'settingsEmailTemplates',
    'settingsRolesRights', 'settingsEditor',
    'auth', 'admin', 'artists', 'productions', 'hireOrdersPages', 'showsDetail', 'chats', 'profile',
    'onboarding', 'flowCopy', 'bookingCopy', 'today',
  ] as const) {
    it(`de differs from en for translatable keys in "${ns}"`, () => {
      const en = leaves(resources.en[ns]);
      const de = leaves(resources.de[ns]);
      const suspicious = Object.keys(en).filter(
        (k) => en[k] === de[k] && !(`${ns}.${k}` in IDENTICAL_OK),
      );
      expect(
        suspicious,
        `de value identical to en (untranslated?): ${suspicious.join(', ')}`,
      ).toEqual([]);
    });
  }
});

const VOCAB = new Set(Object.keys(VOCABULARY.production.en));

/** The `{{name}}` interpolation tokens in a value, sorted for order-independent comparison.
 *  Vocabulary variables (and the `kind` selector, which is one of them) are dropped: German
 *  may resolve a noun through a per-kind sibling whose text spells the noun out, so the two
 *  languages legitimately carry different vocabulary tokens. Only runtime data placeholders
 *  ({{count}}, {{org}}, ...) have to match. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1]).filter((n) => !VOCAB.has(n)).sort();
}

/** The German per-kind sibling keys of an English key: `_production` / `_staffing` inserted
 *  before any `_one` / `_other` plural suffix (see keyParity.test.ts for the shape). */
function siblingKeys(key: string): string[] {
  const m = key.match(/_(one|other)$/);
  const base = m ? key.slice(0, -m[0].length) : key;
  const plural = m ? m[0] : '';
  return [`${base}_production${plural}`, `${base}_staffing${plural}`];
}

// keyParity guards key shape, copyLint guards dashes/formal address, and the block above
// guards paste-throughs, but nothing checks that a German value keeps the SAME interpolation
// placeholders as its English counterpart. A translation that drops a {{count}} or {{org}}
// renders a numberless/nameless sentence in production while every other i18n gate stays
// green. This pins placeholder parity leaf-by-leaf across every namespace.
describe('German values preserve English interpolation placeholders', () => {
  for (const ns of Object.keys(resources.en) as (keyof typeof resources.en)[]) {
    it(`de keeps every {{placeholder}} from en in namespace "${ns}"`, () => {
      const en = leaves(resources.en[ns]);
      const de = leaves(resources.de[ns]);
      const mismatched = Object.keys(en).filter((k) => {
        if (de[k] === undefined) return false;
        // A German value that is a `$t(...)` nesting reference carries no text of its own;
        // its placeholders live in the per-kind siblings, so check those instead.
        const siblings = de[k].startsWith('$t(') ? siblingKeys(k).filter((s) => de[s] !== undefined) : [];
        const values = siblings.length > 0 ? siblings.map((s) => de[s]) : [de[k]];
        const expected = placeholders(en[k]).join(',');
        return values.some((v) => placeholders(v).join(',') !== expected);
      });
      expect(
        mismatched,
        `de placeholders differ from en: ${mismatched.join(', ')}`,
      ).toEqual([]);
    });
  }
});
