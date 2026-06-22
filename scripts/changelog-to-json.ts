#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Generate public/changelog.json from public/changelog.md.
 *
 * The markdown is the single source of truth; this rewrites the JSON that the
 * standalone landing-page repo consumes. Run after editing the changelog:
 *
 *   deno run --allow-read --allow-write scripts/changelog-to-json.ts
 *
 * Expected markdown shape (see public/changelog.md):
 *   ## 1.4.0 — June 21, 2026
 *   *Integrations & automation*
 *   ### New
 *   - **Airtable sync** — keep show dates in sync …
 */

export interface ChangelogEntry {
  title?: string;
  description: string;
}

export interface Release {
  version: string;
  date: string; // ISO yyyy-mm-dd when parseable, else the raw label
  dateLabel: string; // the human label exactly as written
  title: string; // the one-line theme
  changes: Record<string, ChangelogEntry[]>;
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

/** "June 21, 2026" -> "2026-06-21" (returns the input unchanged if it doesn't match). */
function toISO(label: string): string {
  const m = label.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) return label;
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) return label;
  return `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
}

export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  let category: string | null = null;

  for (const raw of md.split("\n")) {
    const line = raw.trim();

    const ver = line.match(/^##\s+(\d+\.\d+\.\d+)\s+—\s+(.+)$/);
    if (ver) {
      current = {
        version: ver[1],
        date: toISO(ver[2].trim()),
        dateLabel: ver[2].trim(),
        title: "",
        changes: {},
      };
      category = null;
      releases.push(current);
      continue;
    }
    if (!current) continue;

    const theme = line.match(/^\*(.+)\*$/);
    if (theme && !current.title) {
      current.title = theme[1].trim();
      continue;
    }

    const cat = line.match(/^###\s+(.+)$/);
    if (cat) {
      category = cat[1].trim().toLowerCase();
      if (!current.changes[category]) current.changes[category] = [];
      continue;
    }

    const item = line.match(/^-\s+(.+)$/);
    if (item && category) {
      const list = current.changes[category] ?? (current.changes[category] = []);
      const body = item[1].trim();
      const split = body.match(/^\*\*(.+?)\*\*\s+—\s+(.+)$/);
      list.push(
        split
          ? { title: split[1].trim(), description: split[2].trim() }
          : { description: body },
      );
    }
  }
  return releases;
}

if (import.meta.main) {
  const inPath = new URL("../public/changelog.md", import.meta.url);
  const outPath = new URL("../public/changelog.json", import.meta.url);
  const md = await Deno.readTextFile(inPath);
  const releases = parseChangelog(md);
  if (releases.length === 0) {
    console.error("No releases parsed — check public/changelog.md format.");
    Deno.exit(1);
  }
  await Deno.writeTextFile(outPath, JSON.stringify(releases, null, 2) + "\n");
  console.log(`Wrote ${releases.length} releases to public/changelog.json`);
}
