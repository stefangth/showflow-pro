import { useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCan } from "@/hooks/useCapabilities";
import { useShows } from "@/hooks/useShows";
import { fetchCasts } from "@/data/casts";
import {
  useCastProductionFees,
  useUpsertCastProductionFee,
  useDeleteCastProductionFee,
} from "@/hooks/useCastProductionFees";
import { type FeeBasis } from "@/lib/hireOrders/feeBasis";
import { OrderDefaultsCard } from "@/components/settings/hireOrders/OrderDefaultsCard";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { IconTooltip } from "@/components/common/IconTooltip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Metric } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Kept in sync with OrderDefaultsCard's own CURRENCIES list. */
const CURRENCIES = ["EUR", "USD", "CHF"];

interface FeeDraft {
  castId: string;
  showId: string;
  feeAmount: number | null;
  currency: string;
  feeBasis: FeeBasis;
}

const EMPTY_DRAFT: FeeDraft = { castId: "", showId: "", feeAmount: null, currency: "EUR", feeBasis: "per_date" };

/**
 * The v3 `fee` step body: the org's default fee/currency/basis (`OrderDefaultsCard`,
 * unchanged from Phase 3), followed by the real per-(cast x production) fee list
 * (Phase 4, `cast_production_fees` via `useCastProductionFees`/`useUpsertCastProductionFee`).
 *
 * A fresh org has no casts yet, so the list has nothing to key rows on: rendering an
 * empty editor there would be confusing busywork, so this step instead shows an amber
 * gate naming the `coverage` step ("Casts and the ladder") where casts are set up.
 * There is no in-board step-jump mechanism yet (see stepRegistryV3.tsx), so the gate is
 * a plain note, not a real navigation control.
 *
 * Contract settings are admin-only in the model (`capability: edit_hire_order_settings`);
 * a viewer without that right sees both the org-default card and the fee list read-only,
 * with a "set by an admin" note instead of Continue.
 */
export function FeeStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("edit_hire_order_settings");

  const castsQuery = useQuery({
    queryKey: ["casts", orgId],
    enabled: !!orgId,
    queryFn: () => fetchCasts(supabase, orgId),
  });
  const showsQuery = useShows();
  const feesQuery = useCastProductionFees(orgId);
  const upsertFee = useUpsertCastProductionFee();
  const deleteFee = useDeleteCastProductionFee();

  const casts = useMemo(() => castsQuery.data ?? [], [castsQuery.data]);
  const shows = useMemo(() => showsQuery.data ?? [], [showsQuery.data]);
  const fees = useMemo(() => feesQuery.data ?? [], [feesQuery.data]);

  const castNameById = useMemo(() => new Map(casts.map((c) => [c.id, c.name])), [casts]);
  const showNameById = useMemo(
    () => new Map(shows.map((s) => [s.id, [s.program, s.sub_program].filter(Boolean).join(" · ")])),
    [shows],
  );

  const [draft, setDraft] = useState<FeeDraft | null>(null);

  const hasCasts = casts.length > 0;

  const saveDraft = () => {
    if (!orgId || !draft || !draft.castId || !draft.showId) return;
    upsertFee.mutate(
      {
        orgId,
        castId: draft.castId,
        showId: draft.showId,
        feeAmount: draft.feeAmount,
        currency: draft.currency,
        feeBasis: draft.feeBasis,
      },
      { onSuccess: () => setDraft(null) },
    );
  };

  const continueButton = (
    <Button type="button" size="sm" onClick={onDone}>
      {t("body.fee.continue")}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.fee.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.fee.sub")}</p>
      </div>

      <OrderDefaultsCard orgId={orgId} readOnly={!canEdit} />

      {!hasCasts ? (
        <div className="flex flex-col items-start gap-1 rounded-l bg-[var(--amber-100)] px-4 py-4">
          <StatusPill tone="waiting">{t("body.fee.coverageLink")}</StatusPill>
          <p className="text-xs text-[color:var(--amber-600)]">{t("body.fee.noCasts")}</p>
        </div>
      ) : (
        <div className="space-y-3 rounded-l border border-border px-4 py-4">
          <div className="space-y-1">
            <Eyebrow>{t("body.fee.listTitle")}</Eyebrow>
            <p className="text-xs text-muted-foreground">{t("body.fee.listHint")}</p>
          </div>

          {fees.length > 0 && (
            <ul className="space-y-1.5">
              {fees.map((fee) => (
                <li key={fee.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-foreground">
                    {castNameById.get(fee.cast_id) ?? fee.cast_id} &middot; {showNameById.get(fee.show_id) ?? fee.show_id}
                  </span>
                  <div className="flex items-center gap-2">
                    <Metric size="body">
                      {fee.fee_amount ?? t("body.fee.noFee")} {fee.currency}
                    </Metric>
                    {canEdit && orgId && (
                      <IconTooltip label={t("body.fee.removeFee")}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("body.fee.removeFee")}
                          disabled={deleteFee.isPending}
                          onClick={() => deleteFee.mutate({ id: fee.id, orgId })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </IconTooltip>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            draft ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t("body.fee.castLabel")}</label>
                  <Select value={draft.castId} onValueChange={(v) => setDraft((d) => (d ? { ...d, castId: v } : d))}>
                    <SelectTrigger aria-label={t("body.fee.castLabel")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {casts.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t("body.fee.productionLabel")}</label>
                  <Select value={draft.showId} onValueChange={(v) => setDraft((d) => (d ? { ...d, showId: v } : d))}>
                    <SelectTrigger aria-label={t("body.fee.productionLabel")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {shows.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{showNameById.get(s.id) ?? s.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t("body.fee.feeLabel")}</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={t("body.fee.feeLabel")}
                    value={draft.feeAmount ?? ""}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, feeAmount: e.target.value === "" ? null : Number(e.target.value) } : d))
                    }
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Select value={draft.currency} onValueChange={(v) => setDraft((d) => (d ? { ...d, currency: v } : d))}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    onClick={saveDraft}
                    disabled={!draft.castId || !draft.showId || upsertFee.isPending}
                  >
                    {t("body.fee.save")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => setDraft(EMPTY_DRAFT)}>
                {t("body.fee.addFee")}
              </Button>
            )
          )}
        </div>
      )}

      {canEdit ? (
        footerSlot ? (
          createPortal(continueButton, footerSlot)
        ) : (
          continueButton
        )
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.fee.readOnly")}</p>
      )}
    </div>
  );
}
