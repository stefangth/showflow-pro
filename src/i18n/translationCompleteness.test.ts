import { describe, it, expect } from 'vitest';
import { resources } from './index';

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
  'settingsCastsCoverage.coverage.showsTitle': '"Shows" is a loanword used untranslated in the German UI (dashboard/bookings)',

  // settingsSkills
  'settingsSkills.header.title': 'loanword "Skills"',
  'settingsSkills.table.headSkill': 'loanword "Skill"',
  'settingsSkills.table.headArtists': 'role noun "Artists" deliberately untranslated (TERMS convention)',

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

  // settingsBookingFlow
  'settingsBookingFlow.flowRail.actorSystem': '"System" is identical in German',

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
  'settingsRolesRights.editingPicker.productionTeam': 'role label "Production Team" kept untranslated',
  'settingsRolesRights.changeLog.transition': 'interpolation + arrow only ("{{from}} -> {{to}}")',
  'settingsRolesRights.capabilityGroups.artists': 'role noun "Artists" kept untranslated (TERMS convention)',

  // admin
  'admin.bulk.placeholder': 'example email addresses only (alex@email.com / sam@email.com)',

  // artists
  'artists.page.title': 'role noun "Artists" kept untranslated (TERMS)',
  'artists.sheet.name': '"Name" is identical in German',
  'artists.sheet.statusLabel': '"Status" is identical in German',
  'artists.import.fields.name': '"Name" is identical in German',
  'artists.import.review.colName': '"Name" is identical in German',
  'artists.import.review.colStatus': '"Status" is identical in German',

  // hireOrdersPages
  'hireOrdersPages.ordersTable.colArtist': 'role noun "Artist" kept untranslated (TERMS)',
  'hireOrdersPages.ordersTable.colStatus': '"Status" is identical in German',
  'hireOrdersPages.blockerList.legalNamePlaceholder': 'example company name (proper noun)',
  'hireOrdersPages.wizard.reviewArtist': 'role noun "Artist" kept untranslated (TERMS)',
  'hireOrdersPages.wizard.artists': 'role noun "Artists" kept untranslated (TERMS)',
  'hireOrdersPages.wizard.colArtist': 'role noun "Artist" kept untranslated (TERMS)',
  'hireOrdersPages.wizard.emailPlaceholder': 'example email address',
  'hireOrdersPages.wizard.feePlaceholder': 'numeric placeholder "0.00"',
  'hireOrdersPages.slideOver.artist': 'role noun "Artist" kept untranslated (TERMS)',
  'hireOrdersPages.provenanceChip.showflow': 'abbreviation "SF" of the ShowFlow proper noun',
  'hireOrdersPages.reviewStep.colArtist': 'role noun "Artist" kept untranslated (TERMS)',
  'hireOrdersPages.reviewStep.colStatus': '"Status" is identical in German',
  'hireOrdersPages.generateDialog.artist': 'role noun "Artist" kept untranslated (TERMS)',
  'hireOrdersPages.editPage.sectionEngagement': '"Engagement" is identical in German',
  'hireOrdersPages.editPage.sessionsPlaceholder': 'time example "19:00 · 21:00"',

  // showsDetail
  'showsDetail.showDateSheet.tabs.chat': 'loanword "Chat", identical in German',
  'showsDetail.cockpitRail.chat': 'loanword "Chat", identical in German',
  'showsDetail.cockpitRail.details': 'common word "Details", identical in German (matches profile.details.title)',
  'showsDetail.showDateForm.session': 'domain loanword "Session"',
  'showsDetail.showDateForm.sessionPlaceholder': 'time-format symbol "HH:MM"',

  // chats
  'chats.list.title': 'loanword "Chats", identical in German',
  'chats.panel.title': 'loanword "Chat", identical in German',

  // profile
  'profile.details.title': 'common word "Details", identical in German',
  'profile.notifications.channelAria': 'pure interpolation template ("{{category}} {{channel}}"), no prose',

  // onboarding
  'onboarding.stageChain.side.chats': 'loanword "Chats", kept untranslated across the app (matches chats.list.title)',
};

describe('German catalog is translated (not English left in place)', () => {
  for (const ns of [
    'bookings', 'availability',
    'settings', 'settingsDocs', 'settingsCastsCoverage', 'settingsSkills', 'settingsTrust',
    'settingsAirtable', 'settingsBookingFlow', 'settingsHireOrders', 'settingsEmailTemplates',
    'settingsRolesRights', 'settingsEditor',
    'auth', 'admin', 'artists', 'productions', 'hireOrdersPages', 'showsDetail', 'chats', 'profile',
    'onboarding', 'flowCopy', 'bookingCopy',
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

/** The `{{name}}` interpolation tokens in a value, sorted for order-independent comparison. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1]).sort();
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
      const mismatched = Object.keys(en).filter(
        (k) => de[k] !== undefined && placeholders(en[k]).join(',') !== placeholders(de[k]).join(','),
      );
      expect(
        mismatched,
        `de placeholders differ from en: ${mismatched.join(', ')}`,
      ).toEqual([]);
    });
  }
});
