import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  SYSTEM_MAP_NODES,
  SYSTEM_MAP_EDGES,
  type SystemMapNode,
  type Column,
  type NodeKind,
  type Subsystem,
} from "@/data/systemMap";

const COLUMN_ORDER: Column[] = ["trigger", "fn", "db", "fx"];

const KIND_BORDER_CLASS: Record<NodeKind, string> = {
  cron: "border-l-warning",
  user: "border-l-info",
  fn: "border-l-primary",
  db: "border-l-success",
  fx: "border-l-destructive",
};

const KIND_STROKE_TOKEN: Record<NodeKind, string> = {
  cron: "hsl(var(--warning))",
  user: "hsl(var(--info))",
  fn: "hsl(var(--primary))",
  db: "hsl(var(--success))",
  fx: "hsl(var(--destructive))",
};

const SUBSYSTEMS: Subsystem[] = ["booking", "email", "airtable", "platform", "gdpr"];

interface EdgeLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed: boolean;
  stroke: string;
}

function groupByColumn(nodes: SystemMapNode[]) {
  const map = new Map<Column, SystemMapNode[]>();
  for (const col of COLUMN_ORDER) map.set(col, []);
  for (const node of nodes) {
    map.get(node.column)?.push(node);
  }
  return map;
}

function groupBySubHeader(nodes: SystemMapNode[]) {
  const groups: { group?: string; nodes: SystemMapNode[] }[] = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (last && last.group === node.group) {
      last.nodes.push(node);
    } else {
      groups.push({ group: node.group, nodes: [node] });
    }
  }
  return groups;
}

