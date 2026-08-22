import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SetupWizardProps {
  keyValue: string;
  onKeyChange: (v: string) => void;
  onSaveKey: () => void;
  saving: boolean;
  canWrite: boolean;
  /** True once the PAT is saved: advances the wizard to the base/table step. */
  keyPresent: boolean;
  /** Opens the connection editor to pick the base and table. */
  onManageConnection: () => void;
}

interface WizardStep {
  n: number;
  titleKey: string;
  hintKey: string;
}

const STEPS: WizardStep[] = [
  { n: 1, titleKey: "setupWizard.steps.connectTitle", hintKey: "setupWizard.steps.connectHint" },
  { n: 2, titleKey: "setupWizard.steps.baseTableTitle", hintKey: "setupWizard.steps.baseTableHint" },
  { n: 3, titleKey: "setupWizard.steps.mapFieldsTitle", hintKey: "setupWizard.steps.mapFieldsHint" },
  { n: 4, titleKey: "setupWizard.steps.linkCatalogTitle", hintKey: "setupWizard.steps.linkCatalogHint" },
];

// eslint-disable-next-line no-restricted-syntax -- non-standard tracking (0.1em)
const EYEBROW = "text-eyebrow font-semibold uppercase tracking-[0.1em] text-accent-600";

/** The empty-state setup card: a four-step rail on the left, the personal
 *  access token step active on the right. Presentational: the orchestrator
 *  owns the token value and the save handler. */
export function SetupWizard({
  keyValue,
  onKeyChange,
  onSaveKey,
  saving,
  canWrite,
  keyPresent,
  onManageConnection,
}: SetupWizardProps) {
  const { t } = useTranslation('settingsAirtable');
  const currentStep = keyPresent ? 2 : 1;
  return (
    <div className="overflow-hidden rounded-l border border-border bg-card shadow-sm">
      <div className="border-b border-border p-5">
        <p className={EYEBROW}>{t('setupWizard.eyebrow')}</p>
        <h2 className="mt-1.5 font-display text-title font-semibold tracking-tight">
          {t('setupWizard.heading')}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t('setupWizard.subheading')}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[236px_1fr]">
        <ol className="border-b border-border bg-well-tint py-4 sm:border-b-0 sm:border-r">
          {STEPS.map((step, i) => {
            const current = step.n === currentStep;
            const done = step.n < currentStep;
            const last = i === STEPS.length - 1;
            return (
              <li key={step.n} className="flex gap-3 px-4 py-2.5">
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={cn(
                      "flex h-[22px] w-[22px] items-center justify-center rounded-full text-eyebrow font-semibold",
                      current
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "border border-accent-200 bg-accent-tint text-accent-text"
                          : "border border-border bg-card text-muted-foreground",
                    )}
                  >
                    {step.n}
                  </span>
                  {!last && <span className="w-px flex-1 bg-border" />}
                </div>
                <div className="pb-1.5">
                  <p
                    className={cn(
                      "text-control font-semibold",
                      step.n <= currentStep ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {t(step.titleKey)}
                  </p>
                  <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{t(step.hintKey)}</p>
                </div>
              </li>
            );
          })}
        </ol>
        {keyPresent ? (
          <div className="p-5">
            <h3 className="text-title-sm font-semibold tracking-tight">{t('setupWizard.baseTableStepTitle')}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t('setupWizard.baseTableStepDescription')}
            </p>
            <Button onClick={onManageConnection} disabled={!canWrite} className="mt-4">
              {t('setupWizard.chooseBaseAndTable')}
            </Button>
          </div>
        ) : (
          <div className="p-5">
            <h3 className="text-title-sm font-semibold tracking-tight">{t('setupWizard.tokenStepTitle')}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t('setupWizard.tokenHelpPrefix')}{" "}
              <span className="font-mono text-xs">data.records:read</span> {t('setupWizard.tokenHelpAnd')}{" "}
              <span className="font-mono text-xs">schema.bases:read</span>.
            </p>
            <div className="mt-4 flex max-w-[520px] gap-2">
              <Input
                type="password"
                placeholder={t('setupWizard.keyPlaceholder')}
                value={keyValue}
                onChange={(e) => onKeyChange(e.target.value)}
                disabled={!canWrite}
                className="bg-well-tint"
              />
              <Button
                onClick={onSaveKey}
                disabled={!canWrite || saving || !keyValue.trim()}
                className="shrink-0"
              >
                {saving ? t('setupWizard.saving') : t('setupWizard.saveAndContinue')}
              </Button>
            </div>
            <div className="mt-5 flex items-center gap-2 border-t border-border pt-3.5">
              <CircleHelp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                {t('setupWizard.noTokenHint')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
