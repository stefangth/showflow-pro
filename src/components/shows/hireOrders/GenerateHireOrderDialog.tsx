import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Ticket } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatDateDMY } from "@/lib/dates";
import { openPdfBase64 } from "@/lib/hireOrders/openPdf";
import type { OrderData } from "@/lib/hireOrders/types";
import type { HireOrderRow } from "@/data/hireOrders";
import { useCan } from "@/hooks/useCapabilities";
import { useHireOrderAction, useUpdateHireOrderReview, useHireOrderTerms } from "@/hooks/useHireOrders";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import { HIRE_ORDER_DEFAULT_TERMS } from "@/config/app.config";
import { defaultTemplateId } from "@/lib/hireOrders/terms";
import type { HireOrderShowDate } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: HireOrderRow;
  showDate: HireOrderShowDate;
  orgId: string;
  producerName: string;
}

/** Read a resolved snapshot field as a trimmed string ("" when absent). */
function snapshot(data: OrderData, key: keyof OrderData): string {
  const v = data[key]?.value;
  if (v === null || v === undefined) return "";
  return String(v);
}

/** Read-only fact cell for the review grid. `mono` renders the value in the
 *  mono face (dates, durations) per the design. */
function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { t } = useTranslation("hireOrdersPages");
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-sm text-foreground", mono && "font-mono")}>{value || t("common.notSet")}</p>
    </div>
  );
}

/**
 * Review-and-issue modal for a single draft/ready hire order. Facts are read from
 * the order snapshot (what the PDF renders), falling back to the loaded show date.
 * v1 is FEE-ONLY: one engagement-fee input, no deposit/balance. Preview and Issue
 * persist the fee + terms variant first (the edge actions render from the stored
 * order), then call the preview / issue actions.
 */
