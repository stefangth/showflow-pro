#!/usr/bin/env node
// Generates every dual-homed file from its single source of truth.
//
// WHY THIS EXISTS: the Deno edge runtime cannot import from src/ (incompatible
// module specifier dialects, and Supabase deploys only what is under
// supabase/functions/), so shared code has to exist twice. This script makes
// the second copy DERIVED rather than duplicated: edit the source, run
// `npm run sync:mirrors`. `npm run sync:mirrors:check` fails CI when a target
// is stale or was hand-edited.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Header stamped onto every generated target, so a reader who opens the file
 *  directly learns not to edit it. Kept out of the byte comparison by being
 *  part of the produced content on both sides of the compare. */
function stamp(sourcePath) {
  return `// GENERATED FILE. Do not edit.\n` +
    `// Source: ${sourcePath}\n` +
    `// Regenerate: npm run sync:mirrors\n`;
}

function readBlock(text, start, end, path) {
  const s = text.indexOf(start);
  const e = text.indexOf(end);
  if (s === -1 || e === -1) {
    throw new Error(`mirror sentinel not found in ${path} (looked for ${start})`);
  }
  return text.slice(s, e + end.length);
}

function renderTarget(entry, root) {
  const sourceText = readFileSync(join(root, entry.source), "utf8");
  if (entry.mode === "file") {
    return stamp(entry.source) + sourceText;
  }
  if (entry.mode === "block") {
    const targetPath = join(root, entry.target);
    const targetText = readFileSync(targetPath, "utf8");
    const sourceBlock = readBlock(sourceText, entry.start, entry.end, entry.source);
    const targetBlock = readBlock(targetText, entry.start, entry.end, entry.target);
    return targetText.replace(targetBlock, sourceBlock);
  }
  throw new Error(`unknown mirror mode "${entry.mode}" for ${entry.target}`);
}

/**
 * Sync (or check) every manifest entry.
 * @param {{root?: string, entries?: object[], check?: boolean}} options
 * @returns {{written: string[], stale: string[]}}
 */
export function syncMirrors(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const entries = options.entries ??
    JSON.parse(readFileSync(join(root, "scripts/mirrors.manifest.json"), "utf8")).entries;

  const written = [];
  const stale = [];
  for (const entry of entries) {
    const targetPath = join(root, entry.target);
    const desired = renderTarget(entry, root);
    let current = null;
    try {
      current = readFileSync(targetPath, "utf8");
    } catch {
      current = null;
    }
    if (current === desired) continue;
    if (options.check) {
      stale.push(entry.target);
    } else {
      writeFileSync(targetPath, desired, "utf8");
      written.push(entry.target);
    }
  }
  return { written, stale };
}

// CLI. Not run on import, so the tests can call syncMirrors directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const { written, stale } = syncMirrors({ check });
  if (check && stale.length > 0) {
    console.error(
      `Mirror targets are stale:\n${stale.map((t) => `  ${t}`).join("\n")}\n\n` +
        `Edit the SOURCE file, then run: npm run sync:mirrors`,
    );
    process.exit(1);
  }
  if (check) {
    console.log("All mirrors in sync.");
  } else {
    console.log(
      written.length === 0
        ? "All mirrors already in sync."
        : `Regenerated:\n${written.map((t) => `  ${t}`).join("\n")}`,
    );
  }
}
