import clsx from 'clsx';
import { Loader2, RefreshCw, Zap, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, checkHealth, fetchScenario, requestPlan, requestRecovery } from './api/aegisClient';
import { MOCK_SCENARIO } from './api/mockEngine';
import EventLogView from './components/EventLogView';
import FailureModal from './components/FailureModal';
import MetricsPanel, { type Baseline } from './components/MetricsPanel';
import PlanGraphView from './components/PlanGraphView';
import TaskInspector from './components/TaskInspector';
import { isScheduled, makespanOf, mergeRecovery, topologicalOrder, totalCostOf } from './lib/graph';
import { logStamp, signed, usd } from './lib/format';
import type { DataSource, LogEntry, LogTag, RecoveryReport, ScenarioInfo, Task } from './types/aegis';

const SCENARIOS = [
  { id: 'symposium', name: 'Tech Symposium 2026', badge: '6 Tasks' },
  { id: 'hackathon', name: 'Autonomous Hackathon 48H', badge: '8 Tasks' },
  { id: 'robotics', name: 'Robotics Autonomous Conclave', badge: '7 Tasks' },
];

export default function App() {
  const [scenarioId, setScenarioId] = useState('symposium');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [scenario, setScenario] = useState<ScenarioInfo>(MOCK_SCENARIO);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nextLogId = useRef(1);
  const booted = useRef(false);

  const log = useCallback((tag: LogTag, message: string) => {
    setLogs((prev) => [...prev, { id: nextLogId.current++, ts: logStamp(), tag, message }]);
  }, []);

  const loadPlan = useCallback(
    async (scId: string = scenarioId, customTasks?: Task[]) => {
      setLoading(true);
      setReport(null);
      try {
        const online = await checkHealth();
        log(
          'SYSTEM',
          online
            ? `Connected to C++ core engine at ${API_BASE}.`
            : `Backend offline. Running on fallback engine.`,
        );

        const scInfo = await fetchScenario(scId);
        setScenario(scInfo);

        log(
          'PLAN',
          customTasks
            ? `Recalculating plan with updated task parameters for [${scInfo.name}]...`
            : `Coordinating multi-agent plan for [${scInfo.name}]...`,
        );

        const result = await requestPlan(online, scId, customTasks);
        setSource(result.source);
        setTasks(result.tasks);
        setBaseline({
          makespan: result.metrics.makespan || makespanOf(result.tasks),
          totalCost: result.metrics.totalCost || totalCostOf(result.tasks),
        });

        const order = topologicalOrder(result.tasks);
        if (order) {
          log(
            'TOPOLOGY',
            `Kahn DAG sort validated: ${order.length} tasks scheduled conflict-free.`,
          );
        } else {
          log('ERROR', 'Cyclic dependency detected in task graph.');
        }
      } catch (err) {
        log('ERROR', err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [log, scenarioId],
  );

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void loadPlan('symposium');
  }, [loadPlan]);

  // When switching scenario
  const handleScenarioChange = (newScId: string) => {
    setScenarioId(newScId);
    setSelectedId(null);
    setReport(null);
    void loadPlan(newScId);
  };

  // When user tunes task duration or priority in Inspector
  const handleTaskApply = (updatedTask: Task) => {
    const updatedList = tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t));
    log(
      'PLAN',
      `Tuned task #${updatedTask.id}: duration=${updatedTask.duration}h, priority=P${updatedTask.priority}, cost=${usd(updatedTask.cost)}. Running live recalculation...`,
    );
    void loadPlan(scenarioId, updatedList);
  };

  const handleRecover = useCallback(
    async (failedId: string, delayHours: number) => {
      setRecovering(true);
      try {
        log(
          'RECOVERY',
          `Simulating disruption on '${failedId}' (+${delayHours}h). Running selective recovery...`,
        );
        const rep = await requestRecovery(failedId, delayHours, tasks);
        setReport(rep);
        if (!rep.success) {
          log('ERROR', `Recovery failed: ${rep.message ?? 'Unknown error'}`);
          return;
        }
        setTasks(mergeRecovery(tasks, rep));
        setModalOpen(false);
        log(
          'RECOVERY',
          `BFS isolated ${rep.affectedTasks.length} downstream tasks. ${rep.preservedTasks.length} independent tasks preserved without change.`,
        );
        log(
          'RECOVERY',
          `New schedule: makespan ${signed(rep.deltaMakespan, 'h')} | disruption fee ${usd(rep.deltaCost)}`,
        );
      } catch (err) {
        log('ERROR', err instanceof Error ? err.message : String(err));
      } finally {
        setRecovering(false);
      }
    },
    [log, tasks],
  );

  const canInject = tasks.some(isScheduled);
  const selectedTask = selectedId ? tasks.find((t) => t.id === selectedId) ?? null : null;

  return (
    <div
      className={clsx(
        'min-h-screen bg-zinc-950 text-zinc-100 transition-all',
        drawerOpen ? 'pb-48' : 'pb-12',
        selectedTask && 'pr-84',
      )}
    >
      {/* Sleek Minimalist Top Navigation */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          {/* Brand & Scenario Selector Dropdown */}
          <div className="flex items-center gap-3">
            <span className="font-semibold text-sm tracking-tight text-white flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              Aegis
            </span>
            <span className="text-zinc-600">/</span>

            {/* Interactive Scenario Switcher */}
            <select
              value={scenarioId}
              onChange={(e) => handleScenarioChange(e.target.value)}
              disabled={loading || recovering}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-zinc-700 focus:border-zinc-500 focus:outline-none cursor-pointer"
            >
              {SCENARIOS.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name} ({sc.badge})
                </option>
              ))}
            </select>
          </div>

          {/* Actions & Status */}
          <div className="flex items-center gap-2.5">
            {source && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-400">
                <span
                  className={clsx(
                    'h-1.5 w-1.5 rounded-full',
                    source === 'backend' ? 'bg-emerald-400' : 'bg-amber-400',
                  )}
                />
                {source === 'backend' ? 'C++ Engine · 18080' : 'Demo Engine'}
              </span>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void loadPlan(scenarioId)}
              disabled={loading || recovering}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />
              )}
              <span>{report ? 'Reset Schedule' : 'Re-run Plan'}</span>
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => setModalOpen(true)}
              disabled={!canInject || loading || recovering}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Simulate Failure</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-7xl space-y-4 px-6 py-5">
        <MetricsPanel
          tasks={tasks}
          budget={scenario.budget}
          deadline={scenario.deadline}
          baseline={baseline}
          report={report}
        />
        <PlanGraphView
          tasks={tasks}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </main>

      {/* Task Inspector Drawer (Click any node) */}
      <TaskInspector
        task={selectedTask}
        onClose={() => setSelectedId(null)}
        onApply={handleTaskApply}
        busy={loading || recovering}
      />

      {/* Failure Simulator Dialog */}
      <FailureModal
        open={modalOpen}
        tasks={tasks}
        busy={recovering}
        onClose={() => setModalOpen(false)}
        onSubmit={(id, d) => void handleRecover(id, d)}
      />

      {/* Real-time Audit Trail Drawer */}
      <EventLogView
        entries={logs}
        open={drawerOpen}
        onToggle={() => setDrawerOpen((v) => !v)}
      />
    </div>
  );
}