export function GenerateHireOrderDialog({ open, onOpenChange, order, showDate, orgId, producerName }: Props) {
  const { t } = useTranslation("hireOrdersPages");
  const data = (order.data ?? {}) as OrderData;
  const artistName = order.artists?.name || snapshot(data, "artist_name");
  const dateStr = snapshot(data, "date") || showDate.date;
  const venue = snapshot(data, "venue") || showDate.venue || "";
  const durationRaw = snapshot(data, "duration_min") || (showDate.duration_minutes ?? "");
  const duration = durationRaw === "" ? "" : `${durationRaw} min`;
  const castRef =
    snapshot(data, "cast") ||
    [showDate.show?.program, showDate.show?.sub_program].filter(Boolean).join(" · ");
  const currency = order.fee_currency || "EUR";

  // Org terms templates — reuses the same query key as TermsVariantsCard so the
  // cache is shared. Falls back to the shared seed defaults (same shape the
  // hardcoded picker used to render) while the query is loading or errored, so
  // the picker never renders empty.
  const termsQuery = useHireOrderTerms(orgId);
  const terms = termsQuery.data ?? HIRE_ORDER_DEFAULT_TERMS;

  // The loaded order's fee/variant, captured once as the comparison baseline
  // for persist() below (the dialog is remounted per order via `key={order.id}`
  // in HireOrdersCard, so `order` itself never changes under an open dialog).
  const initialFeeAmount = order.fee_amount ?? null;
  const initialVariant = order.terms_variant || defaultTemplateId(terms) || "";

  const [fee, setFee] = useState<string>(order.fee_amount != null ? String(order.fee_amount) : "");
  const [variant, setVariant] = useState<string>(initialVariant);
  // The order's stored terms_variant no longer matches any live template (its
  // template was deleted in Settings). Never silently drop or auto-correct the
  // selection -- show it as a disabled "removed" chip and require an explicit
  // pick before Issue is allowed (see the radiogroup + Issue button below).
  const variantIsLive = terms.templates.some((t) => t.id === variant);
  const hasTermsTemplates = terms.templates.length > 0;

  // An order with NO stored terms_variant seeds `variant` above from `terms` at
  // the very first render, when the terms query may still be returning the
  // HIRE_ORDER_DEFAULT_TERMS fallback (id "standard") rather than the org's
  // real templates. If the org's real templates don't include "standard", the
  // selection would be stuck showing a false "Removed" chip once the real
  // setting resolves. Re-seed once, to the org's ACTUAL default -- mirrors the
  // letterhead one-time-seed pattern (nameSeededRef/emailSeededRef) below. An
  // order that already has an explicit stored id is NEVER touched here (even
  // if that id happens to be "standard"), so a genuinely-removed reference
  // still shows as removed.
  const variantTouchedRef = useRef(false);
  const variantSeededRef = useRef(!!order.terms_variant);
  useEffect(() => {
    if (!termsQuery.data || variantSeededRef.current || variantTouchedRef.current) return;
    variantSeededRef.current = true;
    setVariant(defaultTemplateId(termsQuery.data) ?? "");
  }, [termsQuery.data]);

  // Org letterhead default — reuses the same query key as LetterheadCard so the cache is shared.
  const { data: letterhead, isError: letterheadError } = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    enabled: Boolean(orgId),
  });

  const [agentName, setAgentName] = useState<string>(order.agent_name ?? "");
  const [agentEmail, setAgentEmail] = useState<string>(order.agent_email ?? "");
  // Baseline for the "changed?" check; updated per-field when we seed from the letterhead.
  const initialAgentRef = useRef({ name: order.agent_name ?? "", email: order.agent_email ?? "" });
  // The letterhead query is async and can resolve after the producer has already
  // started typing; once they've touched a field, a late-arriving default must
  // never clobber that edit -- tracked per field (not as a pair) so a late
  // default can still fill whichever field the producer hasn't touched, and a
  // field the order already overrides is never re-seeded.
  const nameTouchedRef = useRef(false);
  const emailTouchedRef = useRef(false);
  const nameSeededRef = useRef(order.agent_name != null);
  const emailSeededRef = useRef(order.agent_email != null);
  useEffect(() => {
    if (!letterhead) return;
    if (!nameSeededRef.current && !nameTouchedRef.current) {
      nameSeededRef.current = true;
      const v = letterhead.agent_name ?? "";
      setAgentName(v);
      initialAgentRef.current = { ...initialAgentRef.current, name: v };
    }
    if (!emailSeededRef.current && !emailTouchedRef.current) {
      emailSeededRef.current = true;
      const v = letterhead.agent_email ?? "";
      setAgentEmail(v);
      initialAgentRef.current = { ...initialAgentRef.current, email: v };
    }
  }, [letterhead]);

  // Until the org letterhead default is KNOWN, a field with no order-level override
  // has no value to show. Disable it so the producer can't type into a not-yet-seeded
  // field: doing so would set its "touched" ref before the default arrived, permanently
  // blocking the seed and leaving the field blank while the PDF still rendered the org
  // default (a WYSIWYG violation, and a type-then-clear would silently discard the edit).
  // Gate on `letterhead === undefined` (not just "loading"), so a failed letterhead fetch
  // keeps the field disabled rather than un-disabling to a misleading blank. A field the
  // order already overrides is ready at once. The `Boolean(orgId)` guard matches the
  // query's own `enabled`: with no active org the query never runs and `letterhead` would
  // stay `undefined` forever, so there is no default to wait for — don't lock the field.
  const nameAwaitingDefault = Boolean(orgId) && order.agent_name == null && letterhead === undefined;
  const emailAwaitingDefault = Boolean(orgId) && order.agent_email == null && letterhead === undefined;

  const review = useUpdateHireOrderReview();
  const action = useHireOrderAction();
  const busy = review.isPending || action.isPending;
  const canIssue = useCan("issue_hire_orders");

  const feeAmount = fee.trim() === "" ? null : Number(fee);

  // Preview/Issue call this on every click. Only write (and only re-tag
  // data.fee.source to "manual") when the producer actually edited the fee or
  // terms variant — otherwise an untouched sheet/showflow-sourced fee would be
  // silently re-tagged as manual on every click.
  async function persist(): Promise<void> {
    // Each agent field is compared and written independently, so editing only the
    // name never converts the inherited (null) email into a stored literal, and
    // vice versa.
    const nameChanged = agentName !== initialAgentRef.current.name;
    const emailChanged = agentEmail !== initialAgentRef.current.email;
    const changed = feeAmount !== initialFeeAmount || variant !== initialVariant || nameChanged || emailChanged;
    if (!changed) return;
    await review.mutateAsync({
      id: order.id,
      review: {
        feeAmount,
        termsVariant: variant,
        ...(nameChanged ? { agentName } : {}),
        ...(emailChanged ? { agentEmail } : {}),
      },
      currentData: order.data,
    });
  }

  function handlePreview(): void {
    void (async () => {
      await persist();
      const res = await action.mutateAsync({ action: "preview", org_id: orgId, order_id: order.id });
      const b64 = (res as { pdf_base64?: string } | null)?.pdf_base64;
      if (b64) openPdfBase64(b64);
    })().catch(() => {
      /* review/action hooks already toast the failure */
    });
  }

  function handleIssue(): void {
    void (async () => {
      await persist();
      const res = await action.mutateAsync({ action: "issue", org_id: orgId, order_ids: [order.id] });
      const issued = (res as { issued?: string[] } | null)?.issued ?? [];
      if (issued.length > 0) onOpenChange(false); // hook toasts the outcome; keep open on failure
    })().catch(() => {
      /* review/action hooks already toast the failure */
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Ticket className="h-5 w-5 text-accent-text" />
            {t("generateDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("generateDialog.description", { artistName: artistName || t("generateDialog.descriptionFallbackName") })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Read-only facts, sourced from the order snapshot */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label={t("generateDialog.producer")} value={producerName} />
            <Fact label={t("generateDialog.artist")} value={artistName} />
            <Fact label={t("generateDialog.date")} value={dateStr ? formatDateDMY(dateStr) : ""} mono />
            <Fact label={t("generateDialog.venue")} value={venue} />
            <Fact label={t("generateDialog.duration")} value={duration} mono />
            <Fact label={t("generateDialog.castReference")} value={castRef} />
          </div>

          {/* Engagement fee — the only editable monetary field (v1 is fee-only) */}
          <div className="rounded-l border border-accent-200 bg-accent-tint p-3 space-y-1.5">
            <Label htmlFor="hire-order-fee" className="text-xs text-accent-text">{t("generateDialog.engagementFee")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="hire-order-fee"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="0.00"
                className="bg-background"
              />
              <span className="text-sm font-medium text-muted-foreground">{currency}</span>
            </div>
          </div>

          {/* Terms variant */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("generateDialog.terms")}</Label>
            {hasTermsTemplates ? (
              <>
                <div role="radiogroup" aria-label={t("editPage.termsVariant")} className="flex flex-wrap gap-2">
                  {!variantIsLive && variant && (
                    <Button type="button" variant="outline" size="sm" disabled className="flex-1 text-muted-foreground">
                      {t("common.removedWillUseDefault")}
                    </Button>
                  )}
                  {terms.templates.map((tmpl) => {
                    const selected = variant === tmpl.id;
                    return (
                      <Button
                        key={tmpl.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        variant={selected ? "default" : "outline"}
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          variantTouchedRef.current = true;
                          setVariant(tmpl.id);
                        }}
                      >
                        {tmpl.name.trim() || t("common.untitledTemplate")}
                      </Button>
                    );
                  })}
                </div>
                {!variantIsLive && variant && (
                  <p className="text-xs text-destructive">
                    {t("common.termsTemplateRemoved")}
                  </p>
                )}
              </>
            ) : (
              // No template to pick, live or removed -- an empty radiogroup or a
              // "Removed" chip would both leave the producer guessing. Say so
              // plainly: this org has none configured yet.
              <p className="text-xs text-destructive">
                {t("common.noTermsConfigured")}
              </p>
            )}
          </div>

          {/* Booking agent — prefilled from the org letterhead, overridable per order */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("generateDialog.bookingAgent")}</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                aria-label={t("generateDialog.agentNameAria")}
                placeholder={t("generateDialog.agentNamePlaceholder")}
                value={agentName}
                disabled={nameAwaitingDefault}
                onChange={(e) => {
                  nameTouchedRef.current = true;
                  setAgentName(e.target.value);
                }}
              />
              <Input
                aria-label={t("generateDialog.agentEmailAria")}
                type="email"
                placeholder={t("generateDialog.agentEmailPlaceholder")}
                value={agentEmail}
                disabled={emailAwaitingDefault}
                onChange={(e) => {
                  emailTouchedRef.current = true;
                  setAgentEmail(e.target.value);
                }}
              />
            </div>
            {letterheadError ? (
              <p className="text-xs text-destructive">
                {t("generateDialog.letterheadError")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("generateDialog.letterheadHint")}</p>
            )}
          </div>

          {/* Info note (fee-only copy) */}
          <div className="rounded-l bg-well-tint p-3">
            <p className="text-xs text-muted-foreground">
              {t("generateDialog.infoNote")}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="secondary" onClick={handlePreview} disabled={busy}>{t("generateDialog.previewPdf")}</Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={handleIssue} disabled={busy || !canIssue || !variantIsLive}
            title={
              !canIssue
                ? t("common.noPermissionIssue")
                : !variantIsLive
                  ? (hasTermsTemplates ? t("common.chooseTermsFirst") : t("common.noTermsConfiguredShort"))
                  : undefined
            }>
            {t("common.issueAndSend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
