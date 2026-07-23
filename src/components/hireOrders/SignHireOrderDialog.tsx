import { useState } from "react";
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
  const [sig, setSig] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);
  const sign = useSignHireOrder();

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
      { onSuccess: () => { onOpenChange(false); setSig(null); setConsent(false); } },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Sign your hire order</DialogTitle>
          <DialogDescription>
            Review the document shown on this page, then add your signature to countersign it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <SignaturePad value={sig} onChange={setSig} disabled={sign.isPending} />
          <div className="flex items-start gap-2 rounded-lg border border-border p-3">
            <Checkbox id="sign-consent" checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5" />
            <Label htmlFor="sign-consent" className="cursor-pointer text-xs font-normal text-muted-foreground">
              {CONSENT_TEXT}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sign.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!sig || !consent || sign.isPending}>
            {sign.isPending ? "Signing..." : "Sign hire order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
