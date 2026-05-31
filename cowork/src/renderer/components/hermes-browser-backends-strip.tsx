import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Globe2,
  PlayCircle,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

export type HermesBrowserBackendStatus = 'available' | 'configured' | 'missing' | 'unsupported';

export interface HermesBrowserBackendReviewItem {
  command: string | null;
  configured: boolean;
  credentialSources: string[];
  id: string;
  installed: boolean;
  label: string;
  notes: string[];
  officialSurface: string;
  remediation: string[];
  runnable: boolean;
  smokeCommand: string | null;
  status: HermesBrowserBackendStatus;
  version: string | null;
}

export interface HermesBrowserBackendsReview {
  backends: HermesBrowserBackendReviewItem[];
  command: string;
  generatedAt: string;
  issues: string[];
  localRunnableCount: number;
  managedConfiguredCount: number;
  ok: boolean;
  platform: string;
  recommendations: string[];
}

export interface HermesBrowserBackendSmokeResult {
  backendId: string;
  command: string | null;
  durationMs: number;
  finishedAt: string;
  label: string | null;
  ok: boolean;
  output: string;
  startedAt: string;
  status: 'passed' | 'failed' | 'blocked' | 'unsupported' | 'not-runnable';
  stderr: string;
  stdout: string;
}

interface HermesBrowserBackendsApi {
  get?: () => Promise<HermesBrowserBackendsReview | null>;
  smoke?: (options: {
    backendId: string;
  }) => Promise<{
    error?: string;
    ok: boolean;
    result?: HermesBrowserBackendSmokeResult;
  }>;
}

