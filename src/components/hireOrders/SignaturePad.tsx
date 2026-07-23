import { useEffect, useRef } from "react";
import SignaturePadLib from "signature_pad";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
  const typed = value?.method === "typed" ? value.typedName : "";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePadLib | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // High-DPI crispness: size the backing store to the element's CSS box * ratio.
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d")?.scale(ratio, ratio);
    const pad = new SignaturePadLib(canvas);
    pad.addEventListener("endStroke", () => {
      if (pad.isEmpty()) onChange(null);
      else onChange({ method: "drawn", pngDataUrl: pad.toDataURL("image/png") });
    });
    padRef.current = pad;
    return () => { pad.off(); padRef.current = null; };
    // Initialise once; onChange is stable enough for this ref-based widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearDrawn() {
    padRef.current?.clear();
    onChange(null);
  }

  return (
    <Tabs defaultValue="type" onValueChange={() => onChange(null)}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="type">Type</TabsTrigger>
        <TabsTrigger value="draw">Draw</TabsTrigger>
      </TabsList>
      <TabsContent value="type" className="space-y-2">
        <Label htmlFor="sig-typed" className="text-xs text-muted-foreground">Your full legal name</Label>
        <Input
          id="sig-typed"
          placeholder="Your full legal name"
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
          ref={canvasRef}
          className="h-40 w-full rounded-md border border-border bg-background touch-none"
        />
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={clearDrawn} disabled={disabled}>
            Clear
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
