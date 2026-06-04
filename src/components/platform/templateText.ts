export const parseLines = (s: string): string[] => s.split("\n").map((l) => l.trim()).filter(Boolean);
export const serializeLines = (arr: string[]): string => arr.join("\n");

export function parseCasts(s: string): { name: string; description: string | null }[] {
  return parseLines(s).map((line) => {
    const [name, ...rest] = line.split("::");
    const description = rest.join("::").trim();
    return { name: name.trim(), description: description || null };
  }).filter((c) => c.name);
}

export function serializeCasts(casts: { name: string; description: string | null }[]): string {
  return casts.map((c) => (c.description ? `${c.name} :: ${c.description}` : c.name)).join("\n");
}
