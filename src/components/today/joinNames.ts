/** Minimal typed surface for `Intl.ListFormat` — the project's `lib` target
 *  (ES2020) predates the ES2021 Intl typings, so `Intl.ListFormat` doesn't
 *  type-check directly even though every supported runtime has it. This
 *  avoids both widening `tsconfig.app.json`'s `lib` and an `any` cast. */
interface ListFormatCtor {
  new (locale: string, options: { style: "long"; type: "conjunction" }): { format: (list: string[]) => string };
}

/** Locale-aware "A and B" / "A, B and C" joiner — native Intl, no hardcoded
 *  " and " literal (that would bypass i18n for German). Shared by
 *  `CancelledUntoldCard` and `BouncedAsksBanner` (finding 9 in the Today
 *  board review — this used to be duplicated byte-for-byte in both). */
export function joinNames(names: string[], locale: string): string {
  const ListFormatImpl = (Intl as unknown as { ListFormat: ListFormatCtor }).ListFormat;
  return new ListFormatImpl(locale, { style: "long", type: "conjunction" }).format(names);
}
