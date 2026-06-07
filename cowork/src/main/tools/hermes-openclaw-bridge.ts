import { loadCoreModule } from '../utils/core-loader';

export type OpenClawBridgeChannel = 'slack' | 'discord' | 'web' | 'cli' | 'api' | string;

export interface OpenClawBridgeStatusOptions {
  cwd?: string;
  source?: string;
}

export interface OpenClawBridgeAttachOptions extends OpenClawBridgeStatusOptions {
  approvedBy?: string;
  endpointPath?: string;
}

export interface OpenClawBridgeHandoffOptions {
  channel: OpenClawBridgeChannel;
  cwd?: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  text: string;
  threadId?: string;
}

export interface OpenClawBridgeSendOptions extends OpenClawBridgeStatusOptions {
  approvedBy?: string;
  channel: OpenClawBridgeChannel;
  endpointPath?: string;
  messageId: string;
  text: string;
  threadId?: string;
}

export interface OpenClawBridgeNodePairingOptions extends OpenClawBridgeStatusOptions {
  approvedBy?: string;
  code?: string;
  nodeId?: string;
}

export interface OpenClawBridgeStatusResult {
  descriptor?: Record<string, unknown>;
  discovery?: Record<string, unknown>;
  error?: string;
  ok: boolean;
}

export interface OpenClawBridgeActionResult {
  error?: string;
  ok: boolean;
  result?: Record<string, unknown>;
}

