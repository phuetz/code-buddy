import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquareMore,
  Radio,
  ShieldCheck,
  Terminal,
  Wifi,
} from 'lucide-react';

export interface ChannelGatewayConfigItem {
  allowedChannelsCount: number;
  allowedUsersCount: number;
  enabled: boolean;
  hasToken: boolean;
  hasWebhookUrl: boolean;
  optionKeys: string[];
  type: string;
}

export interface ChannelGatewayRuntimeItem {
  authenticated: boolean;
  connected: boolean;
  error?: string;
  lastActivity?: string;
  type: string;
}

export interface ChannelGatewayStatusReport {
  config: {
    channels: ChannelGatewayConfigItem[];
    configuredCount: number;
    disabledCount: number;
    enabledCount: number;
    path?: string;
  };
  generatedAt: string;
  kind: 'codebuddy_channel_status';
  recommendations: string[];
  runtime: {
    authenticatedCount: number;
    channels: ChannelGatewayRuntimeItem[];
    connectedCount: number;
    registeredCount: number;
  };
  schemaVersion: 1;
}

interface ChannelGatewayStatusPayload {
  error?: string;
  items: ChannelGatewayRuntimeItem[];
  ok: boolean;
  report: ChannelGatewayStatusReport | null;
}

interface ChannelsApi {
  status?: () => Promise<ChannelGatewayStatusPayload>;
}

export const HermesMessagingGatewayStrip: React.FC<{
  error?: string | null;
  status?: ChannelGatewayStatusReport | null;
}> = ({ error = null, status }) => {
  const { t } = useTranslation();
  const [loadedStatus, setLoadedStatus] = useState<ChannelGatewayStatusReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const visibleStatus = status ?? loadedStatus;
  const visibleError = error ?? loadError;
  const command = 'buddy hermes messaging status --json';
  const readiness = useMemo(() => getGatewayReadiness(visibleStatus), [visibleStatus]);
  const statusClass = readiness.ready
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';
  const readinessLabel = readiness.ready
    ? t('fleet.hermesMessagingGateway.readyChip', 'gateway ready')
    : t('fleet.hermesMessagingGateway.attentionChip', 'gateway attention');

  useEffect(() => {
    if (status !== undefined) return;
    const api = getChannelsApi();
    if (!api?.status) return;
    let cancelled = false;

    void api
      .status()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLoadedStatus(null);
          setLoadError(result.error ?? 'Channel status failed');
          return;
        }
        setLoadedStatus(result.report);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedStatus(null);
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-messaging-gateway"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <MessageSquareMore size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesMessagingGateway.title', 'Hermes messaging gateway')}
          </span>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}>
          {visibleStatus
            ? readinessLabel
            : t('fleet.hermesMessagingGateway.loadingChip', 'channels')}
        </span>
      </div>

      {visibleStatus ? (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-text-secondary">
            <GatewayMetric
              icon={<Radio size={10} />}
              label={t('fleet.hermesMessagingGateway.configuredLabel', 'Configured')}
              tone={visibleStatus.config.configuredCount > 0 ? 'success' : 'warning'}
              value={String(visibleStatus.config.configuredCount)}
            />
            <GatewayMetric
              icon={<Wifi size={10} />}
              label={t('fleet.hermesMessagingGateway.runtimeLabel', 'Runtime')}
              tone={visibleStatus.runtime.registeredCount > 0 ? 'success' : 'warning'}
              value={t('fleet.hermesMessagingGateway.runtimeValue', '{{connected}}/{{registered}}', {
                connected: visibleStatus.runtime.connectedCount,
                registered: visibleStatus.runtime.registeredCount,
              })}
            />
            <GatewayMetric
              icon={<ShieldCheck size={10} />}
              label={t('fleet.hermesMessagingGateway.authLabel', 'Auth')}
              value={String(visibleStatus.runtime.authenticatedCount)}
              tone={visibleStatus.runtime.authenticatedCount > 0 ? 'success' : 'default'}
            />
          </div>

          <div className="mt-1.5 grid gap-1">
            {buildChannelRows(visibleStatus).slice(0, 5).map((row) => (
              <GatewayChannelRow key={row.type} row={row} />
            ))}
          </div>

          {readiness.message ? (
            <div
              className={`mt-1.5 flex min-w-0 items-start gap-1.5 rounded border px-2 py-1 text-[10px] ${
                readiness.ready
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-warning/30 bg-warning/10 text-warning'
              }`}
            >
              {readiness.ready ? (
                <CheckCircle2 size={10} className="mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle size={10} className="mt-0.5 shrink-0" />
              )}
              <span className="min-w-0">{readiness.message}</span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <AlertTriangle size={10} className="shrink-0 text-warning" />
          <span className="truncate">
            {t('fleet.hermesMessagingGateway.unavailable', 'Hermes messaging gateway status is not loaded yet.')}
          </span>
        </div>
      )}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesMessagingGateway.loadFailed', 'Hermes messaging gateway load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>
    </section>
  );
};

interface ChannelRow {
  authenticated: boolean;
  configured: boolean;
  connected: boolean;
  enabled: boolean;
  error?: string;
  type: string;
}

const GatewayChannelRow: React.FC<{ row: ChannelRow }> = ({ row }) => {
  const { t } = useTranslation();
  const tone = row.connected
    ? 'text-success'
    : row.enabled
      ? 'text-warning'
      : 'text-text-muted';
  const state = row.connected
    ? t('fleet.hermesMessagingGateway.connectedState', 'connected')
    : row.enabled
      ? t('fleet.hermesMessagingGateway.pendingState', 'pending')
      : t('fleet.hermesMessagingGateway.disabledState', 'disabled');
  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1 text-[10px]">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-text-secondary">{row.type}</span>
        <span className={`rounded bg-background px-1 py-0.5 text-[9px] ${tone}`}>{state}</span>
      </div>
      <div className="mt-0.5 flex min-w-0 flex-wrap gap-1 text-[9px] text-text-muted">
        <span>{row.configured ? 'config=yes' : 'config=no'}</span>
        <span>{row.authenticated ? 'auth=yes' : 'auth=no'}</span>
        {row.error ? <span className="text-warning">{row.error}</span> : null}
      </div>
    </div>
  );
};

