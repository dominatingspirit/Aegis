import type { RecoveryReport, Task } from '../types/aegis';

/** Kahn's algorithm. Returns the topological order, or null if the graph has a cycle. */
export function topologicalOrder(tasks: Task[]): string[] | null {
  const ids = new Set(tasks.map((t) => t.id));
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const t of tasks) {
    inDegree.set(t.id, 0);
    children.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of new Set(t.dependencies)) {
      if (!ids.has(dep)) continue;
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
      children.get(dep)?.push(t.id);
    }
  }

  const queue = tasks.filter((t) => inDegree.get(t.id) === 0).map((t) => t.id);
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    order.push(id);
    for (const child of children.get(id) ?? []) {
      const remaining = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, remaining);
      if (remaining === 0) queue.push(child);
    }
  }
  return order.length === tasks.length ? order : null;
}

/** Longest-path depth of every task: 0 for roots, 1 + max(parent rank) otherwise. */
export function computeRanks(tasks: Task[]): Map<string, number> {
  const ranks = new Map<string, number>();
  const order = topologicalOrder(tasks);
  if (!order) {
    tasks.forEach((t) => ranks.set(t.id, 0)); // cyclic input: render a single column
    return ranks;
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const id of order) {
    const task = byId.get(id);
    let rank = 0;
    for (const dep of task?.dependencies ?? []) {
      const parentRank = ranks.get(dep);
      if (parentRank !== undefined) rank = Math.max(rank, parentRank + 1);
    }
    ranks.set(id, rank);
  }
  return ranks;
}

/** BFS over parent -> child edges. Includes the starting task. */
export function downstreamOf(tasks: Task[], startId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const t of tasks) {
    for (const dep of t.dependencies) {
      const list = children.get(dep) ?? [];
      list.push(t.id);
      children.set(dep, list);
    }
  }
  const visited = new Set<string>();
  if (!tasks.some((t) => t.id === startId)) return visited;
  const queue = [startId];
  visited.add(startId);
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) ?? []) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }
  return visited;
}

export const isScheduled = (t: Task): boolean => t.startTime >= 0 && t.endTime >= t.startTime;

export function makespanOf(tasks: Task[]): number {
  return tasks.reduce((max, t) => (isScheduled(t) ? Math.max(max, t.endTime) : max), 0);
}

export function totalCostOf(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + t.cost, 0);
}

/** Applies a recovery report to the plan currently on screen. */
export function mergeRecovery(tasks: Task[], report: RecoveryReport): Task[] {
  if (report.tasks && report.tasks.length > 0) return report.tasks;
  const updated = new Map(report.updatedTasks.map((t) => [t.id, t]));
  const preserved = new Set(report.preservedTasks);
  return tasks.map((t) => {
    const next = updated.get(t.id);
    if (next) return next;
    return preserved.has(t.id) ? { ...t, status: 'PRESERVED' as const } : t;
  });
}
