// Test support: a minimal text extractor for the PDFs this folder renders.
//
// WHY THIS EXISTS: the renderer's tests need to assert what the document
// actually SAYS, not merely that bytes came back. Comparing byte lengths
// (`preview.length !== issued.length`) proves the two differ, not that a
// watermark is present — any styling change satisfies it. This decodes the
// real text so a test can assert "PREVIEW" is on the preview and absent from
// the issued copy.
//
// SCOPE: deliberately narrow. It handles exactly what @react-pdf/renderer v4
// emits and nothing else — Flate-compressed content streams, Type0/Identity-H
// composite fonts, and the /ToUnicode CMaps react-pdf writes for each subset.
// It is not a general-purpose PDF parser and must not become one. If a future
// react-pdf changes its output shape, this throws loudly rather than silently
// returning "" and turning the assertions vacuous.
//
// Not used by any production code path.

/** Latin-1 view of the bytes: 1 char == 1 byte, so string indices are byte offsets. */
function latin1(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return s;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      // Copied so the chunk is backed by a plain ArrayBuffer, which is what
      // DecompressionStream's writable side accepts.
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Inflated bytes of object `objNum`'s stream. Null when the object has no
 * stream or is not Flate-compressed.
 *
 * The extent comes from the dict's /Length, not from searching for
 * "endstream": stream bodies are binary and can contain that literal.
 */
async function objectStream(bytes: Uint8Array, doc: string, objNum: number): Promise<Uint8Array | null> {
  const start = doc.indexOf(`\n${objNum} 0 obj`);
  if (start === -1) return null;

  const objEnd = doc.indexOf("endobj", start);
  const sMark = doc.indexOf("stream", start);
  // No stream of its own: the next match belongs to a later object.
  if (sMark === -1 || (objEnd !== -1 && sMark > objEnd)) return null;

  const dict = doc.slice(start, sMark);
  if (!dict.includes("/FlateDecode")) return null;
  const length = /\/Length\s+(\d+)/.exec(dict);
  if (!length) return null;

  // Skip "stream" + its EOL (\n or \r\n).
  let from = sMark + "stream".length;
  if (doc[from] === "\r") from++;
  if (doc[from] === "\n") from++;

  try {
    return await inflate(bytes.subarray(from, from + Number(length[1])));
  } catch {
    return null;
  }
}

/** gid -> character, parsed from a /ToUnicode CMap's bfchar + bfrange sections. */
function parseCMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();

  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, gid, uni] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(parseInt(gid, 16), codesToString(uni));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, uni] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const start = parseInt(lo, 16);
      const end = parseInt(hi, 16);
      const base = parseInt(uni, 16);
      for (let g = start; g <= end; g++) map.set(g, String.fromCodePoint(base + (g - start)));
    }
  }
  return map;
}

/** A CMap target is a run of UTF-16BE code units. */
function codesToString(hex: string): string {
  const units: number[] = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
  return String.fromCharCode(...units);
}

/**
 * Extract the visible text of a react-pdf document, in document order.
 *
 * Throws when the document does not look like react-pdf output (no font
 * resources, no CMaps, or no content streams) so that a parser mismatch fails
 * loudly instead of quietly reporting "no text".
 *
 * TWO KNOWN GAPS — assertions must not depend on them:
 *  - react-pdf lays text out one run per word and emits the trailing space as
 *    a real glyph, so runs are concatenated with no separator. Within a line
 *    that reconstructs the sentence exactly; ACROSS a line wrap the space is
 *    consumed by the break, and across two sibling <Text> elements there is no
 *    space at all. Assert on phrases that sit inside one line.
 *  - react-pdf writes no /ToUnicode entry for ligature glyphs, so an "fi"/"fl"
 *    pair is dropped ("confirms" extracts as "conrms"). This is a property of
 *    the PDF, not of this parser: the same word is unsearchable in a real
 *    viewer. Assert on ligature-free copy.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const doc = latin1(bytes);

  // Resource name (/F2) -> Type0 font object number.
  const fontRes = new Map<string, number>();
  for (const dict of doc.matchAll(/\/Font\s*<<([^>]*)>>/g)) {
    for (const [, name, num] of dict[1].matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
      fontRes.set(name, Number(num));
    }
  }
  if (fontRes.size === 0) throw new Error("extractPdfText: no /Font resources found");

  // Resource name -> its subset's gid->char map, via the font's /ToUnicode.
  const cmaps = new Map<string, Map<number, string>>();
  for (const [name, objNum] of fontRes) {
    const objAt = doc.indexOf(`\n${objNum} 0 obj`);
    if (objAt === -1) continue;
    const toUni = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(doc.slice(objAt, objAt + 400));
    if (!toUni) continue;
    const stream = await objectStream(bytes, doc, Number(toUni[1]));
    if (stream) cmaps.set(name, parseCMap(latin1(stream)));
  }
  if (cmaps.size === 0) throw new Error("extractPdfText: no /ToUnicode CMaps found");

  // Content streams: every object whose inflated body carries text operators.
  const bodies: string[] = [];
  for (const m of doc.matchAll(/\n(\d+) 0 obj/g)) {
    const stream = await objectStream(bytes, doc, Number(m[1])).catch(() => null);
    if (!stream) continue;
    const body = latin1(stream);
    if (body.includes(" Tf") && (body.includes("TJ") || body.includes("Tj"))) bodies.push(body);
  }
  if (bodies.length === 0) throw new Error("extractPdfText: no content streams with text operators");

  const pages: string[] = [];
  for (const body of bodies) {
    let font = "";
    let page = "";
    // Walk font selections and text-showing operators in document order.
    const ops = /\/(F\d+)\s+[\d.]+\s+Tf|\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g;
    for (const op of body.matchAll(ops)) {
      if (op[1]) {
        font = op[1];
        continue;
      }
      const hexRun = op[2] ?? op[3] ?? "";
      const cmap = cmaps.get(font);
      if (!cmap) continue;
      let out = "";
      // Inside a TJ array the hex strings are glyphs; bare numbers are kerning.
      for (const [, hex] of hexRun.matchAll(/<([0-9a-fA-F]*)>/g)) {
        for (let i = 0; i + 4 <= hex.length; i += 4) {
          out += cmap.get(parseInt(hex.slice(i, i + 4), 16)) ?? "";
        }
      }
      if (op[3] !== undefined) {
        for (let i = 0; i + 4 <= hexRun.length; i += 4) {
          out += cmap.get(parseInt(hexRun.slice(i, i + 4), 16)) ?? "";
        }
      }
      page += out;
    }
    if (page !== "") pages.push(page);
  }
  return pages.join("\n");
}