const GatewayMetric: React.FC<{
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

function buildChannelRows(status: ChannelGatewayStatusReport): ChannelRow[] {
  const rows = new Map<string, ChannelRow>();
  for (const channel of status.config.channels) {
    rows.set(channel.type, {
      authenticated: false,
      configured: true,
      connected: false,
      enabled: channel.enabled,
      type: channel.type,
    });
  }
  for (const channel of status.runtime.channels) {
    const current = rows.get(channel.type);
    rows.set(channel.type, {
      authenticated: channel.authenticated,
      configured: current?.configured ?? false,
      connected: channel.connected,
      enabled: current?.enabled ?? true,
      ...(channel.error ? { error: channel.error } : {}),
      type: channel.type,
    });
  }
  return Array.from(rows.values()).sort((left, right) => left.type.localeCompare(right.type));
}

function getGatewayReadiness(status: ChannelGatewayStatusReport | null): {
  message: string | null;
  ready: boolean;
} {
  if (!status) {
    return { message: null, ready: false };
  }
  const ready =
    status.config.configuredCount > 0 &&
    status.config.enabledCount > 0 &&
    status.recommendations.length === 0;
  const message =
    status.recommendations[0] ??
    (ready ? 'Channel gateway is configured and runtime status is clean.' : 'Configure at least one enabled channel.');
  return {
    message,
    ready,
  };
}

function getChannelsApi(): ChannelsApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        channels?: ChannelsApi;
      };
    }
  ).electronAPI?.channels;
}
