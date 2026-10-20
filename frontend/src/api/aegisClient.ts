// REST client for the C++ Aegis Core Engine (cpp-httplib, port 18080).
//
//   GET  /api/health
//   GET  /api/scenario
//   POST /api/plan     {}
//   POST /api/recover  { failed_task_id, delay_hours }
//
// Responses are normalised defensively: field names may arrive as camelCase or
// snake_case and TaskStatus may be a string or the enum's integer value.
// If the server cannot be reached at all, the dashboard falls back to the
// built-in demo engine (src/api/mockEngine.ts).

import type {
  DataSource,
  PlanResult,
  RecoverRequest,
  RecoveryReport,
  ScenarioInfo,
  ScheduleMetrics,
  Task,
  TaskStatus,
} from '../types/aegis';
import { makespanOf, totalCostOf } from '../lib/graph';
import { MOCK_SCENARIO, mockPlan, mockRecover } from './mockEngine';

export const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:18080';

const TIMEOUT_MS = 5000;
const STATUS_BY_INDEX: TaskStatus[] = ['PENDING', 'SCHEDULED', 'FAILED', 'REPLANNED', 'PRESERVED'];

/** The server could not be reached (as opposed to answering with an error). */
export class NetworkError extends Error {}

type Json = Record<string, unknown>;

async function request(path: string, init?: RequestInit): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
  } catch {
    throw new NetworkError(`Cannot reach ${API_BASE}${path}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON body: handled below via status
  }
  if (!res.ok) {
    const detail = (body as Json).error ?? (body as Json).message ?? res.statusText;
    throw new Error(`${path} -> HTTP ${res.status}: ${String(detail)}`);
  }
  return Array.isArray(body) ? { tasks: body } : (body as Json);
}

// ---- normalisers --------------------------------------------------------------

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStrings = (v: unknown): string[] => asArray(v).map(String);
const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return v === undefined || v === null || Number.isNaN(n) ? fallback : n;
};

function normalizeStatus(v: unknown): TaskStatus {
  if (typeof v === 'number') return STATUS_BY_INDEX[v] ?? 'PENDING';
  const s = String(v ?? '').toUpperCase();
  return (STATUS_BY_INDEX as string[]).includes(s) ? (s as TaskStatus) : 'PENDING';
}

function normalizeTask(input: unknown): Task {
  const r = (input ?? {}) as Json;
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? r.id ?? ''),
    agentType: String(r.agentType ?? r.agent_type ?? 'UNKNOWN').toUpperCase(),
    duration: num(r.duration, 0),
    cost: num(r.cost, 0),
    priority: num(r.priority, 1),
    dependencies: asStrings(r.dependencies),
    requiredResources: asStrings(r.requiredResources ?? r.required_resources),
    startTime: num(r.startTime ?? r.start_time, -1),
    endTime: num(r.endTime ?? r.end_time, -1),
    status: normalizeStatus(r.status),
  };
}

function normalizeReport(input: Json): RecoveryReport {
  const r = (input.report ?? input) as Json;
  const pick = (camel: string, snake: string): unknown => r[camel] ?? r[snake];
  const tasks = asArray(r.tasks).map(normalizeTask);
  return {
    success: Boolean(r.success),
    failedTaskId: String(pick('failedTaskId', 'failed_task_id') ?? ''),
    affectedTasks: asStrings(pick('affectedTasks', 'affected_tasks')),
    preservedTasks: asStrings(pick('preservedTasks', 'preserved_tasks')),
    deltaMakespan: num(pick('deltaMakespan', 'delta_makespan'), 0),
    deltaCost: num(pick('deltaCost', 'delta_cost'), 0),
    updatedTasks: asArray(pick('updatedTasks', 'updated_tasks')).map(normalizeTask),
    tasks: tasks.length > 0 ? tasks : undefined,
    message: r.message === undefined ? undefined : String(r.message),
  };
}

function normalizeScenario(r: Json): ScenarioInfo {
  return {
    name: String(r.name ?? MOCK_SCENARIO.name),
    budget: num(r.budget ?? r.maxBudget ?? r.intended_budget ?? r.intendedBudget, MOCK_SCENARIO.budget),
    deadline: num(r.deadline ?? r.maxDeadline ?? r.deadline_hours ?? r.deadlineHours, MOCK_SCENARIO.deadline),
    resources: asArray(r.resources).map((x) =>
      typeof x === 'object' && x !== null ? String((x as Json).id ?? (x as Json).name) : String(x),
    ),
  };
}

// ---- public API -----------------------------------------------------------------

let source: DataSource = 'backend';
export const getSource = (): DataSource => source;

export async function checkHealth(): Promise<boolean> {
  try {
    const body = await request('/api/health');
    return body.status === 'ok';
  } catch {
    return false;
  }
}

export async function fetchScenario(scenarioId: string = 'symposium'): Promise<ScenarioInfo> {
  try {
    return normalizeScenario(
      await request(`/api/scenario?id=${encodeURIComponent(scenarioId)}`, {
        headers: { 'X-Scenario-Id': scenarioId },
      }),
    );
  } catch {
    return MOCK_SCENARIO;
  }
}

/** Ask the backend for a plan; fall back to the demo engine if it is unreachable. */
export async function requestPlan(
  backendOnline: boolean,
  scenarioId: string = 'symposium',
  customTasks?: Task[],
): Promise<PlanResult> {
  if (backendOnline) {
    try {
      const payload: Record<string, unknown> = { scenario_id: scenarioId };
      if (customTasks && customTasks.length > 0) {
        payload.tasks = customTasks;
      }
      const body = await request('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const tasks = asArray(body.tasks).map(normalizeTask);
      const m = (body.metrics ?? {}) as Json;
      const metrics: ScheduleMetrics = {
        makespan: num(m.makespan, makespanOf(tasks)),
        totalCost: num(m.totalCost ?? m.total_cost, totalCostOf(tasks)),
        success: m.success === undefined ? true : Boolean(m.success),
        message: String(m.message ?? `Coordinated ${tasks.length} tasks`),
      };
      const maxBudget = body.maxBudget !== undefined ? num(body.maxBudget, 0) : undefined;
      const maxDeadline = body.maxDeadline !== undefined ? num(body.maxDeadline, 0) : undefined;
      source = 'backend';
      return { tasks, metrics, source, maxBudget, maxDeadline };
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
    }
  }
  source = 'demo';
  return { ...mockPlan(), source };
}

export async function requestRecovery(
  failedTaskId: string,
  delayHours: number,
  currentTasks: Task[],
): Promise<RecoveryReport> {
  if (source === 'demo') return mockRecover(currentTasks, failedTaskId, delayHours);

  const payload: RecoverRequest = { failed_task_id: failedTaskId, delay_hours: delayHours };
  const body = await request('/api/recover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return normalizeReport(body);
}
