import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import SignaturePadLib from "signature_pad";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type SignatureValue =
  | { method: "typed"; typedName: string }
  | { method: "drawn"; pngDataUrl: string };

interface Props {
  value: SignatureValue | null;
  onChange: (v: SignatureValue | null) => void;
  disabled?: boolean;
}

/** Type-or-draw signature capture. Typed renders the name in a serif face as the
 *  signing mark; Draw uses signature_pad (velocity-smoothed ink, retina/touch
 *  handled). Emits null when the active method has no content. */
export function SignaturePad({ value, onChange, disabled }: Props) {
  const { t } = useTranslation("hireOrdersPages");
  const typed = value?.method === "typed" ? value.typedName : "";
  const padRef = useRef<SignaturePadLib | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Radix doesn't render <TabsContent value="draw"> (and thus the <canvas>) until the
  // user activates that tab, so a mount-once effect keyed on a ref would see a null
  // canvas on first render and never re-run. A callback ref fires exactly when the
  // canvas node is actually mounted/unmounted (tab activated / switched away / unmount),
  // so the pad is constructed lazily and torn down correctly every time.
  const setCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (!node) {
      padRef.current?.off();
      padRef.current = null;
      return;
    }
    // High-DPI crispness: size the backing store to the element's CSS box * ratio.
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    node.width = node.offsetWidth * ratio;
    node.height = node.offsetHeight * ratio;
    node.getContext("2d")?.scale(ratio, ratio);
    const dark = document.documentElement.classList.contains("dark");
    // `backgroundColor` is painted into the canvas by signature_pad, not just
    // supplied by CSS. That makes the exported PNG opaque: dark-mode white ink
    // remains visible when the stored image is embedded on the PDF's white page.
    const pad = new SignaturePadLib(node, {
      penColor: dark ? "#ffffff" : "#15131C",
      backgroundColor: dark ? "#15131C" : "#ffffff",
    });
    pad.addEventListener("endStroke", () => {
      if (pad.isEmpty()) onChangeRef.current(null);
      else onChangeRef.current({ method: "drawn", pngDataUrl: pad.toDataURL("image/png") });
    });
    padRef.current = pad;
  }, []);

  function clearDrawn() {
    padRef.current?.clear();
    onChange(null);
  }

  return (
    <Tabs defaultValue="draw" onValueChange={() => onChange(null)}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="type">{t("signaturePad.type")}</TabsTrigger>
        <TabsTrigger value="draw">{t("signaturePad.draw")}</TabsTrigger>
      </TabsList>
      <TabsContent value="type" className="space-y-2">
        <Label htmlFor="sig-typed" className="text-xs text-muted-foreground">{t("signaturePad.legalName")}</Label>
        <Input
          id="sig-typed"
          placeholder={t("signaturePad.legalName")}
          value={typed}
          disabled={disabled}
          onChange={(e) => {
            const name = e.target.value;
            onChange(name.trim() === "" ? null : { method: "typed", typedName: name });
          }}
        />
        {typed.trim() !== "" && (
          <div className="rounded-md border border-border bg-muted px-4 py-3 font-serif text-2xl text-foreground">
            {typed}
          </div>
        )}
      </TabsContent>
      <TabsContent value="draw" className="space-y-2">
        <canvas
          ref={setCanvas}
          className={cn(
            "h-40 w-full rounded-md border border-border bg-background touch-none",
            disabled && "pointer-events-none opacity-50",
          )}
        />
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={clearDrawn} disabled={disabled}>
            {t("signaturePad.clear")}
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
