import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, X, Zap } from 'lucide-react';
import type { Task } from '../types/aegis';
import { downstreamOf, isScheduled } from '../lib/graph';

interface Props {
  open: boolean;
  tasks: Task[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (taskId: string, delayHours: number) => void;
}

export default function FailureModal({ open, tasks, busy, onClose, onSubmit }: Props) {
  const [taskId, setTaskId] = useState('');
  const [delay, setDelay] = useState(3);

  const candidates = useMemo(() => tasks.filter((t) => isScheduled(t) && t.status !== 'FAILED'), [tasks]);
  const selectedId = candidates.some((t) => t.id === taskId) ? taskId : (candidates[0]?.id ?? '');

  // What the selected failure would touch (computed with the same BFS the backend uses).
  const impact = useMemo(() => {
    if (!selectedId) return null;
    const affected = downstreamOf(tasks, selectedId);
    const scheduledTotal = tasks.filter(isScheduled).length;
    return { downstream: affected.size - 1, frozen: scheduledTotal - affected.size };
  }, [tasks, selectedId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="failure-title"
        className="panel w-full max-w-md animate-slide-up border-red-500/30 p-6 shadow-2xl shadow-red-950/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow text-red-400/80">Failure simulator</div>
            <h2 id="failure-title" className="mt-1 text-lg font-semibold text-slate-50">
              Inject a task failure
            </h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-md p-1 text-slate-500 hover:text-slate-200 disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mt-5 block">
          <span className="eyebrow">Task that fails</span>
          <select
            value={selectedId}
            onChange={(e) => setTaskId(e.target.value)}
            disabled={busy || candidates.length === 0}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-red-400/60 focus:outline-none"
          >
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} ({t.agentType}, H{t.startTime}-H{t.endTime})
              </option>
            ))}
          </select>
        </label>

        <label className="mt-5 block">
          <span className="flex items-center justify-between">
            <span className="eyebrow">Delay</span>
            <span className="font-mono text-sm font-semibold text-amber-300">+{delay}h</span>
          </span>
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
            disabled={busy}
            className="mt-2 w-full accent-amber-400"
          />
          <span className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <span key={n}>{n}h</span>
            ))}
          </span>
        </label>

        {impact && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Blast radius: <b className="text-amber-300">{impact.downstream}</b> downstream task
              {impact.downstream === 1 ? '' : 's'} will be replanned; <b className="text-blue-300">{impact.frozen}</b> will stay
              frozen.
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => selectedId && onSubmit(selectedId, delay)}
          disabled={busy || !selectedId}
          className="btn-danger mt-6 w-full justify-center"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          Inject Failure &amp; Execute Selective Recovery
        </button>
      </div>
    </div>
  );
}
