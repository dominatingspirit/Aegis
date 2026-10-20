// Built-in demo engine: a TypeScript port of the C++ PrioritySchedulingStrategy
// and SelectiveRecoveryEngine. Used only when the C++ server is unreachable, so
// the dashboard can be developed and demoed before the branches are merged.

import type { RecoveryReport, ScenarioInfo, ScheduleMetrics, Task } from '../types/aegis';
import { downstreamOf, isScheduled, makespanOf, topologicalOrder, totalCostOf } from '../lib/graph';

const RESCHEDULE_FEE_RATE = 0.1; // keep in sync with SelectiveRecoveryEngine::kRescheduleFeeRate
const SEARCH_HORIZON = 1000;

const task = (
  id: string,
  agentType: string,
  duration: number,
  cost: number,
  priority: number,
  dependencies: string[],
  requiredResources: string[],
): Task => ({
  id,
  name: id,
  agentType,
  duration,
  cost,
  priority,
  dependencies,
  requiredResources,
  startTime: -1,
  endTime: -1,
  status: 'PENDING',
});

// The six tasks proposed by Partner 1's VenueAgent, LogisticsAgent and SpeakerAgent.
const SEED_TASKS: Task[] = [
  task('hall_booking', 'VENUE', 4, 1200, 5, [], ['main_hall']),
  task('security_check', 'VENUE', 2, 400, 4, ['hall_booking'], ['security_team']),
  task('av_setup', 'LOGISTICS', 3, 800, 4, ['hall_booking'], ['tech_crew']),
  task('catering_setup', 'LOGISTICS', 2, 1500, 3, ['hall_booking'], ['catering_staff']),
  task('speaker_rehearsal', 'SPEAKER', 2, 300, 3, ['av_setup'], ['tech_crew']),
  task('keynote_session', 'SPEAKER', 3, 2000, 5, ['speaker_rehearsal'], ['main_hall']),
];

export const MOCK_SCENARIO: ScenarioInfo = {
  name: 'Tech Symposium 2026',
  budget: 7000,
  deadline: 18,
  resources: ['main_hall', 'tech_crew', 'security_team', 'catering_staff'],
};

// ---- capacity-1 resource calendar -----------------------------------------

type Busy = Record<string, { s: number; e: number; id: string }[]>;

const isFree = (busy: Busy, resources: string[], s: number, e: number): boolean =>
  resources.every((r) => !(busy[r] ?? []).some((b) => b.s < e && s < b.e));

const hold = (busy: Busy, resources: string[], id: string, s: number, e: number): void => {
  for (const r of resources) {
    if (!busy[r]) busy[r] = [];
    busy[r].push({ s, e, id });
  }
};

const findSlot = (busy: Busy, resources: string[], duration: number, from: number): number => {
  for (let t = from; t < from + SEARCH_HORIZON; t++) {
    if (isFree(busy, resources, t, t + duration)) return t;
  }
  return -1;
};

const earliestStart = (tasks: Map<string, Task>, t: Task): number =>
  t.dependencies.reduce((max, dep) => Math.max(max, tasks.get(dep)?.endTime ?? 0), 0);

// ---- public API -------------------------------------------------------------

export function mockPlan(): { tasks: Task[]; metrics: ScheduleMetrics } {
  const tasks = SEED_TASKS.map((t) => ({ ...t }));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const order = topologicalOrder(tasks);
  if (!order) {
    return { tasks, metrics: { makespan: 0, totalCost: 0, success: false, message: 'Cycle detected' } };
  }

  const busy: Busy = {};
  for (const id of order) {
    const t = byId.get(id)!;
    const start = findSlot(busy, t.requiredResources, t.duration, earliestStart(byId, t));
    hold(busy, t.requiredResources, id, start, start + t.duration);
    t.startTime = start;
    t.endTime = start + t.duration;
    t.status = 'SCHEDULED';
  }

  const makespan = makespanOf(tasks);
  return {
    tasks,
    metrics: {
      makespan,
      totalCost: totalCostOf(tasks),
      success: true,
      message: `Scheduled ${tasks.length} tasks, makespan ${makespan}h (demo engine)`,
    },
  };
}

export function mockRecover(current: Task[], failedId: string, delayHours: number): RecoveryReport {
  const fail = (message: string): RecoveryReport => ({
    success: false,
    failedTaskId: failedId,
    affectedTasks: [],
    preservedTasks: [],
    deltaMakespan: 0,
    deltaCost: 0,
    updatedTasks: [],
    message,
  });

  const tasks = current.map((t) => ({ ...t }));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const failed = byId.get(failedId);
  if (!failed) return fail(`Unknown task: ${failedId}`);
  if (delayHours < 0) return fail('delayHours must be >= 0');
  if (!isScheduled(failed)) return fail(`Task '${failedId}' has not been scheduled yet`);
  const order = topologicalOrder(tasks);
  if (!order) return fail('Cycle detected in task graph');

  const oldMakespan = makespanOf(tasks);
  const affected = downstreamOf(tasks, failedId); // includes the failed task

  // Freeze everything outside the blast radius; only they keep reservations.
  const busy: Busy = {};
  const preservedTasks: string[] = [];
  const affectedTasks: string[] = [];
  const oldSlots = new Map<string, [number, number]>();
  for (const id of order) {
    const t = byId.get(id)!;
    if (affected.has(id)) {
      oldSlots.set(id, [t.startTime, t.endTime]);
      if (id !== failedId) affectedTasks.push(id);
    } else if (isScheduled(t)) {
      t.status = 'PRESERVED';
      preservedTasks.push(id);
      hold(busy, t.requiredResources, id, t.startTime, t.endTime);
    }
  }

  // The failed task keeps its start and finishes `delayHours` later.
  const [oldStart, oldEnd] = oldSlots.get(failedId)!;
  const span = oldEnd + delayHours - oldStart;
  const failedStart = isFree(busy, failed.requiredResources, oldStart, oldStart + span)
    ? oldStart
    : findSlot(busy, failed.requiredResources, span, oldStart);
  if (failedStart < 0) return fail(`Could not hold resources for delayed task '${failedId}'`);
  hold(busy, failed.requiredResources, failedId, failedStart, failedStart + span);
  failed.startTime = failedStart;
  failed.endTime = failedStart + span;
  failed.status = 'FAILED';

  // Reschedule the downstream tasks in topological order.
  const updatedTasks: Task[] = [{ ...failed }];
  let replannedCost = failed.cost;
  for (const id of order) {
    if (id === failedId || !affected.has(id)) continue;
    const t = byId.get(id)!;
    const start = findSlot(busy, t.requiredResources, t.duration, earliestStart(byId, t));
    if (start < 0) return fail(`No feasible slot found for downstream task '${id}'`);
    const end = start + t.duration;
    hold(busy, t.requiredResources, id, start, end);
    const [os, oe] = oldSlots.get(id)!;
    const moved = start !== os || end !== oe;
    t.startTime = start;
    t.endTime = end;
    t.status = moved ? 'REPLANNED' : 'SCHEDULED';
    if (moved) replannedCost += t.cost;
    updatedTasks.push({ ...t });
  }

  return {
    success: true,
    failedTaskId: failedId,
    affectedTasks,
    preservedTasks,
    deltaMakespan: makespanOf(tasks) - oldMakespan,
    deltaCost: replannedCost * RESCHEDULE_FEE_RATE,
    updatedTasks,
    tasks,
    message: `Replanned ${affectedTasks.length} downstream tasks, preserved ${preservedTasks.length}`,
  };
}
