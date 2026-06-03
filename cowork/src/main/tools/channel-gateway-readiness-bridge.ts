import { loadCoreModule } from '../utils/core-loader';

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
  operatorCommands: Array<{
    command: string;
    description: string;
    id: string;
    label: string;
  }>;
  recommendations: string[];
  runtime: {
    authenticatedCount: number;
    channels: ChannelGatewayRuntimeItem[];
    connectedCount: number;
    registeredCount: number;
  };
  schemaVersion: 1;
}

export interface ChannelStatusDTO {
  authenticated: boolean;
  connected: boolean;
  error?: string;
  lastActivity?: number;
  type: string;
}

export interface ChannelGatewayStatusPayload {
  error?: string;
  items: ChannelStatusDTO[];
  ok: boolean;
  report: ChannelGatewayStatusReport | null;
}

interface CoreChannelStatus {
  authenticated: boolean;
  connected: boolean;
  error?: string;
  info?: Record<string, unknown>;
  lastActivity?: Date | number;
  type: string;
}

interface ChannelManagerLike {
  getStatus(): Record<string, CoreChannelStatus>;
}

interface ChannelsModule {
  getChannelManager: () => ChannelManagerLike;
}

interface ChannelHandlersModule {
  buildChannelStatusReport: (
    allStatus: Record<string, CoreChannelStatus>,
    configPath?: string,
  ) => ChannelGatewayStatusReport & {
    runtime: {
      authenticatedCount: number;
      channels: Array<ChannelGatewayRuntimeItem & { info?: Record<string, unknown> }>;
      connectedCount: number;
      registeredCount: number;
    };
  };
}

function toDTO(status: ChannelGatewayRuntimeItem): ChannelStatusDTO {
  const lastActivity = status.lastActivity ? Date.parse(status.lastActivity) : Number.NaN;
  return {
    type: status.type,
    connected: status.connected,
    authenticated: status.authenticated,
    ...(Number.isFinite(lastActivity) ? { lastActivity } : {}),
    ...(status.error ? { error: status.error } : {}),
  };
}

function sanitizeReport(
  report: ReturnType<ChannelHandlersModule['buildChannelStatusReport']>,
): ChannelGatewayStatusReport {
  return {
    ...report,
    operatorCommands: (report.operatorCommands ?? []).map((command) => ({
      command: command.command,
      description: command.description,
      id: command.id,
      label: command.label,
    })),
    runtime: {
      ...report.runtime,
      channels: report.runtime.channels.map((channel) => ({
        type: channel.type,
        connected: channel.connected,
        authenticated: channel.authenticated,
        ...(channel.lastActivity ? { lastActivity: channel.lastActivity } : {}),
        ...(channel.error ? { error: channel.error } : {}),
      })),
    },
  };
}

export async function getChannelGatewayStatusForReview(
  configPath?: string,
): Promise<ChannelGatewayStatusPayload> {
  const [channelsModule, handlersModule] = await Promise.all([
    loadCoreModule<ChannelsModule>('channels/core.js'),
    loadCoreModule<ChannelHandlersModule>('commands/handlers/channel-handlers.js'),
  ]);

  if (!channelsModule?.getChannelManager || !handlersModule?.buildChannelStatusReport) {
    return {
      error: 'core channel modules unavailable',
      items: [],
      ok: false,
      report: null,
    };
  }

  const status = channelsModule.getChannelManager().getStatus();
  const report = sanitizeReport(handlersModule.buildChannelStatusReport(status, configPath));

  return {
    items: report.runtime.channels.map(toDTO),
    ok: true,
    report,
  };
}
