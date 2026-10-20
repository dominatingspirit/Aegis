import clsx from 'clsx';
import { Loader2, Play, RotateCcw, Server, ShieldCheck, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, checkHealth, fetchScenario, requestPlan, requestRecovery } from './api/aegisClient';
import { MOCK_SCENARIO } from './api/mockEngine';
import EventLogView from './components/EventLogView';
import FailureModal from './components/FailureModal';
import MetricsPanel, { type Baseline } from './components/MetricsPanel';
import PlanGraphView from './components/PlanGraphView';
import { isScheduled, makespanOf, mergeRecovery, topologicalOrder, totalCostOf } from './lib/graph';
import { logStamp, signed, usd } from './lib/format';
import type { DataSource, LogEntry, LogTag, RecoveryReport, ScenarioInfo, Task } from './types/aegis';

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [scenario, setScenario] = useState<ScenarioInfo>(MOCK_SCENARIO);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nextLogId = useRef(1);
  const booted = useRef(false);

  const log = useCallback((tag: LogTag, message: string) => {
    setLogs((prev) => [...prev, { id: nextLogId.current++, ts: logStamp(), tag, message }]);
  }, []);

  const loadPlan = useCallback(async () => {
    setLoading(true);
    setReport(null);
    setSelectedId(null);
    try {
      const online = await checkHealth();
      log(
        'SYSTEM',
        online ? `Aegis Core Engine online at ${API_BASE}.` : `Backend unreachable at ${API_BASE}. Using built-in demo engine.`,
      );
      setScenario(await fetchScenario());

      log('PLAN', 'Requesting schedule (POST /api/plan)...');
      const result = await requestPlan(online);
      setSource(result.source);
      setTasks(result.tasks);
      setBaseline({
        makespan: result.metrics.makespan || makespanOf(result.tasks),
        totalCost: result.metrics.totalCost || totalCostOf(result.tasks),
      });

      const order = topologicalOrder(result.tasks);
      if (order) log('TOPOLOGY', `Kahn's sort validated ${order.length} tasks. Zero cycles found.`);
      else log('ERROR', 'Cycle detected in the dependency graph.');

      if (result.tasks.length > 0 && !result.tasks.some(isScheduled)) {
        log('PLAN', 'Backend returned unscheduled tasks (scheduler not merged yet). Failure injection is disabled.');
      } else {
        log('PLAN', result.metrics.message);
      }
    } catch (err) {
      log('ERROR', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [log]);

  useEffect(() => {
    if (booted.current) return; // StrictMode runs effects twice in dev
    booted.current = true;
    void loadPlan();
  }, [loadPlan]);

  const handleRecover = useCallback(
    async (failedId: string, delayHours: number) => {
      setRecovering(true);
      try {
        log('RECOVERY', `Failure injected: '${failedId}' delayed by ${delayHours}h. Running selective recovery...`);
        const rep = await requestRecovery(failedId, delayHours, tasks);
        setReport(rep);
        if (!rep.success) {
          log('ERROR', `Recovery failed: ${rep.message ?? 'unknown error'}`);
          return;
        }
        setTasks(mergeRecovery(tasks, rep));
        setModalOpen(false);
        log('RECOVERY', `BFS detected ${rep.affectedTasks.length} downstream tasks. ${rep.preservedTasks.length} unaffected tasks FROZEN.`);
        log(
          'RECOVERY',
          `Replanned: ${rep.affectedTasks.join(', ') || 'none'} | makespan ${signed(rep.deltaMakespan, 'h')} | recovery fee ${usd(rep.deltaCost)}`,
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

  return (
    <div className={clsx('min-h-screen', drawerOpen ? 'pb-72' : 'pb-16')}>
      <header className="border-b border-slate-800 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="font-mono text-lg font-bold tracking-[0.25em] text-slate-50">AEGIS</h1>
              <div className="eyebrow">{scenario.name}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {source && (
              <span
                className={clsx(
                  'inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[10px] font-semibold tracking-wider ring-1 ring-inset',
                  source === 'backend'
                    ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/40'
                    : 'bg-amber-500/10 text-amber-300 ring-amber-500/40',
                )}
              >
                <Server className="h-3 w-3" />
                {source === 'backend' ? 'LIVE BACKEND' : 'DEMO ENGINE'}
              </span>
            )}
            <button type="button" className="btn-ghost" onClick={() => void loadPlan()} disabled={loading || recovering}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : report ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {report ? 'Reset plan' : 'Re-run plan'}
            </button>
            <button type="button" className="btn-danger" onClick={() => setModalOpen(true)} disabled={!canInject || loading || recovering}>
              <Zap className="h-4 w-4" />
              Inject failure
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        <MetricsPanel tasks={tasks} budget={scenario.budget} deadline={scenario.deadline} baseline={baseline} report={report} />
        <PlanGraphView tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />
      </main>

      <FailureModal open={modalOpen} tasks={tasks} busy={recovering} onClose={() => setModalOpen(false)} onSubmit={(id, d) => void handleRecover(id, d)} />
      <EventLogView entries={logs} open={drawerOpen} onToggle={() => setDrawerOpen((v) => !v)} />
    </div>
  );
}
