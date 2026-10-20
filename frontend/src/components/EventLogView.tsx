import clsx from 'clsx';
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { LogEntry, LogTag } from '../types/aegis';

interface Props {
  entries: LogEntry[];
  open: boolean;
  onToggle: () => void;
}

const TAG_COLORS: Record<LogTag, string> = {
  SYSTEM: 'text-slate-400',
  PLAN: 'text-sky-400',
  TOPOLOGY: 'text-emerald-400',
  RECOVERY: 'text-amber-400',
  ERROR: 'text-red-400',
};

export default function EventLogView({ entries, open, onToggle }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view.
  useEffect(() => {
    const el = bodyRef.current;
    if (open && el) el.scrollTop = el.scrollHeight;
  }, [entries.length, open]);

  return (
    <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-slate-900/60"
      >
        <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold tracking-wider text-emerald-400">
          <Terminal className="h-4 w-4" />
          AUDIT LOG
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{entries.length}</span>
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronUp className="h-4 w-4 text-slate-500" />}
      </button>

      {open && (
        <div ref={bodyRef} className="h-48 overflow-y-auto border-t border-slate-800 px-4 py-3 font-mono text-xs leading-relaxed">
          {entries.length === 0 && <div className="text-slate-600">Awaiting events...</div>}
          {entries.map((e) => (
            <div key={e.id} className="whitespace-pre-wrap break-words">
              <span className="text-slate-600">{e.ts}</span>{' '}
              <span className={clsx('font-semibold', TAG_COLORS[e.tag])}>[{e.tag}]</span>{' '}
              <span className={e.tag === 'ERROR' ? 'text-red-300' : 'text-slate-300'}>{e.message}</span>
            </div>
          ))}
          <div className="text-emerald-500">
            $ <span className="animate-pulse">_</span>
          </div>
        </div>
      )}
    </aside>
  );
}
