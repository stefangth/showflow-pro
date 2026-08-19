/** Maps each `CAPABILITY_GROUPS` display string to its `capabilityGroups.<slug>` key in the
 *  settingsRolesRights catalog. Kept beside the group list (not derived) so a renamed group is
 *  a visible edit here; the RolesRights UI falls back to the raw string for an unmapped group,
 *  and `capabilities.i18n.test.ts` pins this map against the registry + catalog so a new or
 *  renamed group cannot silently drop back to the English header for German viewers.
 *
 *  Lives in its own module (not RolesRightsTab.tsx) so the component file only exports
 *  components — the react-refresh/only-export-components lint rule. */
export const GROUP_LABEL_SLUG: Record<string, string> = {
  "Members & access": "membersAndAccess",
  "Productions & dates": "productionsAndShowDates",
  "Bookings & engine": "bookingsAndEngine",
  "Artists": "artists",
  "Contracts": "hireOrders",
  "Settings & organization": "settingsAndOrganization",
  "Integrations": "integrations",
  "Email": "email",
};
