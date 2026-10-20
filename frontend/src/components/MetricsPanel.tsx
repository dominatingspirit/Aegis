import clsx from 'clsx';
import { Clock, Gauge, ShieldCheck, Snowflake, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RecoveryReport, Task } from '../types/aegis';
import { makespanOf, totalCostOf } from '../lib/graph';
import { signed, usd } from '../lib/format';

export interface Baseline {
  makespan: number;
  totalCost: number;
}

interface Props {
  tasks: Task[];
  budget: number;
  deadline: number;
  baseline: Baseline | null;
  report: RecoveryReport | null;
}

interface KpiProps {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  chip?: { text: string; tone: 'good' | 'warn' | 'bad' };
  children?: ReactNode;
}

const CHIP_TONES = {
  good: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
  warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
  bad: 'bg-red-500/15 text-red-300 ring-red-500/40',
} as const;

function Kpi({ icon, label, value, sub, chip, children }: KpiProps) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <div className="eyebrow inline-flex items-center gap-2">
          {icon}
          {label}
        </div>
        {chip && (
          <span className={clsx('rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset', CHIP_TONES[chip.tone])}>
            {chip.text}
          </span>
        )}
      </div>
      <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-slate-50">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
      {children}
    </div>
  );
}

export default function MetricsPanel({ tasks, budget, deadline, baseline, report }: Props) {
  const total = tasks.length;
  const makespan = makespanOf(tasks);
  const planCost = totalCostOf(tasks);
  const recoveryFee = report?.success ? report.deltaCost : 0;
  const spend = planCost + recoveryFee;

  const preserved = tasks.filter((t) => t.status === 'PRESERVED').length;
  const replanned = tasks.filter((t) => t.status === 'REPLANNED').length;
  const failed = tasks.filter((t) => t.status === 'FAILED').length;

  // Share of the plan that had to be touched (failed + replanned tasks).
  const disruption = total > 0 ? Math.round(((failed + replanned) / total) * 100) : 0;

  const makespanDelta = baseline ? makespan - baseline.makespan : 0;
  const overDeadline = makespan > deadline;
  const budgetUsed = budget > 0 ? Math.min(100, (spend / budget) * 100) : 0;
  const overBudget = spend > budget;

  return (
    <section className="space-y-4" aria-label="Plan metrics">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Makespan"
          value={`${makespan}h`}
          sub={`Deadline ${deadline}h`}
          chip={
            overDeadline
              ? { text: 'OVER DEADLINE', tone: 'bad' }
              : makespanDelta > 0
                ? { text: `${signed(makespanDelta, 'h')} vs baseline`, tone: 'warn' }
                : { text: 'ON TIME', tone: 'good' }
          }
        />

        <Kpi
          icon={<Wallet className="h-3.5 w-3.5" />}
          label="Total budget"
          value={usd(spend)}
          sub={recoveryFee > 0 ? `${usd(planCost)} plan + ${usd(recoveryFee)} recovery fee` : `of ${usd(budget)} budget`}
          chip={overBudget ? { text: 'OVER BUDGET', tone: 'bad' } : undefined}
        >
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={Math.round(budgetUsed)} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={clsx('h-full rounded-full transition-all', overBudget ? 'bg-red-500' : 'bg-emerald-500')}
              style={{ width: `${budgetUsed}%` }}
            />
          </div>
        </Kpi>

        <Kpi
          icon={<Gauge className="h-3.5 w-3.5" />}
          label="Disruption score"
          value={`${disruption}%`}
          sub={report?.success ? `${failed + replanned} of ${total} tasks touched` : 'No failures injected'}
          chip={report?.success ? { text: disruption <= 50 ? 'CONTAINED' : 'WIDE', tone: disruption <= 50 ? 'good' : 'warn' } : undefined}
        />

        <Kpi
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          label="Preserved / replanned"
          value={`${preserved} / ${replanned}`}
          sub="frozen vs rescheduled tasks"
        />
      </div>

      {report && (
        <div
          role="status"
          className={clsx(
            'flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-4 py-3 text-sm',
            report.success
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
              : 'border-red-500/40 bg-red-500/10 text-red-200',
          )}
        >
          {report.success ? (
            <>
              <span className="inline-flex items-center gap-2 font-semibold">
                <Snowflake className="h-4 w-4 text-blue-300" />
                {report.preservedTasks.length} of {total} tasks saved from replanning (
                {total > 0 ? Math.round((report.preservedTasks.length / total) * 100) : 0}%)
              </span>
              <span className="font-mono text-xs text-emerald-200/80">
                A full replan would have disturbed all {total}.
              </span>
              <span className="font-mono text-xs text-emerald-200/80">
                Makespan {signed(report.deltaMakespan, 'h')} · Recovery fee {usd(report.deltaCost)}
              </span>
            </>
          ) : (
            <span className="font-semibold">Recovery failed: {report.message ?? 'unknown error'}</span>
          )}
        </div>
      )}
    </section>
  );
}
