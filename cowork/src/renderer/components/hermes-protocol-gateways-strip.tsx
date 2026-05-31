import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Network,
  PlayCircle,
  PlugZap,
  RadioTower,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

export type HermesProtocolGatewayStatus = 'available' | 'partial' | 'missing';

export interface HermesProtocolGatewayCapability {
  commands: string[];
  endpoints: string[];
  evidence: string[];
  id: string;
  label: string;
  notes: string[];
  officialSurface: string;
  status: HermesProtocolGatewayStatus;
}

export interface HermesProtocolGatewayReadiness {
  capabilities: HermesProtocolGatewayCapability[];
  generatedAt: string;
  kind: 'hermes_protocol_gateway_readiness';
  officialSurface: string;
  ok: boolean;
  recommendations: string[];
  schemaVersion: 1;
  smokeCommand: string;
  summary: {
    availableCount: number;
    missingCount: number;
    partialCount: number;
    total: number;
  };
}

export interface HermesProtocolGatewaySmokeResult {
  durationMs: number;
  generatedAt: string;
  httpRoutes: {
    a2aAgentName?: string;
    acpSessionCount?: number;
    baseUrl?: string;
    error?: string;
    ok: boolean;
    routes: Array<{
      ok: boolean;
      path: string;
      status: number;
    }>;
  };
  kind: 'hermes_protocol_gateway_smoke';
  mcpStdio: {
    echoText?: string;
    error?: string;
    ok: boolean;
    serverName: string;
    toolCount: number;
    transport?: string;
  };
  ok: boolean;
  schemaVersion: 1;
}

interface HermesProtocolGatewaysApi {
  get?: () => Promise<HermesProtocolGatewayReadiness | null>;
  smoke?: () => Promise<{
    error?: string;
    ok: boolean;
    result?: HermesProtocolGatewaySmokeResult;
  }>;
}

