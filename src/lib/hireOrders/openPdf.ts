/** Open a base64-encoded PDF in a new browser tab via a temporary object URL,
 *  revoked after 60s. Shared by the hire-order review dialog and the PDF-copy
 *  settings preview so the decode/blob/window.open dance lives in one place. */
export function openPdfBase64(base64: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
