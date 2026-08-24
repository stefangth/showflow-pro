import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Metric } from "@/components/ui/metric";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { buildCapabilityInventory } from "@/lib/trust/capabilityInventory";

/** Every grantable right, grouped and counted straight from the registry.
 *
 *  Rendered from `buildCapabilityInventory()` — the same function that pins
 *  the numbers this card prints against `CAPABILITY_DEFS` in its own test —
 *  so the counts and the expandable list can never say something the
 *  registry does not. `scripts/build-trust-json.mjs` hand-duplicates this
 *  same fold for the public page, and `capabilityInventory.test.ts` asserts
 *  the two stay identical. */
export function CapabilitiesCard() {
  const { t } = useTranslation('settingsTrust');
  const inventory = buildCapabilityInventory();

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        {/* `max-w-2xl` on both paragraphs, not on the Card: this tab drops
         *  the settings page's reading measure so its tables can use the
         *  display, so running copy carries its own. 672px is about 96
         *  characters here; uncapped it reached 1360px at a 1920px display. */}
        <div className="max-w-2xl space-y-1">
          <h3 className="text-base font-semibold tracking-tight">{t('capabilitiesCard.title')}</h3>
          {/* The carve-out sentence is imported, not retyped. It used to exist
           *  in three hand-written copies (here, the Controls claim, and a JSX
           *  literal in the landing repo); the day one of those three rights
           *  gains a database policy, only one of them can now go stale.
           *
           *  "Most are checked in the database on write" used to sit between
           *  the headline and the note, which made naming three exceptions
           *  read as a promise that the other 25 carry a database policy. Six
           *  do not. The note now carries the whole three-way split, so the
           *  lead-in is gone here and on the public page. */}
          <p className="text-sm text-muted-foreground">
            {inventory.headline}. {inventory.note}
          </p>
          {/* Every other card on this tab states a fact about the signed-in
           *  organisation. This one cannot: `buildCapabilityInventory()` folds
           *  `CAPABILITY_DEFS`, i.e. the position each right ships in, and
           *  `resolveCapability` layers a platform default and an org override
           *  on top of that before anything is enforced. Without this sentence
           *  an administrator who has already switched a right on reads "Off by
           *  default" as "off here". Naming where the live setting lives is the
           *  honest fix; the row labels keep saying "by default" too. */}
          <p className="text-sm text-muted-foreground">
            {t('capabilitiesCard.settingLocationNote')}
          </p>
        </div>
        <Accordion type="multiple" className="w-full">
          {inventory.groups.map((group) => (
            <AccordionItem key={group.group} value={group.group}>
              <AccordionTrigger className="py-3 text-sm hover:no-underline">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{group.group}</span>
                  <Metric className="text-eyebrow text-muted-foreground">{group.countLabel}</Metric>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-3">
                  {group.entries.map((entry) => (
                    <li key={entry.label} className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{entry.label}</span>
                          {entry.sensitive && <Badge variant="hold">{t('capabilitiesCard.sensitive')}</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{entry.description}</p>
                      </div>
                      <span
                        className={`shrink-0 whitespace-nowrap text-eyebrow font-medium ${
                          entry.defaultEnabled ? "text-[var(--green-600)]" : "text-muted-foreground"
                        }`}
                      >
                        {entry.defaultLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
