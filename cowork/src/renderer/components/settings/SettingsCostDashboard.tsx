/**
 * SettingsCostDashboard — Claude Cowork parity Phase 2
 *
 * Shows cumulative spend, daily trend bar chart, and per-model pie chart.
 * All charts are native SVG to keep bundle size down.
 *
 * @module renderer/components/settings/SettingsCostDashboard
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, TrendingUp, BarChart3, AlertTriangle, Save } from 'lucide-react';

interface CostSummary {
  sessionCost: number;
  dailyCost: number;
  weeklyCost: number;
  monthlyCost: number;
  totalCost: number;
  sessionTokens: { input: number; output: number };
  modelBreakdown: Record<string, { cost: number; calls: number }>;
  budgetLimit?: number;
  dailyLimit?: number;
}

interface DailyCostPoint {
  date: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

interface ModelBreakdown {
  model: string;
  cost: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

// Tailwind-safe palette for pie slices and bar fills
const CHART_PALETTE = [
  'var(--color-accent)',
  'var(--color-success)',
  'var(--color-warning)',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
];

function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return '<$0.01';
  return `$${value.toFixed(2)}`;
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

const DailyBarChart: React.FC<{ data: DailyCostPoint[] }> = ({ data }) => {
  if (data.length === 0) {
    return null;
  }
  const maxCost = Math.max(...data.map((d) => d.cost), 0.01);
  const barWidth = 16;
  const gap = 4;
  const chartHeight = 120;
  const width = data.length * (barWidth + gap);
  return (
    <svg
      viewBox={`0 0 ${width} ${chartHeight + 24}`}
      className="w-full h-36"
      preserveAspectRatio="none"
    >
      {data.map((point, i) => {
        const height = (point.cost / maxCost) * chartHeight;
        const x = i * (barWidth + gap);
        const y = chartHeight - height;
        return (
          <g key={point.date}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={height}
              rx={2}
              fill="var(--color-accent)"
              opacity={0.8}
            >
              <title>{`${point.date}: ${formatUsd(point.cost)}`}</title>
            </rect>
            {i === 0 || i === data.length - 1 ? (
              <text
                x={x + barWidth / 2}
                y={chartHeight + 14}
                fontSize="8"
                textAnchor="middle"
                fill="var(--color-text-secondary)"
              >
                {point.date.slice(5)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

const ModelPieChart: React.FC<{ data: ModelBreakdown[] }> = ({ data }) => {
  const totalCost = data.reduce((sum, d) => sum + d.cost, 0);
  if (totalCost <= 0 || data.length === 0) {
    return null;
  }
  const size = 140;
  const radius = 60;
  const cx = size / 2;
  const cy = size / 2;

  let cumulativeAngle = 0;
  const slices = data.slice(0, 8).map((entry, i) => {
    const fraction = entry.cost / totalCost;
    const angle = fraction * 2 * Math.PI;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + angle;
    cumulativeAngle = endAngle;

    const x1 = cx + radius * Math.sin(startAngle);
    const y1 = cy - radius * Math.cos(startAngle);
    const x2 = cx + radius * Math.sin(endAngle);
    const y2 = cy - radius * Math.cos(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;

    const path = `M ${cx},${cy} L ${x1},${y1} A ${radius},${radius} 0 ${largeArc},1 ${x2},${y2} Z`;

    return {
      path,
      fill: CHART_PALETTE[i % CHART_PALETTE.length],
      model: entry.model,
      cost: entry.cost,
      fraction,
    };
  });

  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-32 h-32">
        {slices.map((slice) => (
          <path key={slice.model} d={slice.path} fill={slice.fill} opacity={0.85}>
            <title>{`${slice.model}: ${formatUsd(slice.cost)} (${(slice.fraction * 100).toFixed(1)}%)`}</title>
          </path>
        ))}
      </svg>
      <div className="flex-1 min-w-0 space-y-1">
        {slices.map((slice) => (
          <div key={slice.model} className="flex items-center gap-2 text-[11px]">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: slice.fill }}
            />
            <span className="text-text-secondary font-mono truncate flex-1">
              {slice.model}
            </span>
            <span className="text-text-primary">{formatUsd(slice.cost)}</span>
            <span className="text-text-muted">
              {(slice.fraction * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'default' | 'warning' | 'success';
  icon?: React.ReactNode;
}> = ({ label, value, sublabel, tone = 'default', icon }) => {
  const toneClass =
    tone === 'warning'
      ? 'border-warning/40 bg-warning/10'
      : tone === 'success'
        ? 'border-success/40 bg-success/10'
        : 'border-border-muted bg-surface/40';
  return (
    <div className={`p-3 rounded-lg border ${toneClass}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-text-primary">{value}</div>
      {sublabel && <div className="text-[10px] text-text-muted mt-0.5">{sublabel}</div>}
    </div>
  );
};

export const SettingsCostDashboard: React.FC = () => {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [history, setHistory] = useState<DailyCostPoint[]>([]);
  const [models, setModels] = useState<ModelBreakdown[]>([]);
  const [loading, setLoading] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [dailyInput, setDailyInput] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (!api?.cost) {
        return;
      }
      const [s, h, m] = await Promise.all([
        api.cost.summary(),
        api.cost.history(30),
        api.cost.modelBreakdown(30),
      ]);
      setSummary(s as CostSummary);
      setHistory(h as DailyCostPoint[]);
      setModels(m as ModelBreakdown[]);
      if ((s as CostSummary).budgetLimit !== undefined) {
        setBudgetInput(String((s as CostSummary).budgetLimit));
      }
      if ((s as CostSummary).dailyLimit !== undefined) {
        setDailyInput(String((s as CostSummary).dailyLimit));
      }
    } catch (err) {
      console.error('[SettingsCostDashboard] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const budgetProgress = useMemo(() => {
    if (!summary?.budgetLimit || summary.budgetLimit <= 0) return null;
    return Math.min(100, (summary.monthlyCost / summary.budgetLimit) * 100);
  }, [summary]);

  const handleSaveBudget = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.cost) return;
    setSaving(true);
    try {
      const monthly = Number.parseFloat(budgetInput);
      const daily = Number.parseFloat(dailyInput);
      if (!Number.isNaN(monthly) && monthly > 0) {
        await api.cost.setBudget(monthly);
      }
      if (!Number.isNaN(daily) && daily > 0) {
        await api.cost.setDailyLimit(daily);
      }
      await load();
    } finally {
      setSaving(false);
    }
  }, [budgetInput, dailyInput, load]);

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center py-12 text-xs text-text-muted">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-border-muted">
        <div className="flex items-center gap-2">
          <DollarSign size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">
            {t('costDashboard.title')}
          </h2>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label={t('costDashboard.today')}
            value={formatUsd(summary?.dailyCost ?? 0)}
            icon={<TrendingUp size={10} />}
          />
          <StatCard
            label={t('costDashboard.week')}
            value={formatUsd(summary?.weeklyCost ?? 0)}
            icon={<BarChart3 size={10} />}
          />
          <StatCard
            label={t('costDashboard.month')}
            value={formatUsd(summary?.monthlyCost ?? 0)}
            sublabel={
              budgetProgress !== null
                ? `${budgetProgress.toFixed(0)}% ${t('costDashboard.ofBudget')}`
                : undefined
            }
            tone={budgetProgress !== null && budgetProgress >= 90 ? 'warning' : 'default'}
          />
          <StatCard
            label={t('costDashboard.total')}
            value={formatUsd(summary?.totalCost ?? 0)}
          />
        </div>

        {/* Budget progress */}
        {budgetProgress !== null && summary?.budgetLimit && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-text-muted">
              <span>{t('costDashboard.monthlyBudget')}</span>
              <span>
                {formatUsd(summary.monthlyCost)} / {formatUsd(summary.budgetLimit)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-active overflow-hidden">
              <div
                className={`h-full transition-all ${
                  budgetProgress >= 90
                    ? 'bg-error'
                    : budgetProgress >= 75
                      ? 'bg-warning'
                      : 'bg-accent'
                }`}
                style={{ width: `${budgetProgress}%` }}
              />
            </div>
            {budgetProgress >= 90 && (
              <div className="flex items-center gap-1 text-[11px] text-error">
                <AlertTriangle size={10} />
                {t('costDashboard.overBudgetWarning')}
              </div>
            )}
          </div>
        )}

        {/* Daily trend chart */}
        <div className="p-3 rounded-lg border border-border-muted bg-surface/40">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
              {t('costDashboard.dailyTrend')}
            </h3>
            <span className="text-[10px] text-text-muted">
              {t('costDashboard.last30Days')}
            </span>
          </div>
          {history.length > 0 ? (
            <DailyBarChart data={history} />
          ) : (
            <div className="py-8 text-center text-[11px] text-text-muted">
              {t('costDashboard.noData')}
            </div>
          )}
        </div>

        {/* Model breakdown */}
        <div className="p-3 rounded-lg border border-border-muted bg-surface/40">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-3">
            {t('costDashboard.modelBreakdown')}
          </h3>
          {models.length > 0 ? (
            <ModelPieChart data={models} />
          ) : (
            <div className="py-6 text-center text-[11px] text-text-muted">
              {t('costDashboard.noData')}
            </div>
          )}
        </div>

        {/* Budget settings */}
        <div className="p-3 rounded-lg border border-border-muted bg-surface/40">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-3">
            {t('costDashboard.budgetSettings')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-text-secondary mb-1 block">
                {t('costDashboard.monthlyLimit')}
              </label>
              <div className="flex items-center gap-1">
                <span className="text-xs text-text-muted">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  placeholder="100.00"
                  className="flex-1 px-2 py-1 text-xs bg-surface border border-border rounded text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-text-secondary mb-1 block">
                {t('costDashboard.dailyLimit')}
              </label>
              <div className="flex items-center gap-1">
                <span className="text-xs text-text-muted">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={dailyInput}
                  onChange={(e) => setDailyInput(e.target.value)}
                  placeholder="10.00"
                  className="flex-1 px-2 py-1 text-xs bg-surface border border-border rounded text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <button
              onClick={handleSaveBudget}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded"
            >
              <Save size={12} />
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        {/* Session tokens */}
        {summary && (
          <div className="p-3 rounded-lg border border-border-muted bg-surface/40">
            <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-2">
              {t('costDashboard.currentSession')}
            </h3>
            <div className="grid grid-cols-3 gap-3 text-[11px]">
              <div>
                <div className="text-text-muted">{t('costDashboard.input')}</div>
                <div className="text-text-primary font-mono">
                  {formatNumber(summary.sessionTokens.input)}
                </div>
              </div>
              <div>
                <div className="text-text-muted">{t('costDashboard.output')}</div>
                <div className="text-text-primary font-mono">
                  {formatNumber(summary.sessionTokens.output)}
                </div>
              </div>
              <div>
                <div className="text-text-muted">{t('costDashboard.cost')}</div>
                <div className="text-text-primary font-mono">
                  {formatUsd(summary.sessionCost)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
