import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SignaturePad, type SignatureValue } from "./SignaturePad";
import { useSignHireOrder } from "@/hooks/useHireOrders";

const CONSENT_TEXT =
  "By signing, I agree that my electronic signature is the legal equivalent of my handwritten signature, and I accept the terms of this hire order.";

interface Props {
  orderId: string;
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The artist's in-app signing modal. The order PDF stays visible on the page
 *  behind it, so the dialog references "the document shown on this page". */
export function SignHireOrderDialog({ orderId, orgId, open, onOpenChange }: Props) {
  const { t } = useTranslation("hireOrdersPages");
  const [sig, setSig] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);
  const sign = useSignHireOrder();

  // Closing for any reason (Cancel, successful sign, outside click, Esc) must
  // reset the signature/consent state -- the consumer keeps this dialog mounted
  // (`{canSign && <SignHireOrderDialog .../>}`), so bare useState survives an
  // open/close cycle and would otherwise resurface a stale signature/consent
  // on reopen. Routed through here so every close path resets exactly once.
  function handleOpenChange(o: boolean) {
    if (!o) {
      setSig(null);
      setConsent(false);
    }
    onOpenChange(o);
  }

  function submit() {
    if (!sig || !consent) return;
    sign.mutate(
      {
        orgId,
        orderId,
        method: sig.method,
        typedName: sig.method === "typed" ? sig.typedName : undefined,
        signaturePng: sig.method === "drawn" ? sig.pngDataUrl : undefined,
        consent: true,
      },
      { onSuccess: () => handleOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{t("signDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("signDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("signDialog.body")}
          </p>
          <SignaturePad value={sig} onChange={setSig} disabled={sign.isPending} />
          <div className="flex items-start gap-2 rounded-l border border-border p-3">
            <Checkbox id="sign-consent" checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5" />
            <Label htmlFor="sign-consent" className="cursor-pointer text-xs font-normal text-muted-foreground">
              {CONSENT_TEXT}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={sign.isPending}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={!sig || !consent || sign.isPending}>
            {sign.isPending ? t("signDialog.signing") : t("signDialog.sign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
