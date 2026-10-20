// TypeScript mirror of the C++ structs in backend/include/Models.hpp,
// Scheduler.hpp and the JSON bodies served by backend/src/main.cpp.

export type TaskStatus = 'PENDING' | 'SCHEDULED' | 'FAILED' | 'REPLANNED' | 'PRESERVED';

export type AgentType = 'VENUE' | 'LOGISTICS' | 'SPEAKER';

/** struct Task */
export interface Task {
  id: string;
  name: string;
  /** "VENUE" | "LOGISTICS" | "SPEAKER" (kept as string so new agents never break the UI) */
  agentType: string;
  /** hours */
  duration: number;
  cost: number;
  /** 1 (low) .. 5 (critical) */
  priority: number;
  dependencies: string[];
  requiredResources: string[];
  /** -1 until scheduled */
  startTime: number;
  endTime: number;
  status: TaskStatus;
}

/** struct ScheduleMetrics */
export interface ScheduleMetrics {
  makespan: number;
  totalCost: number;
  success: boolean;
  message: string;
}

/** Where the data on screen came from. */
export type DataSource = 'backend' | 'demo';

/** POST /api/plan */
export interface PlanResult {
  tasks: Task[];
  metrics: ScheduleMetrics;
  source: DataSource;
}

/** POST /api/recover request body */
export interface RecoverRequest {
  failed_task_id: string;
  delay_hours: number;
}

/** struct RecoveryReport (+ optional full task list if the server sends one) */
export interface RecoveryReport {
  success: boolean;
  failedTaskId: string;
  /** downstream tasks that were replanned (the failed task itself excluded) */
  affectedTasks: string[];
  /** tasks whose slots were frozen */
  preservedTasks: string[];
  deltaMakespan: number;
  deltaCost: number;
  /** failed task + every task whose slot was recomputed */
  updatedTasks: Task[];
  tasks?: Task[];
  message?: string;
}

/** GET /api/scenario (only the fields the dashboard needs) */
export interface ScenarioInfo {
  name: string;
  budget: number;
  deadline: number;
  resources: string[];
}

export type LogTag = 'SYSTEM' | 'PLAN' | 'TOPOLOGY' | 'RECOVERY' | 'ERROR';

export interface LogEntry {
  id: number;
  ts: string;
  tag: LogTag;
  message: string;
}
