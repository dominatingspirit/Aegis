import { useMemo } from 'react';
import type { Task } from '../types/aegis';
import { computeRanks } from '../lib/graph';
import { STATUS_ORDER, STATUS_STYLES } from '../lib/theme';
import TaskNode from './TaskNode';

const NODE_W = 232;
const NODE_H = 132;
const COL_GAP = 96;
const ROW_GAP = 20;
const PAD = 24;
const HEADER = 28;

interface Props {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface Edge {
  key: string;
  from: string;
  to: string;
  d: string;
  status: Task['status'];
}

export default function PlanGraphView({ tasks, selectedId, onSelect }: Props) {
  const layout = useMemo(() => {
    // Column = longest-path depth, i.e. the topological stage of each task.
    const ranks = computeRanks(tasks);
    const columns: Task[][] = [];
    for (const t of tasks) {
      const rank = ranks.get(t.id) ?? 0;
      while (columns.length <= rank) columns.push([]);
      columns[rank].push(t);
    }
    columns.forEach((col) => col.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id)));

    const maxRows = Math.max(1, ...columns.map((c) => c.length));
    const innerH = maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

    const pos = new Map<string, { x: number; y: number }>();
    columns.forEach((col, ci) => {
      const colH = col.length * NODE_H + (col.length - 1) * ROW_GAP;
      const offset = (innerH - colH) / 2; // vertically centre short columns
      col.forEach((t, ri) =>
        pos.set(t.id, {
          x: PAD + ci * (NODE_W + COL_GAP),
          y: PAD + HEADER + offset + ri * (NODE_H + ROW_GAP),
        }),
      );
    });

    const edges: Edge[] = [];
    for (const t of tasks) {
      for (const dep of t.dependencies) {
        const a = pos.get(dep);
        const b = pos.get(t.id);
        if (!a || !b) continue;
        const x1 = a.x + NODE_W;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x;
        const y2 = b.y + NODE_H / 2;
        const dx = Math.max(40, (x2 - x1) / 2);
        edges.push({
          key: `${dep}->${t.id}`,
          from: dep,
          to: t.id,
          d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
          status: t.status,
        });
      }
    }

    return {
      columns,
      pos,
      edges,
      width: PAD * 2 + columns.length * NODE_W + Math.max(0, columns.length - 1) * COL_GAP,
      height: PAD * 2 + HEADER + innerH,
    };
  }, [tasks]);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div>
          <div className="eyebrow">Dependency graph</div>
          <h2 className="text-sm font-semibold text-slate-100">Mission plan by topological stage</h2>
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {STATUS_ORDER.map((status) => (
            <li key={status} className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-slate-400">
              <span className={`h-2 w-2 rounded-full ${STATUS_STYLES[status].dot}`} />
              {STATUS_STYLES[status].label}
            </li>
          ))}
        </ul>
      </div>

      {tasks.length === 0 ? (
        <div className="px-6 py-16 text-center font-mono text-sm text-slate-500">No plan loaded.</div>
      ) : (
        <div className="overflow-auto">
          <div
            className="relative"
            style={{ width: layout.width, height: layout.height, minWidth: '100%' }}
            onClick={() => onSelect(null)}
          >
            <svg
              width={layout.width}
              height={layout.height}
              className="pointer-events-none absolute left-0 top-0"
              aria-hidden="true"
            >
              <defs>
                {Object.entries(STATUS_STYLES).map(([status, s]) => (
                  <marker
                    key={status}
                    id={`arrow-${status}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={s.stroke} />
                  </marker>
                ))}
              </defs>
              {layout.edges.map((edge) => {
                const touched = selectedId !== null && (edge.from === selectedId || edge.to === selectedId);
                const dimmed = selectedId !== null && !touched;
                return (
                  <path
                    key={edge.key}
                    d={edge.d}
                    fill="none"
                    stroke={STATUS_STYLES[edge.status].stroke}
                    strokeWidth={touched ? 2.5 : 1.5}
                    strokeDasharray={edge.status === 'PENDING' ? '5 4' : undefined}
                    opacity={dimmed ? 0.18 : 0.85}
                    markerEnd={`url(#arrow-${edge.status})`}
                  />
                );
              })}
            </svg>

            {layout.columns.map((_, ci) => (
              <div
                key={ci}
                className="eyebrow absolute"
                style={{ left: PAD + ci * (NODE_W + COL_GAP), top: PAD, width: NODE_W }}
              >
                Stage {ci + 1}
              </div>
            ))}

            {tasks.map((t) => {
              const p = layout.pos.get(t.id);
              if (!p) return null;
              return (
                <div key={t.id} className="absolute" style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}>
                  <TaskNode
                    task={t}
                    selected={t.id === selectedId}
                    onSelect={(id) => onSelect(id === selectedId ? null : id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