export const HermesProtocolGatewaysStrip: React.FC<{
  error?: string | null;
  readiness?: HermesProtocolGatewayReadiness | null;
}> = ({ error = null, readiness }) => {
  const { t } = useTranslation();
  const [loadedReadiness, setLoadedReadiness] = useState<HermesProtocolGatewayReadiness | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [smokeError, setSmokeError] = useState<string | null>(null);
  const [smokeResult, setSmokeResult] = useState<HermesProtocolGatewaySmokeResult | null>(null);
  const [smoking, setSmoking] = useState(false);
  const visibleReadiness = readiness ?? loadedReadiness;
  const visibleError = error ?? loadError;
  const command = useMemo(
    () => visibleReadiness?.smokeCommand ?? 'buddy hermes protocols-smoke local --json',
    [visibleReadiness?.smokeCommand]
  );
  const statusClass = visibleReadiness?.ok
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';
  const statusText = visibleReadiness?.ok
    ? t('fleet.hermesProtocolGateways.readyChip', 'protocols ready')
    : t('fleet.hermesProtocolGateways.attentionChip', 'protocols attention');

  useEffect(() => {
    if (readiness !== undefined) return;
    const api = getHermesProtocolGatewaysApi();
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

  const handleRunSmoke = async () => {
    const smoke = getHermesProtocolGatewaysApi()?.smoke;
    if (!smoke) {
      setSmokeError(t('fleet.hermesProtocolGateways.smokeUnavailable', 'Protocol smoke runner is unavailable.'));
      return;
    }

    setSmoking(true);
    setSmokeError(null);

    try {
      const response = await smoke();
      if (!response.ok || !response.result) {
        throw new Error(response.error ?? 'Protocol gateway smoke failed.');
      }
      setSmokeResult(response.result);
    } catch (smokeErrorValue) {
      setSmokeResult(null);
      setSmokeError(smokeErrorValue instanceof Error ? smokeErrorValue.message : String(smokeErrorValue));
    } finally {
      setSmoking(false);
    }
  };

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-protocol-gateways"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Network size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesProtocolGateways.title', 'Hermes protocol gateways')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label={t('fleet.hermesProtocolGateways.runSmoke', 'Run protocol smoke')}
            className="rounded border border-border-muted bg-background p-0.5 text-text-muted transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="hermes-protocol-gateways-smoke"
            disabled={smoking}
            onClick={() => void handleRunSmoke()}
            title={t('fleet.hermesProtocolGateways.runSmoke', 'Run protocol smoke')}
            type="button"
          >
            <PlayCircle size={10} />
          </button>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}>
            {visibleReadiness
              ? statusText
              : t('fleet.hermesProtocolGateways.loadingChip', 'protocols')}
          </span>
        </div>
      </div>

      {visibleReadiness ? (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-text-secondary">
            <ProtocolMetric
              icon={<CheckCircle2 size={10} />}
              label={t('fleet.hermesProtocolGateways.availableLabel', 'Available')}
              value={t('fleet.hermesProtocolGateways.availableValue', '{{count}}/{{total}}', {
                count: visibleReadiness.summary.availableCount,
                total: visibleReadiness.summary.total,
              })}
              tone={visibleReadiness.summary.missingCount === 0 ? 'success' : 'warning'}
            />
            <ProtocolMetric
              icon={<ShieldCheck size={10} />}
              label={t('fleet.hermesProtocolGateways.partialLabel', 'Partial')}
              value={String(visibleReadiness.summary.partialCount)}
              tone={visibleReadiness.summary.partialCount > 0 ? 'warning' : 'default'}
            />
            <ProtocolMetric
              icon={<RadioTower size={10} />}
              label={t('fleet.hermesProtocolGateways.routesLabel', 'Routes')}
              value={String(
                visibleReadiness.capabilities.reduce(
                  (count, capability) => count + capability.endpoints.length,
                  0
                )
              )}
            />
          </div>

          <div className="mt-1.5 grid gap-1">
            {visibleReadiness.capabilities.map((capability) => (
              <CapabilityRow key={capability.id} capability={capability} />
            ))}
          </div>

          {visibleReadiness.recommendations.slice(0, 2).map((recommendation) => (
            <div
              key={recommendation}
              className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning"
            >
              <AlertTriangle size={10} className="mt-0.5 shrink-0" />
              <span className="min-w-0">{recommendation}</span>
            </div>
          ))}
        </>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <AlertTriangle size={10} className="shrink-0 text-warning" />
          <span className="truncate">
            {t('fleet.hermesProtocolGateways.unavailable', 'Hermes protocol gateways are not loaded yet.')}
          </span>
        </div>
      )}

      {smokeResult || smokeError ? (
        <div
          className={`mt-1.5 rounded border px-2 py-1 text-[10px] ${
            smokeResult?.ok
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-warning/30 bg-warning/10 text-warning'
          }`}
          data-testid="hermes-protocol-gateways-smoke-result"
        >
          {smokeResult
            ? t(
              smokeResult.ok
                ? 'fleet.hermesProtocolGateways.smokePassed'
                : 'fleet.hermesProtocolGateways.smokeFailed',
              smokeResult.ok
                ? 'smoke passed: MCP {{mcp}}, HTTP {{routes}} routes'
                : 'smoke failed: MCP {{mcp}}, HTTP {{routes}} routes',
              {
                mcp: smokeResult.mcpStdio.echoText ?? smokeResult.mcpStdio.error ?? 'n/a',
                routes: smokeResult.httpRoutes.routes.length,
              }
            )
            : smokeError}
        </div>
      ) : null}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesProtocolGateways.loadFailed', 'Hermes protocol gateway load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>
    </section>
  );
};

const CapabilityRow: React.FC<{
  capability: HermesProtocolGatewayCapability;
}> = ({ capability }) => {
  const { t } = useTranslation();
  const tone =
    capability.status === 'available'
      ? 'text-success'
      : capability.status === 'partial'
        ? 'text-warning'
        : 'text-text-muted';
  const statusLabels: Record<HermesProtocolGatewayStatus, string> = {
    available: t('fleet.hermesProtocolGateways.status.available', 'available'),
    partial: t('fleet.hermesProtocolGateways.status.partial', 'partial'),
    missing: t('fleet.hermesProtocolGateways.status.missing', 'missing'),
  };
  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1 text-[10px]">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-text-secondary">{capability.label}</span>
        <span className={`shrink-0 rounded bg-background px-1 py-0.5 text-[9px] ${tone}`}>
          {statusLabels[capability.status]}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] text-text-muted">
        <PlugZap size={9} className="shrink-0" />
        <span className="shrink-0">{capability.id}</span>
        <span className="truncate">
          {capability.endpoints[0] ?? capability.commands[0] ?? capability.officialSurface}
        </span>
      </div>
    </div>
  );
};

const ProtocolMetric: React.FC<{
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

function getHermesProtocolGatewaysApi(): HermesProtocolGatewaysApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesProtocolGateways?: HermesProtocolGatewaysApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesProtocolGateways;
}
