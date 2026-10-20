import { useState, useEffect } from 'react';
import { X, Play, Layers } from 'lucide-react';
import type { Task } from '../types/aegis';
import { agentLabel, STATUS_STYLES } from '../lib/theme';
import { usd } from '../lib/format';

interface Props {
  task: Task | null;
  onClose: () => void;
  onApply: (updatedTask: Task) => void;
  busy: boolean;
}

export default function TaskInspector({ task, onClose, onApply, busy }: Props) {
  const [duration, setDuration] = useState(task?.duration ?? 2);
  const [priority, setPriority] = useState(task?.priority ?? 3);
  const [cost, setCost] = useState(task?.cost ?? 500);

  useEffect(() => {
    if (task) {
      setDuration(task.duration);
      setPriority(task.priority);
      setCost(task.cost);
    }
  }, [task]);

  if (!task) return null;

  const style = STATUS_STYLES[task.status];
  const hasChanged =
    duration !== task.duration || priority !== task.priority || cost !== task.cost;

  const handleApply = () => {
    onApply({
      ...task,
      duration,
      priority,
      cost,
    });
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-84 border-l border-zinc-800 bg-zinc-950/95 p-5 shadow-2xl backdrop-blur-md flex flex-col justify-between">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
                {agentLabel(task.agentType)}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${style.pill}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                {style.label}
              </span>
            </div>
            <h3 className="mt-1.5 text-sm font-semibold text-zinc-100">{task.name}</h3>
            <div className="font-mono text-[11px] text-zinc-500">{task.id}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Current Placement info */}
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3 text-xs space-y-1.5 font-mono">
          <div className="flex justify-between text-zinc-400">
            <span>Scheduled Window:</span>
            <span className="text-zinc-200">
              {task.startTime >= 0 ? `H${task.startTime} → H${task.endTime}` : 'Unscheduled'}
            </span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Resources:</span>
            <span className="text-zinc-200 truncate max-w-[120px]">
              {task.requiredResources.join(', ') || 'None'}
            </span>
          </div>
          {task.dependencies.length > 0 && (
            <div className="flex justify-between text-zinc-400">
              <span>Prerequisites:</span>
              <span className="text-zinc-200 truncate max-w-[120px]">
                {task.dependencies.join(', ')}
              </span>
            </div>
          )}
        </div>

        {/* Editable Parameters */}
        <div className="space-y-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Tune Parameters
          </div>

          {/* Duration */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300">Task Duration</span>
              <span className="font-mono font-semibold text-zinc-100">{duration} hours</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="mt-1.5 w-full accent-zinc-300"
            />
            <div className="flex justify-between font-mono text-[10px] text-zinc-500">
              <span>1h</span>
              <span>5h</span>
              <span>10h</span>
            </div>
          </div>

          {/* Priority */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300">Scheduling Priority</span>
              <span className="font-mono font-semibold text-zinc-100">P{priority}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-5 gap-1 font-mono text-xs">
              {[1, 2, 3, 4, 5].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`rounded py-1 transition ${
                    priority === p
                      ? 'bg-zinc-200 text-zinc-950 font-bold'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  P{p}
                </button>
              ))}
            </div>
          </div>

          {/* Cost */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300">Estimated Cost</span>
              <span className="font-mono font-semibold text-zinc-100">{usd(cost)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min={100}
                max={10000}
                step={100}
                value={cost}
                onChange={(e) => setCost(Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-100 focus:border-zinc-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="border-t border-zinc-800 pt-3 space-y-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={busy || !hasChanged}
          className="btn-primary w-full py-2"
        >
          <Play className="h-3.5 w-3.5" />
          <span>Apply & Recalculate</span>
        </button>
        <p className="text-[10px] text-zinc-500 text-center">
          Re-runs Kahn's DAG topological sort & priority queues
        </p>
      </div>
    </div>
  );
}
