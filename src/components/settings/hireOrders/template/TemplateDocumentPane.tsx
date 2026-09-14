// The centre pane: the live browser-rendered PDF preview of `input`, with the
// selected role outlined via `input.highlightRole`. Renders the SAME document
// the edge function issues, via `renderHireOrderPdf` (dual-homed - see
// render.tsx). Re-renders on every `input` change, debounced so a keystroke
// does not trigger a render per character; the previous frame stays visible
// while a new render is in flight, and a monotonic run token guards against a
// slow render started earlier resolving after (and clobbering) a newer one.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { RenderInput } from "@/lib/hireOrders/pdf/docTypes";
import { renderHireOrderPdf } from "@/lib/hireOrders/pdf/render";
import { Alert, AlertDescription } from "@/components/ui/alert";

const DEBOUNCE_MS = 250;

export interface TemplateDocumentPaneProps {
  input: RenderInput;
}

export function TemplateDocumentPane({ input }: TemplateDocumentPaneProps) {
  const { t } = useTranslation("settingsHireOrders");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Monotonic token identifying the most recently STARTED render. Compared
  // against a ref (not state) so the check inside the async callback below
  // always reads the latest value, never a value captured in that render's
  // closure - a render whose token no longer matches `runId.current` by the
  // time it resolves is stale and must not touch state at all, regardless of
  // whether it resolved with a success or a failure, and regardless of
  // whether it resolves before or after the render that superseded it.
  const runId = useRef(0);
  // The most recently created object URL, tracked outside state so cleanup
  // (both the "replaced by a newer render" and the unmount path) can always
  // revoke the exact URL currently in use without a stale closure.
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const id = ++runId.current;
    // Debounced async PDF render (external-system sync): pending must flip the moment
    // the debounce starts, so this synchronous reset is correct here, not the derived
    // state set-state-in-effect targets.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(true);
    const timer = window.setTimeout(async () => {
      try {
        const bytes = await renderHireOrderPdf(input);
        if (id !== runId.current) return; // superseded while awaiting - discard
        // `renderHireOrderPdf`'s declared return type is the bare (buffer-generic)
        // `Uint8Array`, which `BlobPart` no longer accepts directly under this
        // TS/lib.dom pairing (a SharedArrayBuffer-backed view is excluded).
        // `Uint8Array.from` is typed to always return the concrete
        // `Uint8Array<ArrayBuffer>` BlobPart wants.
        const next = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }));
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setUrl(next);
        setError(null);
      } catch (e) {
        if (id !== runId.current) return; // superseded - a stale failure must not blank a current success
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === runId.current) setPending(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  // Release the last object URL when the pane itself unmounts (the
  // "superseded by a newer render" case is handled above, per render).
  //
  // Also invalidate any render still in flight: `clearTimeout` in the effect
  // above is a no-op once the debounce timer has already fired, so a render
  // that started before unmount but is still awaiting `renderHireOrderPdf`
  // keeps running - and without this, its `id === runId.current` check would
  // still hold (nothing else bumps the token on unmount), so it would create
  // a fresh object URL, past this cleanup's only chance to revoke it. Bumping
  // the token here makes that late resolution's id check fail, so it bails
  // out BEFORE ever calling `URL.createObjectURL` (see the two `id !==
  // runId.current` checks above) - no URL is created, so there is nothing
  // left to revoke, rather than "revoke it after the fact" (which a resolved
  // promise's continuation, running after this cleanup, could never reach).
  useEffect(() => () => {
    runId.current += 1;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  return (
    <section aria-label={t("templateDocumentPane.ariaLabel")} className="relative h-full overflow-y-auto bg-well-tint">
      {error && (
        <Alert variant="destructive" className="m-3">
          <AlertDescription>{t("templateDocumentPane.renderError")} {error}</AlertDescription>
        </Alert>
      )}
      {pending && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-control bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {t("templateDocumentPane.updating")}
        </div>
      )}
      {url && <iframe title={t("templateDocumentPane.iframeTitle")} src={url} className="h-full w-full border-0" />}
    </section>
  );
}
