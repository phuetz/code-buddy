import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Globe2,
  Network,
  PlayCircle,
  Server,
  Terminal,
} from 'lucide-react';
import type { HermesBrowserBackendSmokeResult } from './hermes-browser-backends-strip';
import type { HermesProtocolGatewaySmokeResult } from './hermes-protocol-gateways-strip';
import type { HermesRuntimeBackendSmokeResult } from './hermes-runtime-backends-strip';

export interface HermesLocalSmokeSuiteReview {
  commands: {
    browser: string;
    protocols: string;
    runtime: string;
    suite: string;
  };
  generatedAt: string;
  kind: 'hermes_local_smoke_suite';
  notes: string[];
  ok: boolean;
  results: {
    browser: HermesBrowserBackendSmokeResult;
    protocols: HermesProtocolGatewaySmokeResult;
    runtime: HermesRuntimeBackendSmokeResult;
  };
  schemaVersion: 1;
  summary: {
    passed: number;
    total: 3;
  };
}

interface HermesLocalSmokeApi {
  run?: () => Promise<{
    error?: string;
    ok: boolean;
    result?: HermesLocalSmokeSuiteReview;
  }>;
}

export const HermesLocalSmokeStrip: React.FC = () => {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HermesLocalSmokeSuiteReview | null>(null);
  const statusClass = result?.ok
    ? 'border-success/40 bg-success/10 text-success'
    : error
      ? 'border-warning/40 bg-warning/10 text-warning'
      : 'border-border-muted bg-background text-text-muted';
  const statusText = result
    ? t('fleet.hermesLocalSmoke.resultChip', '{{passed}}/{{total}} passed', {
      passed: result.summary.passed,
      total: result.summary.total,
    })
    : error
      ? t('fleet.hermesLocalSmoke.failedChip', 'smoke failed')
      : t('fleet.hermesLocalSmoke.idleChip', 'local smoke');

  const handleRunSmoke = async () => {
    const run = getHermesLocalSmokeApi()?.run;
    if (!run) {
      setError(t('fleet.hermesLocalSmoke.unavailable', 'Hermes local smoke runner is unavailable.'));
      return;
    }

    setRunning(true);
    setError(null);

    try {
      const response = await run();
      if (!response.ok || !response.result) {
        throw new Error(response.error ?? 'Hermes local smoke failed.');
      }
      setResult(response.result);
    } catch (smokeErrorValue) {
      setResult(null);
      setError(smokeErrorValue instanceof Error ? smokeErrorValue.message : String(smokeErrorValue));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-local-smoke"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FlaskConical size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesLocalSmoke.title', 'Hermes local smoke')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label={t('fleet.hermesLocalSmoke.runSmoke', 'Run local smoke')}
            className="rounded border border-border-muted bg-background p-0.5 text-text-muted transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="hermes-local-smoke-run"
            disabled={running}
            onClick={() => void handleRunSmoke()}
            title={t('fleet.hermesLocalSmoke.runSmoke', 'Run local smoke')}
            type="button"
          >
            <PlayCircle size={10} />
          </button>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}>
            {running ? t('fleet.hermesLocalSmoke.runningChip', 'running') : statusText}
          </span>
        </div>
      </div>

      {result ? (
        <div
          className={`mt-1.5 rounded border px-2 py-1 text-[10px] ${
            result.ok
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-warning/30 bg-warning/10 text-warning'
          }`}
          data-testid="hermes-local-smoke-result"
        >
          {t(
            result.ok
              ? 'fleet.hermesLocalSmoke.smokePassed'
              : 'fleet.hermesLocalSmoke.smokeFailed',
            result.ok
              ? 'local smoke passed: runtime {{runtime}}, browser {{browser}}, protocols {{protocols}}'
              : 'local smoke failed: runtime {{runtime}}, browser {{browser}}, protocols {{protocols}}',
            {
              browser: result.results.browser.status,
              protocols: result.results.protocols.ok ? 'passed' : 'failed',
              runtime: result.results.runtime.status,
            }
          )}
        </div>
      ) : null}

      {result ? (
        <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-text-secondary">
          <SmokeMetric
            icon={<Server size={10} />}
            label={t('fleet.hermesLocalSmoke.runtimeLabel', 'Runtime')}
            value={result.results.runtime.status}
            tone={result.results.runtime.ok ? 'success' : 'warning'}
          />
          <SmokeMetric
            icon={<Globe2 size={10} />}
            label={t('fleet.hermesLocalSmoke.browserLabel', 'Browser')}
            value={result.results.browser.status}
            tone={result.results.browser.ok ? 'success' : 'warning'}
          />
          <SmokeMetric
            icon={<Network size={10} />}
            label={t('fleet.hermesLocalSmoke.protocolsLabel', 'Protocols')}
            value={t('fleet.hermesLocalSmoke.protocolsValue', 'MCP {{mcp}} / HTTP {{routes}}', {
              mcp: result.results.protocols.mcpStdio.ok ? 'ok' : 'fail',
              routes: result.results.protocols.httpRoutes.routes.length,
            })}
            tone={result.results.protocols.ok ? 'success' : 'warning'}
          />
        </div>
      ) : error ? (
        <div
          className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning"
          data-testid="hermes-local-smoke-error"
        >
          <AlertTriangle size={10} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{error}</span>
        </div>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <CheckCircle2 size={10} className="shrink-0 text-text-muted" />
          <span className="truncate">
            {t('fleet.hermesLocalSmoke.readyHint', 'Ready for local runtime, browser, and protocol proof.')}
          </span>
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{result?.commands.suite ?? 'buddy hermes smoke --json'}</code>
      </div>
    </section>
  );
};

const SmokeMetric: React.FC<{
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

function getHermesLocalSmokeApi(): HermesLocalSmokeApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesLocalSmoke?: HermesLocalSmokeApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesLocalSmoke;
}