export function SystemMapCanvas() {
  const { t } = useTranslation('settingsDocs');
  const COLUMN_LABELS: Record<Column, string> = {
    trigger: t('systemMapCanvas.columns.trigger'),
    fn: t('systemMapCanvas.columns.fn'),
    db: t('systemMapCanvas.columns.db'),
    fx: t('systemMapCanvas.columns.fx'),
  };
  const SUBSYSTEM_LABELS: Record<Subsystem, string> = {
    booking: t('systemMapCanvas.subsystems.booking'),
    email: t('systemMapCanvas.subsystems.email'),
    airtable: t('systemMapCanvas.subsystems.airtable'),
    platform: t('systemMapCanvas.subsystems.platform'),
    gdpr: t('systemMapCanvas.subsystems.gdpr'),
  };
  const [filter, setFilter] = useState<Subsystem | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edgeLines, setEdgeLines] = useState<EdgeLine[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const visibleNodes = useMemo(
    () =>
      SYSTEM_MAP_NODES.filter(
        (node) => filter === "all" || node.subsystems.includes(filter),
      ),
    [filter],
  );

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const nodesById = useMemo(() => {
    const map = new Map<string, SystemMapNode>();
    for (const node of SYSTEM_MAP_NODES) map.set(node.id, node);
    return map;
  }, []);

  const columns = useMemo(() => groupByColumn(visibleNodes), [visibleNodes]);

  const selectedNode = selectedId ? nodesById.get(selectedId) ?? null : null;

  // Close a stale detail panel when its node is filtered out of view.
  useEffect(() => {
    if (selectedId && !visibleIds.has(selectedId)) setSelectedId(null);
  }, [visibleIds, selectedId]);

  useEffect(() => {
    function recompute() {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();

      const lines: EdgeLine[] = [];
      for (const edge of SYSTEM_MAP_EDGES) {
        if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
        const fromEl = nodeRefs.current.get(edge.from);
        const toEl = nodeRefs.current.get(edge.to);
        if (!fromEl || !toEl) continue;

        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();

        const x1 = fromRect.right - containerRect.left;
        const y1 = fromRect.top + fromRect.height / 2 - containerRect.top;
        const x2 = toRect.left - containerRect.left;
        const y2 = toRect.top + toRect.height / 2 - containerRect.top;

        if ([x1, y1, x2, y2].some((v) => Number.isNaN(v))) continue;

        const fromNode = nodesById.get(edge.from);
        const isSelectedEdge = selectedId === edge.from || selectedId === edge.to;
        const stroke =
          isSelectedEdge && fromNode
            ? KIND_STROKE_TOKEN[fromNode.kind]
            : "hsl(var(--border))";

        lines.push({
          key: `${edge.from}->${edge.to}`,
          x1,
          y1,
          x2,
          y2,
          dashed: Boolean(edge.read),
          stroke,
        });
      }
      setEdgeLines(lines);
    }

    recompute();

    const container = containerRef.current;
    let resizeObserver: ResizeObserver | undefined;
    if (container && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => recompute());
      resizeObserver.observe(container);
    }
    window.addEventListener("resize", recompute);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [visibleIds, nodesById, selectedId]);

  function handleNodeClick(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-full border border-border px-3 py-1 text-sm motion-safe:transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            filter === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-foreground hover:bg-muted",
          )}
        >
          {t('systemMapCanvas.subsystems.all')}
        </button>
        {SUBSYSTEMS.map((sub) => (
          <button
            key={sub}
            type="button"
            aria-pressed={filter === sub}
            onClick={() => setFilter(sub)}
            className={cn(
              "rounded-full border border-border px-3 py-1 text-sm motion-safe:transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              filter === sub
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground hover:bg-muted",
            )}
          >
            {SUBSYSTEM_LABELS[sub]}
          </button>
        ))}
      </div>

      <div className="flex gap-4">
        <div className="overflow-x-auto flex-1">
          <div ref={containerRef} className="relative min-w-[960px]">
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              aria-hidden="true"
            >
              {edgeLines.map((line) => (
                <path
                  key={line.key}
                  d={`M ${line.x1} ${line.y1} C ${(line.x1 + line.x2) / 2} ${line.y1}, ${
                    (line.x1 + line.x2) / 2
                  } ${line.y2}, ${line.x2} ${line.y2}`}
                  fill="none"
                  style={{ stroke: line.stroke }}
                  strokeWidth={1.5}
                  strokeDasharray={line.dashed ? "4 3" : undefined}
                />
              ))}
            </svg>

            <div className="relative grid grid-cols-4 gap-4">
              {COLUMN_ORDER.map((col) => {
                const nodes = columns.get(col) ?? [];
                const subGroups = groupBySubHeader(nodes);
                return (
                  <div key={col} className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      {COLUMN_LABELS[col]}
                    </h3>
                    {subGroups.map((sg, idx) => (
                      <div key={sg.group ?? `ungrouped-${idx}`} className="flex flex-col gap-2">
                        {sg.group ? (
                          // eslint-disable-next-line no-restricted-syntax -- inline group label, not a standard 11px/1.6px eyebrow
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {sg.group}
                          </p>
                        ) : null}
                        {sg.nodes.map((node) => (
                          <button
                            key={node.id}
                            type="button"
                            ref={(el) => {
                              if (el) nodeRefs.current.set(node.id, el);
                              else nodeRefs.current.delete(node.id);
                            }}
                            onClick={() => handleNodeClick(node.id)}
                            aria-pressed={selectedId === node.id}
                            aria-label={node.label}
                            className={cn(
                              "rounded-m border border-border border-l-4 bg-card px-3 py-2 text-left text-sm shadow-sm",
                              "motion-safe:transition-colors hover:bg-muted",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              KIND_BORDER_CLASS[node.kind],
                              selectedId === node.id && "bg-muted",
                            )}
                          >
                            <span className="block font-medium text-foreground">{node.label}</span>
                            {node.sub ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {node.sub}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {selectedNode ? (
          <aside
            aria-label={t('systemMapCanvas.nodeDetails')}
            className="w-72 shrink-0 rounded-m border border-border bg-card p-4"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground">{selectedNode.label}</h4>
                {selectedNode.sub ? (
                  <p className="text-xs text-muted-foreground">{selectedNode.sub}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label={t('systemMapCanvas.closeDetails')}
                className={cn(
                  "rounded-s p-1 text-muted-foreground hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="space-y-2">
              {Object.entries(selectedNode.detail).map(([key, value]) => (
                <div key={key}>
                  {/* eslint-disable-next-line no-restricted-syntax -- inline detail label, not a standard 11px/1.6px eyebrow */}
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {key}
                  </dt>
                  <dd className="text-sm text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
