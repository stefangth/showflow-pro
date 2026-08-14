import { CircleHelp } from "lucide-react";

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
  title: string;
  hint: string;
}

const STEPS: WizardStep[] = [
  { n: 1, title: "Connect", hint: "Personal access token" },
  { n: 2, title: "Base and table", hint: "Pick where shows live" },
  { n: 3, title: "Map fields", hint: "Date, program, city, sessions" },
  { n: 4, title: "Link catalog", hint: "Match options to your shows" },
];

const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-600";

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
  const currentStep = keyPresent ? 2 : 1;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border p-5">
        <p className={EYEBROW}>Airtable · setup</p>
        <h2 className="mt-1.5 font-display text-[22px] font-semibold tracking-tight">
          Connect a base in four steps
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Nothing syncs until the last step. You can leave and come back, each step saves as you go.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[236px_1fr]">
        <ol className="border-b border-border bg-muted py-4 sm:border-b-0 sm:border-r">
          {STEPS.map((step, i) => {
            const current = step.n === currentStep;
            const done = step.n < currentStep;
            const last = i === STEPS.length - 1;
            return (
              <li key={step.n} className="flex gap-3 px-4 py-2.5">
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={cn(
                      "flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-semibold",
                      current
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "border border-accent-200 bg-accent-100 text-accent-700"
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
                      "text-[13px] font-semibold",
                      step.n <= currentStep ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{step.hint}</p>
                </div>
              </li>
            );
          })}
        </ol>
        {keyPresent ? (
          <div className="p-5">
            <h3 className="text-[17px] font-semibold tracking-tight">Base and table</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Your token is saved. Pick the Airtable base and table your shows live in to finish
              connecting. Nothing syncs until you do.
            </p>
            <Button onClick={onManageConnection} disabled={!canWrite} className="mt-4">
              Choose base and table
            </Button>
          </div>
        ) : (
          <div className="p-5">
            <h3 className="text-[17px] font-semibold tracking-tight">Personal access token</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Stored encrypted in Vault and never displayed again. Needs{" "}
              <span className="font-mono text-xs">data.records:read</span> and{" "}
              <span className="font-mono text-xs">schema.bases:read</span>.
            </p>
            <div className="mt-4 flex max-w-[520px] gap-2">
              <Input
                type="password"
                placeholder="pat…"
                value={keyValue}
                onChange={(e) => onKeyChange(e.target.value)}
                disabled={!canWrite}
                className="bg-muted"
              />
              <Button
                onClick={onSaveKey}
                disabled={!canWrite || saving || !keyValue.trim()}
                className="shrink-0"
              >
                {saving ? "Saving…" : "Save and continue"}
              </Button>
            </div>
            <div className="mt-5 flex items-center gap-2 border-t border-border pt-3.5">
              <CircleHelp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                No token yet? Create one at airtable.com/create/tokens, scoped to the base you sync
                from.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
