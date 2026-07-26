// GENERATED FILE. Do not edit.
// Source: src/lib/hireOrders/pdf/fontInflate.ts
// Regenerate: npm run sync:mirrors
// Shared helper for both pdfDeps.ts runtime shims (browser and edge). Neither
// shim is itself mirrored — they differ in font ORIGIN per runtime (embedded
// vs bucket-fetched, see each file's own header) — but the gzip-inflate step
// for the embedded Geist/Geist Mono bytes (./fonts.ts) is identical on both
// sides, so it lives here once and is mirrored rather than hand-duplicated.
//
// `DecompressionStream("gzip")` is a standard Web Streams API implemented by
// both Deno and modern browsers, so this single implementation runs
// unmodified on either runtime — no per-runtime branch needed.

/**
 * Inflate a base64-of-gzip TTF blob (as stored in fonts.ts's `*_GZ_B64`
 * exports) back to a plain base64 TTF string, ready to embed in a
 * `data:font/ttf;base64,...` URI.
 *
 * This only removes the gzip layer — the caller still needs to wrap the
 * result in a data URI, because `Font.register({ src: <Uint8Array> })` fails
 * on the edge runtime (react-pdf coerces the value to a filesystem path; see
 * fonts.ts's header comment for the exact failure). There is no shortcut
 * that skips the base64 re-encode.
 *
 * Built on `ReadableStream` + `DecompressionStream` directly rather than
 * `Blob.stream()` / `Response` — jsdom (the unit-test DOM, see
 * fontInflate.test.ts) implements neither of those, so routing through them
 * would make this untestable in the same jsdom environment every other
 * frontend test runs in, for no benefit: `ReadableStream` and
 * `DecompressionStream` alone are sufficient and are the two APIs actually
 * required on both runtimes.
 */
export async function inflateFontGzB64(gzB64: string): Promise<string> {
  const gzBytes = base64ToBytes(gzB64);
  // No explicit `ReadableStream<Uint8Array>` type argument: TS 5.7+'s
  // ArrayBufferLike-generic typed arrays make an explicit `Uint8Array`
  // annotation here (which resolves to `Uint8Array<ArrayBuffer>`)
  // incompatible with `DecompressionStream`'s declared
  // `WritableStream<BufferSource>`. Letting inference flow from
  // `controller.enqueue`'s parameter type keeps both sides consistent.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(gzBytes);
      controller.close();
    },
  }).pipeThrough(new DecompressionStream("gzip"));

  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  let totalLength = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const inflatedBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    inflatedBytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytesToBase64(inflatedBytes);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked, not a single `String.fromCharCode(...bytes)`: spreading a whole
  // font file (100-150KB) into one call argument list blows the call stack.
  // Same pattern as the bytesToBase64 helpers in both pdfDeps.ts shims.
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
