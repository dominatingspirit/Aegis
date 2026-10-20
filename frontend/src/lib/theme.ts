import type { TaskStatus } from '../types/aegis';

// Tailwind only generates classes it can see as complete strings, so every
// class below is written out in full (never assembled from fragments).

export interface StatusStyle {
  label: string;
  pill: string;
  border: string;
  glow: string;
  highlight: string;
  dot: string;
  /** hex colour used for SVG connectors */
  stroke: string;
}

export const STATUS_STYLES: Record<TaskStatus, StatusStyle> = {
  PENDING: {
    label: 'PENDING',
    pill: 'bg-slate-700/40 text-slate-300 ring-slate-500/40',
    border: 'border-slate-700',
    glow: '',
    highlight: '',
    dot: 'bg-slate-400',
    stroke: '#64748b',
  },
  SCHEDULED: {
    label: 'SCHEDULED',
    pill: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
    border: 'border-emerald-500/40',
    glow: 'shadow-[0_0_20px_-8px_rgba(16,185,129,0.7)]',
    highlight: '',
    dot: 'bg-emerald-400',
    stroke: '#10b981',
  },
  REPLANNED: {
    label: 'REPLANNED',
    pill: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
    border: 'border-amber-400/70',
    glow: 'shadow-[0_0_22px_-6px_rgba(245,158,11,0.7)]',
    highlight: 'ring-2 ring-amber-400/50',
    dot: 'bg-amber-400',
    stroke: '#f59e0b',
  },
  FAILED: {
    label: 'FAILED',
    pill: 'bg-red-500/15 text-red-300 ring-red-500/50',
    border: 'border-red-500/80',
    glow: '',
    highlight: '',
    dot: 'bg-red-400',
    stroke: '#ef4444',
  },
  PRESERVED: {
    label: 'PRESERVED',
    pill: 'bg-blue-500/15 text-blue-300 ring-blue-500/40',
    border: 'border-blue-400/70',
    glow: 'shadow-[0_0_20px_-8px_rgba(59,130,246,0.7)]',
    highlight: 'ring-2 ring-blue-400/50',
    dot: 'bg-blue-400',
    stroke: '#3b82f6',
  },
};

export const STATUS_ORDER: TaskStatus[] = ['SCHEDULED', 'PRESERVED', 'REPLANNED', 'FAILED', 'PENDING'];

const AGENT_BADGES: Record<string, string> = {
  VENUE: 'bg-violet-500/15 text-violet-300 ring-violet-500/40',
  LOGISTICS: 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/40',
  SPEAKER: 'bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/40',
};

export function agentBadgeClass(agentType: string): string {
  return AGENT_BADGES[agentType] ?? 'bg-slate-700/40 text-slate-300 ring-slate-500/40';
}
