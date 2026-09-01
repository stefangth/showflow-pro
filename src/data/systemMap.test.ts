import { describe, it, expect } from "vitest";
import { SYSTEM_MAP_NODES, SYSTEM_MAP_EDGES } from "./systemMap";
import mapMd from "../../docs/system-map.md?raw";

describe("systemMap data", () => {
  const ids = new Set(SYSTEM_MAP_NODES.map((n) => n.id));

  it("has the expected node counts per kind", () => {
    const by = (k: string) => SYSTEM_MAP_NODES.filter((n) => n.kind === k).length;
    expect(by("cron")).toBe(10);
    expect(by("user")).toBe(4);
    expect(by("fn")).toBe(27);
    expect(by("db")).toBe(15);
    expect(by("fx")).toBe(13);
  });

  it("has unique node ids", () => {
    expect(ids.size).toBe(SYSTEM_MAP_NODES.length);
  });

  it("every edge references existing nodes", () => {
    for (const e of SYSTEM_MAP_EDGES) {
      expect(ids.has(e.from), `edge.from ${e.from}`).toBe(true);
      expect(ids.has(e.to), `edge.to ${e.to}`).toBe(true);
    }
  });

  it("does not drift from docs/system-map.md (every fn/cron label appears there)", () => {
    const missing = SYSTEM_MAP_NODES
      .filter((n) => n.kind === "fn" || n.kind === "cron")
      .map((n) => n.label.replace(/ (clock|actions)$/,"").trim())
      .filter((label) => !mapMd.includes(label));
    expect(missing, `labels absent from system-map.md: ${missing.join(", ")}`).toEqual([]);
  });
});
