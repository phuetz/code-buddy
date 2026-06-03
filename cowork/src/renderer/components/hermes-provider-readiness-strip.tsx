import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  KeyRound,
  Settings,
  Terminal,
  WandSparkles,
} from 'lucide-react';

export interface HermesProviderReadinessReview {
  command: string;
  ok: boolean;
  activeModel: {
    contextWindow: number | null;
    maxOutputTokens: number | null;
    model: string;
    provider: string;
    source: string;
    supportsReasoning: boolean;
    supportsToolCalls: boolean;
    supportsVision: boolean;
  };
  activeProvider: {
    baseUrl: string | null;
    configured: boolean;
    credentialSources: string[];
    label: string;
    local: boolean;
    setupCommands: string[];
  };
  configuredProviderCount: number;
  issues: string[];
  portal: {
    credentialPresent: boolean;
    credentialSources: string[];
    directFallbackCount: number;
    managedByNousCount: number;
    toolGatewayConfigured: boolean;
  };
  providerCount: number;
  recommendations: string[];
}

interface HermesProviderReadinessApi {
  get?: () => Promise<HermesProviderReadinessReview | null>;
}

export const HermesProviderReadinessStrip: React.FC<{
  error?: string | null;
  onOpenSettings?: () => void;
  readiness?: HermesProviderReadinessReview | null;
}> = ({ error = null, onOpenSettings, readiness }) => {
  const { t } = useTranslation();
  const [loadedReadiness, setLoadedReadiness] = useState<HermesProviderReadinessReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const visibleReadiness = readiness ?? loadedReadiness;
  const visibleError = error ?? loadError;
  const firstSetupCommand = visibleReadiness?.activeProvider.setupCommands?.[0] ?? null;
  const command = useMemo(
    () => visibleReadiness?.command ?? 'buddy hermes providers status --json',
    [visibleReadiness?.command]
  );
  const statusClass = visibleReadiness?.ok
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';
  const statusText = visibleReadiness?.ok
    ? t('fleet.hermesProviderReadiness.readyChip', 'ready')
    : t('fleet.hermesProviderReadiness.attentionChip', 'attention');

  useEffect(() => {
    if (readiness !== undefined) return;
    const api = getHermesProviderReadinessApi();
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

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-provider-readiness"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Cpu size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesProviderReadiness.title', 'Hermes provider readiness')}
          </span>
        </div>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}
        >
          {visibleReadiness
            ? statusText
            : t('fleet.hermesProviderReadiness.loadingChip', 'provider')}
        </span>
      </div>

      {visibleReadiness ? (
        <>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[10px] text-text-secondary">
            <ReadinessMetric
              icon={<Cpu size={10} />}
              label={t('fleet.hermesProviderReadiness.modelLabel', 'Model')}
              value={visibleReadiness.activeModel.model}
            />
            <ReadinessMetric
              icon={<KeyRound size={10} />}
              label={t('fleet.hermesProviderReadiness.providerLabel', 'Provider')}
              value={visibleReadiness.activeProvider.label}
            />
            <ReadinessMetric
              icon={<CheckCircle2 size={10} />}
              label={t('fleet.hermesProviderReadiness.credentialsLabel', 'Credentials')}
              value={
                visibleReadiness.activeProvider.configured
                  ? t('fleet.hermesProviderReadiness.credentialsConfigured', 'configured')
                  : t('fleet.hermesProviderReadiness.credentialsMissing', 'missing')
              }
              tone={visibleReadiness.activeProvider.configured ? 'success' : 'warning'}
            />
            <ReadinessMetric
              icon={<WandSparkles size={10} />}
              label={t('fleet.hermesProviderReadiness.nousLabel', 'Nous gateway')}
              value={
                visibleReadiness.portal.toolGatewayConfigured
                  ? t('fleet.hermesProviderReadiness.nousConfigured', '{{count}} managed', {
                      count: visibleReadiness.portal.managedByNousCount,
                    })
                  : t('fleet.hermesProviderReadiness.nousFallback', '{{count}} direct', {
                      count: visibleReadiness.portal.directFallbackCount,
                    })
              }
              tone={visibleReadiness.portal.toolGatewayConfigured ? 'success' : 'warning'}
            />
          </div>

          <div className="mt-1.5 flex flex-wrap gap-1">
            <CapabilityChip
              enabled={visibleReadiness.activeModel.supportsToolCalls}
              label={t('fleet.hermesProviderReadiness.toolCallsChip', 'tool-calls')}
            />
            <CapabilityChip
              enabled={visibleReadiness.activeModel.supportsReasoning}
              label={t('fleet.hermesProviderReadiness.reasoningChip', 'reasoning')}
            />
            <CapabilityChip
              enabled={visibleReadiness.activeModel.supportsVision}
              label={t('fleet.hermesProviderReadiness.visionChip', 'vision')}
            />
            <span className="rounded bg-surface px-1 py-0.5 text-[9px] text-text-muted">
              {t('fleet.hermesProviderReadiness.providersChip', '{{configured}}/{{total}} providers', {
                configured: visibleReadiness.configuredProviderCount,
                total: visibleReadiness.providerCount,
              })}
            </span>
          </div>

          <div className="mt-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
            {t('fleet.hermesProviderReadiness.contextLine', 'Context/output: {{context}} / {{output}} tokens', {
              context: visibleReadiness.activeModel.contextWindow ?? 'unknown',
              output: visibleReadiness.activeModel.maxOutputTokens ?? 'unknown',
            })}
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

          {firstSetupCommand ? (
            <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
              <Terminal size={10} className="shrink-0 text-text-muted" />
              <span className="shrink-0">
                {t('fleet.hermesProviderReadiness.setupCommandLabel', 'Setup')}
              </span>
              <code className="truncate">{firstSetupCommand}</code>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <AlertTriangle size={10} className="shrink-0 text-warning" />
          <span className="truncate">
            {t('fleet.hermesProviderReadiness.unavailable', 'Hermes provider readiness is not loaded yet.')}
          </span>
        </div>
      )}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesProviderReadiness.loadFailed', 'Hermes provider readiness load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>

      {onOpenSettings ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-1.5 flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
        >
          <Settings size={10} />
          {t('fleet.hermesProviderReadiness.openSettings', 'Open API settings')}
        </button>
      ) : null}
    </section>
  );
};

const CapabilityChip: React.FC<{ enabled: boolean; label: string }> = ({ enabled, label }) => (
  <span
    className={`rounded px-1 py-0.5 text-[9px] ${
      enabled ? 'bg-accent/10 text-accent' : 'bg-warning/10 text-warning'
    }`}
  >
    {label}={enabled ? 'yes' : 'no'}
  </span>
);

const ReadinessMetric: React.FC<{
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

function getHermesProviderReadinessApi(): HermesProviderReadinessApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesProviderReadiness?: HermesProviderReadinessApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesProviderReadiness;
}
