import clsx from 'clsx';
import { Clock, Wallet } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Task } from '../types/aegis';
import { agentBadgeClass, STATUS_STYLES } from '../lib/theme';
import { isScheduled } from '../lib/graph';
import { usd } from '../lib/format';

interface Props {
  task: Task;
  selected: boolean;
  onSelect: (id: string) => void;
}

export default function TaskNode({ task, selected, onSelect }: Props) {
  const style = STATUS_STYLES[task.status];
  const scheduled = isScheduled(task);

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation(); // don't trigger the canvas "deselect" handler
    onSelect(task.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(task.id);
        }
      }}
      title={task.requiredResources.length > 0 ? `Resources: ${task.requiredResources.join(', ')}` : undefined}
      className={clsx(
        'flex h-full w-full cursor-pointer flex-col justify-between rounded-lg border bg-slate-900/90 p-3 text-left transition',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70',
        style.border,
        style.glow,
        style.highlight,
        task.status === 'FAILED' && 'animate-failure',
        selected && 'outline outline-1 outline-offset-2 outline-slate-300/70',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={clsx(
            'rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider ring-1 ring-inset',
            agentBadgeClass(task.agentType),
          )}
        >
          {task.agentType}
        </span>
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider ring-1 ring-inset',
            style.pill,
          )}
        >
          <span className={clsx('h-1.5 w-1.5 rounded-full', style.dot, task.status === 'FAILED' && 'animate-pulse')} />
          {style.label}
        </span>
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-100">{task.name.replace(/_/g, ' ')}</div>
        <div className="truncate font-mono text-[11px] text-slate-500">#{task.id}</div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1" title="Duration / start - end">
          <Clock className="h-3 w-3 text-slate-500" />
          {task.duration}h
          <span className="text-slate-300">{scheduled ? `H${task.startTime}-H${task.endTime}` : 'unscheduled'}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Wallet className="h-3 w-3 text-slate-500" />
          {usd(task.cost)}
        </span>
        <span className="text-slate-500">P{task.priority}</span>
      </div>
    </div>
  );
}