interface OpenClawGatewayBridgeModule {
  approveOpenClawPendingNode: (
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  attachOpenClawGateway: (
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  buildOpenClawNodeDescriptor: (
    discovery: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Record<string, unknown>;
  discoverOpenClawGateway: (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  listOpenClawPendingNodes: (
    input?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  prepareOpenClawFleetHandoffDraft: (
    message: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  rejectOpenClawPendingNode: (
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  sendOpenClawResponse: (
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadBridge(): Promise<OpenClawGatewayBridgeModule | null> {
  return loadCoreModule<OpenClawGatewayBridgeModule>('openclaw/gateway-bridge.js');
}

function coreOptions(options: OpenClawBridgeStatusOptions): Record<string, unknown> {
  return {
    cwd: options.cwd,
    home: options.source,
  };
}

function requireApprover(approvedBy: string | undefined): string | null {
  const trimmed = approvedBy?.trim();
  return trimmed ? trimmed : null;
}

export async function getOpenClawBridgeStatusForReview(
  options: OpenClawBridgeStatusOptions = {},
): Promise<OpenClawBridgeStatusResult> {
  const mod = await loadBridge();
  if (!mod?.discoverOpenClawGateway || !mod.buildOpenClawNodeDescriptor) {
    return { ok: false, error: 'Core OpenClaw gateway bridge module is unavailable.' };
  }

  try {
    const discovery = await mod.discoverOpenClawGateway(coreOptions(options));
    const descriptor = mod.buildOpenClawNodeDescriptor(discovery, { cwd: options.cwd });
    return { ok: true, discovery, descriptor };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function previewOpenClawBridgeAttachForReview(
  options: OpenClawBridgeAttachOptions = {},
): Promise<OpenClawBridgeActionResult> {
  const mod = await loadBridge();
  if (!mod?.attachOpenClawGateway) {
    return { ok: false, error: 'Core OpenClaw gateway bridge module is unavailable.' };
  }

  try {
    const result = await mod.attachOpenClawGateway(
      { dryRun: true, endpointPath: options.endpointPath },
      coreOptions(options),
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function attachOpenClawBridgeForReview(
  options: OpenClawBridgeAttachOptions,
): Promise<OpenClawBridgeActionResult> {
  const approvedBy = requireApprover(options.approvedBy);
  if (!approvedBy) return { ok: false, error: 'approvedBy is required' };

  const mod = await loadBridge();
  if (!mod?.attachOpenClawGateway) {
    return { ok: false, error: 'Core OpenClaw gateway bridge module is unavailable.' };
  }

  try {
    const result = await mod.attachOpenClawGateway(
      {
        approvedBy,
        dryRun: false,
        endpointPath: options.endpointPath,
        liveAttachConfirmed: true,
      },
      coreOptions(options),
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function listOpenClawBridgePendingNodesForReview(
  options: OpenClawBridgeNodePairingOptions = {},
): Promise<OpenClawBridgeActionResult> {
  const mod = await loadBridge();
  if (!mod?.listOpenClawPendingNodes) {
    return { ok: false, error: 'Core OpenClaw node pairing bridge module is unavailable.' };
  }

  try {
    const approvedBy = requireApprover(options.approvedBy);
    const result = await mod.listOpenClawPendingNodes(
      {
        ...(approvedBy ? { approvedBy, dryRun: false, liveCallConfirmed: true } : { dryRun: true }),
      },
      coreOptions(options),
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function approveOpenClawBridgePendingNodeForReview(
  options: OpenClawBridgeNodePairingOptions,
): Promise<OpenClawBridgeActionResult> {
  const approvedBy = requireApprover(options.approvedBy);
  if (!approvedBy) return { ok: false, error: 'approvedBy is required' };
  if (!options.nodeId?.trim() && !options.code?.trim()) {
    return { ok: false, error: 'nodeId or code is required' };
  }

  const mod = await loadBridge();
  if (!mod?.approveOpenClawPendingNode) {
    return { ok: false, error: 'Core OpenClaw node pairing bridge module is unavailable.' };
  }

  try {
    const result = await mod.approveOpenClawPendingNode(
      {
        approvedBy,
        code: options.code,
        dryRun: false,
        liveCallConfirmed: true,
        nodeId: options.nodeId,
      },
      coreOptions(options),
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function rejectOpenClawBridgePendingNodeForReview(
  options: OpenClawBridgeNodePairingOptions & { reason?: string },
): Promise<OpenClawBridgeActionResult> {
  const approvedBy = requireApprover(options.approvedBy);
  if (!approvedBy) return { ok: false, error: 'approvedBy is required' };
  if (!options.nodeId?.trim() && !options.code?.trim()) {
    return { ok: false, error: 'nodeId or code is required' };
  }

  const mod = await loadBridge();
  if (!mod?.rejectOpenClawPendingNode) {
    return { ok: false, error: 'Core OpenClaw node pairing bridge module is unavailable.' };
  }

  try {
    const result = await mod.rejectOpenClawPendingNode(
      {
        approvedBy,
        code: options.code,
        dryRun: false,
        liveCallConfirmed: true,
        nodeId: options.nodeId,
        reason: options.reason,
      },
      coreOptions(options),
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function draftOpenClawBridgeHandoffForReview(
  options: OpenClawBridgeHandoffOptions,
): Promise<OpenClawBridgeActionResult> {
  if (!options.messageId?.trim()) return { ok: false, error: 'messageId is required' };
  if (!options.channel?.trim()) return { ok: false, error: 'channel is required' };
  if (!options.senderId?.trim()) return { ok: false, error: 'senderId is required' };
  if (!options.text?.trim()) return { ok: false, error: 'text is required' };

  const mod = await loadBridge();
  if (!mod?.prepareOpenClawFleetHandoffDraft) {
    return { ok: false, error: 'Core OpenClaw gateway bridge module is unavailable.' };
  }

  try {
    const result = await mod.prepareOpenClawFleetHandoffDraft(
      {
        channel: options.channel,
        messageId: options.messageId,
        senderId: options.senderId,
        senderName: options.senderName,
        text: options.text,
        threadId: options.threadId,
      },
      { cwd: options.cwd },
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function previewOpenClawBridgeSendForReview(
  options: OpenClawBridgeSendOptions,
): Promise<OpenClawBridgeActionResult> {
  if (!options.messageId?.trim()) return { ok: false, error: 'messageId is required' };
  if (!options.channel?.trim()) return { ok: false, error: 'channel is required' };
  if (!options.text?.trim()) return { ok: false, error: 'text is required' };

  const mod = await loadBridge();
  if (!mod?.sendOpenClawResponse) {
    return { ok: false, error: 'Core OpenClaw gateway bridge module is unavailable.' };
  }

  try {
    const result = await mod.sendOpenClawResponse(
      {
        channel: options.channel,
        dryRun: true,
        endpointPath: options.endpointPath,
        messageId: options.messageId,
        text: options.text,
        threadId: options.threadId,
      },
      coreOptions(options),
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function sendOpenClawBridgeResponseForReview(
  options: OpenClawBridgeSendOptions,
): Promise<OpenClawBridgeActionResult> {
  if (!options.messageId?.trim()) return { ok: false, error: 'messageId is required' };
  if (!options.channel?.trim()) return { ok: false, error: 'channel is required' };
  if (!options.text?.trim()) return { ok: false, error: 'text is required' };
  const approvedBy = requireApprover(options.approvedBy);
  if (!approvedBy) return { ok: false, error: 'approvedBy is required' };

  const mod = await loadBridge();
  if (!mod?.sendOpenClawResponse) {
    return { ok: false, error: 'Core OpenClaw gateway bridge module is unavailable.' };
  }

  try {
    const result = await mod.sendOpenClawResponse(
      {
        approvedBy,
        channel: options.channel,
        dryRun: false,
        endpointPath: options.endpointPath,
        liveSendConfirmed: true,
        messageId: options.messageId,
        text: options.text,
        threadId: options.threadId,
      },
      coreOptions(options),
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