export const HermesBrowserBackendsStrip: React.FC<{
  error?: string | null;
  readiness?: HermesBrowserBackendsReview | null;
}> = ({ error = null, readiness }) => {
  const { t } = useTranslation();
  const [loadedReadiness, setLoadedReadiness] = useState<HermesBrowserBackendsReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [smokeErrors, setSmokeErrors] = useState<Record<string, string>>({});
  const [smokeResults, setSmokeResults] = useState<Record<string, HermesBrowserBackendSmokeResult>>({});
  const [smokingBackendId, setSmokingBackendId] = useState<string | null>(null);
  const visibleReadiness = readiness ?? loadedReadiness;
  const visibleError = error ?? loadError;
  const command = useMemo(
    () => visibleReadiness?.command ?? 'buddy hermes browser status --json',
    [visibleReadiness?.command]
  );
  const statusClass = visibleReadiness?.ok
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';
  const statusText = visibleReadiness?.ok
    ? t('fleet.hermesBrowserBackends.readyChip', 'browser ready')
    : t('fleet.hermesBrowserBackends.attentionChip', 'browser attention');

  useEffect(() => {
    if (readiness !== undefined) return;
    const api = getHermesBrowserBackendsApi();
    if (!api?.get) return;
    let cancelled = false;

    void api
      .get()
      .then((result) => {
        if (cancelled) return;
        setLoadedReadiness(result);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedReadiness(null);
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [readiness]);

  const handleRunSmoke = async (backend: HermesBrowserBackendReviewItem) => {
    const smoke = getHermesBrowserBackendsApi()?.smoke;
    if (!smoke) {
      setSmokeErrors((current) => ({
        ...current,
        [backend.id]: t('fleet.hermesBrowserBackends.smokeUnavailable', 'Live smoke runner is unavailable.'),
      }));
      return;
    }

    setSmokingBackendId(backend.id);
    setSmokeErrors((current) => {
      const next = { ...current };
      delete next[backend.id];
      return next;
    });

    try {
      const response = await smoke({ backendId: backend.id });
      if (!response.ok || !response.result) {
        throw new Error(response.error ?? 'Browser smoke failed.');
      }
      setSmokeResults((current) => ({
        ...current,
        [backend.id]: response.result!,
      }));
    } catch (smokeErrorValue) {
      setSmokeErrors((current) => ({
        ...current,
        [backend.id]: smokeErrorValue instanceof Error ? smokeErrorValue.message : String(smokeErrorValue),
      }));
    } finally {
      setSmokingBackendId(null);
    }
  };

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-browser-backends"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Globe2 size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesBrowserBackends.title', 'Hermes browser backends')}
          </span>
        </div>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}
        >
          {visibleReadiness
            ? statusText
            : t('fleet.hermesBrowserBackends.loadingChip', 'browser')}
        </span>
      </div>

      {visibleReadiness ? (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-text-secondary">
            <BrowserMetric
              icon={<CheckCircle2 size={10} />}
              label={t('fleet.hermesBrowserBackends.localLabel', 'Local')}
              value={String(visibleReadiness.localRunnableCount)}
              tone={visibleReadiness.localRunnableCount > 0 ? 'success' : 'warning'}
            />
            <BrowserMetric
              icon={<Cloud size={10} />}
              label={t('fleet.hermesBrowserBackends.managedLabel', 'Managed')}
              value={String(visibleReadiness.managedConfiguredCount)}
              tone={visibleReadiness.managedConfiguredCount > 0 ? 'success' : 'default'}
            />
            <BrowserMetric
              icon={<ShieldCheck size={10} />}
              label={t('fleet.hermesBrowserBackends.platformLabel', 'Platform')}
              value={visibleReadiness.platform}
            />
          </div>

          <div className="mt-1.5 grid gap-1">
            {visibleReadiness.backends.map((backend) => (
              <BrowserBackendRow
                key={backend.id}
                backend={backend}
                isSmokeRunning={smokingBackendId === backend.id}
                onRunSmoke={handleRunSmoke}
                smokeError={smokeErrors[backend.id]}
                smokeResult={smokeResults[backend.id]}
              />
            ))}
          </div>

          {visibleReadiness.issues.slice(0, 2).map((issue) => (
            <div
              key={issue}
              className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning"
            >
              <AlertTriangle size={10} className="mt-0.5 shrink-0" />
              <span className="min-w-0">{issue}</span>
            </div>
          ))}

          {visibleReadiness.issues.length === 0 && visibleReadiness.recommendations[0] ? (
            <div className="mt-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
              {visibleReadiness.recommendations[0]}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <AlertTriangle size={10} className="shrink-0 text-warning" />
          <span className="truncate">
            {t('fleet.hermesBrowserBackends.unavailable', 'Hermes browser backends are not loaded yet.')}
          </span>
        </div>
      )}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesBrowserBackends.loadFailed', 'Hermes browser backend load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>
    </section>
  );
};

const BrowserBackendRow: React.FC<{
  backend: HermesBrowserBackendReviewItem;
  isSmokeRunning?: boolean;
  onRunSmoke?: (backend: HermesBrowserBackendReviewItem) => void;
  smokeError?: string;
  smokeResult?: HermesBrowserBackendSmokeResult;
}> = ({ backend, isSmokeRunning = false, onRunSmoke, smokeError, smokeResult }) => {
  const { t } = useTranslation();
  const tone = backend.runnable
    ? 'text-success'
    : backend.configured || backend.installed
      ? 'text-warning'
      : 'text-text-muted';
  const smoke = backend.smokeCommand ?? backend.command ?? backend.id;
  const canSmoke = Boolean(onRunSmoke && backend.runnable && backend.smokeCommand);
  const statusLabels: Record<HermesBrowserBackendStatus, string> = {
    available: t('fleet.hermesBrowserBackends.status.available', 'available'),
    configured: t('fleet.hermesBrowserBackends.status.configured', 'configured'),
    missing: t('fleet.hermesBrowserBackends.status.missing', 'missing'),
    unsupported: t('fleet.hermesBrowserBackends.status.unsupported', 'unsupported'),
  };
  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1 text-[10px]">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-text-secondary">{backend.label}</span>
        <div className="flex shrink-0 items-center gap-1">
          {backend.smokeCommand ? (
            <button
              aria-label={t('fleet.hermesBrowserBackends.runSmoke', 'Run browser smoke')}
              className="rounded border border-border-muted bg-background p-0.5 text-text-muted transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              data-testid={`hermes-browser-smoke-${backend.id}`}
              disabled={!canSmoke || isSmokeRunning}
              onClick={() => onRunSmoke?.(backend)}
              title={t('fleet.hermesBrowserBackends.runSmoke', 'Run browser smoke')}
              type="button"
            >
              <PlayCircle size={10} />
            </button>
          ) : null}
          <span className={`rounded bg-background px-1 py-0.5 text-[9px] ${tone}`}>
            {statusLabels[backend.status]}
          </span>
        </div>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] text-text-muted">
        <span className="shrink-0">{backend.id}</span>
        <span className="truncate">
          {backend.version ?? t('fleet.hermesBrowserBackends.noVersion', 'no version')}
        </span>
      </div>
      <div className="mt-0.5 truncate font-mono text-[9px] text-text-muted">{smoke}</div>
      {smokeResult || smokeError ? (
        <div
          className={`mt-0.5 truncate rounded bg-background px-1 py-0.5 text-[9px] ${
            smokeResult?.ok ? 'text-success' : 'text-warning'
          }`}
          data-testid={`hermes-browser-smoke-result-${backend.id}`}
        >
          {smokeResult
            ? t(
              smokeResult.ok
                ? 'fleet.hermesBrowserBackends.smokePassed'
                : 'fleet.hermesBrowserBackends.smokeFailed',
              smokeResult.ok ? 'smoke passed: {{output}}' : 'smoke {{status}}: {{output}}',
              {
                output: smokeResult.output || smokeResult.status,
                status: smokeResult.status,
              }
            )
            : smokeError}
        </div>
      ) : null}
    </div>
  );
};

const BrowserMetric: React.FC<{
  icon: React.ReactNode;
  label: string;
  tone?: 'default' | 'success' | 'warning';
  value: string;
}> = ({ icon, label, tone = 'default', value }) => {
  const valueClass =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-text-secondary';
  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1">
      <div className="flex min-w-0 items-center gap-1 text-[9px] uppercase tracking-wider text-text-muted">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-0.5 truncate ${valueClass}`}>{value}</div>
    </div>
  );
};

function getHermesBrowserBackendsApi(): HermesBrowserBackendsApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesBrowserBackends?: HermesBrowserBackendsApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesBrowserBackends;
}
