/**
 * MCP Approval Elicitation
 *
 * Implements structured approval elicitation payloads and transport for Code Buddy
 * when operating as an MCP (Model Context Protocol) server.
 *
 * Conforms to the MCP `elicitation/create` protocol specification with form-mode
 * schema validation, unified diff generation, size bounding, and fail-closed security.
 */

import * as path from 'node:path';
import type { ConfirmationOptions, ConfirmationOperationType, ConfirmationResult } from '../../utils/confirmation-service.js';
import {
  generateCreationDiff,
  generateDeletionDiff,
  generateDiffFromStrings,
} from '../../utils/diff-generator.js';

export const MAX_DIFF_BYTES = 50 * 1024; // 50 KB default bound
export const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000; // 60 seconds default timeout

export interface FilePatchInput {
  path: string;
  before?: string | null;
  after?: string | null;
}

export interface BuildPatchApprovalOptions {
  files: FilePatchInput[];
  cwd?: string;
  reason?: string;
  maxDiffBytes?: number;
  threadId?: string;
  callId?: string;
  toolCallId?: string;
  eventId?: string;
  [key: string]: unknown;
}

export interface PatchApprovalFileSummary {
  path: string;
  diff: string;
  isNew?: boolean;
  isDeleted?: boolean;
}

export interface PatchApprovalElicitRequest {
  method: 'elicitation/create';
  params: {
    mode: 'form';
    message: string;
    requestedSchema: {
      type: 'object';
      properties: {
        decision: {
          type: 'string';
          enum: ['accept', 'decline'];
          description: string;
        };
      };
      required: string[];
    };
    threadId?: string;
    callId?: string;
    toolCallId?: string;
    eventId?: string;
    approvalKind: 'patch-approval';
    elicitationType: 'patch-approval';
    codex_elicitation: 'patch-approval';
    codex_call_id?: string;
    codex_mcp_tool_call_id?: string;
    codex_event_id?: string;
    codex_reason?: string;
    files: PatchApprovalFileSummary[];
    diff: string;
    [key: string]: unknown;
  };
}

export interface BuildExecApprovalOptions {
  command: string | string[];
  cwd: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  reason?: string;
  threadId?: string;
  callId?: string;
  toolCallId?: string;
  eventId?: string;
  parsedCommand?: unknown;
  [key: string]: unknown;
}

export interface ExecApprovalElicitRequest {
  method: 'elicitation/create';
  params: {
    mode: 'form';
    message: string;
    requestedSchema: {
      type: 'object';
      properties: {
        decision: {
          type: 'string';
          enum: ['accept', 'decline'];
          description: string;
        };
      };
      required: string[];
    };
    threadId?: string;
    callId?: string;
    toolCallId?: string;
    eventId?: string;
    approvalKind: 'exec-approval';
    elicitationType: 'exec-approval';
    codex_elicitation: 'exec-approval';
    codex_call_id?: string;
    codex_mcp_tool_call_id?: string;
    codex_event_id?: string;
    codex_command?: string[];
    command: string | string[];
    cwd: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    reason?: string;
    [key: string]: unknown;
  };
}

/**
 * Normalizes a file path to be relative to the workspace cwd.
 */
function normalizeRelativePath(filePath: string, cwd?: string): string {
  if (!cwd || !path.isAbsolute(filePath)) {
    return filePath.replace(/\\/g, '/');
  }
  const rel = path.relative(cwd, filePath);
  return (rel || path.basename(filePath)).replace(/\\/g, '/');
}

/**
 * Bounds text content to a maximum byte limit with a visible truncation marker.
 */
function boundText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  const marker = '\n... [diff truncated]';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const availableBytes = Math.max(0, maxBytes - markerBytes);

  let truncated = text;
  while (Buffer.byteLength(truncated, 'utf8') > availableBytes && truncated.length > 0) {
    // Truncate roughly by lines or slice
    const lastNewline = truncated.lastIndexOf('\n');
    if (lastNewline > 0 && lastNewline >= truncated.length * 0.7) {
      truncated = truncated.slice(0, lastNewline);
    } else {
      truncated = truncated.slice(0, Math.floor(truncated.length * 0.9));
    }
  }

  return truncated + marker;
}

/**
 * Build a structured patch approval elicitation request conforming to MCP `elicitation/create`.
 */
export function buildPatchApprovalRequest(options: BuildPatchApprovalOptions): PatchApprovalElicitRequest {
  const maxBytes = options.maxDiffBytes ?? MAX_DIFF_BYTES;
  const cwd = options.cwd;
  const fileSummaries: PatchApprovalFileSummary[] = [];

  for (const file of options.files) {
    const relPath = normalizeRelativePath(file.path, cwd);
    let diff: string;
    let isNew = false;
    let isDeleted = false;

    if (file.before === null || file.before === undefined) {
      isNew = true;
      diff = generateCreationDiff(file.after ?? '', relPath);
    } else if (file.after === null || file.after === undefined) {
      isDeleted = true;
      diff = generateDeletionDiff(file.before ?? '', relPath);
    } else {
      diff = generateDiffFromStrings(file.before, file.after, relPath);
    }

    fileSummaries.push({
      path: relPath,
      diff,
      ...(isNew ? { isNew: true } : {}),
      ...(isDeleted ? { isDeleted: true } : {}),
    });
  }

  const rawCombinedDiff = fileSummaries.map((f) => f.diff).join('\n\n');
  const boundedDiff = boundText(rawCombinedDiff, maxBytes);

  const messageLines: string[] = [];
  if (options.reason) {
    messageLines.push(options.reason);
  }
  const fileCount = fileSummaries.length;
  const fileList = fileSummaries.map((f) => f.path).join(', ');
  messageLines.push(
    `Allow Code Buddy to apply proposed changes to ${fileCount} file${fileCount > 1 ? 's' : ''} (${fileList})?`,
  );
  if (boundedDiff) {
    messageLines.push('\nDiff preview:\n' + boundedDiff);
  }

  return {
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: messageLines.join('\n'),
      requestedSchema: {
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            enum: ['accept', 'decline'],
            description: 'Approve or decline the proposed code changes',
          },
        },
        required: ['decision'],
      },
      threadId: options.threadId,
      callId: options.callId,
      toolCallId: options.toolCallId,
      eventId: options.eventId,
      approvalKind: 'patch-approval',
      elicitationType: 'patch-approval',
      codex_elicitation: 'patch-approval',
      codex_call_id: options.callId,
      codex_mcp_tool_call_id: options.toolCallId,
      codex_event_id: options.eventId,
      codex_reason: options.reason,
      files: fileSummaries,
      diff: boundedDiff,
    },
  };
}

/**
 * Build a structured execution approval elicitation request conforming to MCP `elicitation/create`.
 */
export function buildExecApprovalRequest(options: BuildExecApprovalOptions): ExecApprovalElicitRequest {
  const commandArray = Array.isArray(options.command) ? options.command : [options.command];
  const commandString = Array.isArray(options.command) ? options.command.join(' ') : options.command;
  const riskLevel = options.riskLevel ?? 'medium';

  const messageLines: string[] = [];
  if (options.reason) {
    messageLines.push(options.reason);
  }
  messageLines.push(
    `Allow Code Buddy to run \`${commandString}\` in \`${options.cwd}\`? (Risk: ${riskLevel})`,
  );

  return {
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: messageLines.join('\n'),
      requestedSchema: {
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            enum: ['accept', 'decline'],
            description: 'Approve or decline the command execution',
          },
        },
        required: ['decision'],
      },
      threadId: options.threadId,
      callId: options.callId,
      toolCallId: options.toolCallId,
      eventId: options.eventId,
      approvalKind: 'exec-approval',
      elicitationType: 'exec-approval',
      codex_elicitation: 'exec-approval',
      codex_call_id: options.callId,
      codex_mcp_tool_call_id: options.toolCallId,
      codex_event_id: options.eventId,
      codex_command: commandArray,
      command: options.command,
      cwd: options.cwd,
      riskLevel,
      reason: options.reason,
    },
  };
}

/**
 * Parse decision from an MCP elicitation response.
 * Follows fail-closed semantics: any malformed, declined, cancelled, or unrecognized result is rejected.
 */
export function parseElicitationDecision(result: unknown): { approved: boolean; reason?: string } {
  if (!result || typeof result !== 'object') {
    return { approved: false, reason: 'Invalid elicitation response' };
  }

  const record = result as Record<string, unknown>;

  // Standard MCP ElicitResult { action: "accept" | "decline" | "cancel", content?: ... }
  if (typeof record.action === 'string') {
    if (record.action === 'accept') {
      return { approved: true };
    }
    if (record.action === 'decline') {
      return { approved: false, reason: 'Declined by client' };
    }
    if (record.action === 'cancel') {
      return { approved: false, reason: 'Cancelled by client' };
    }
  }

  // Codex-style { decision: "approved" | "denied" } or { decision: { type: "approved" } }
  if (record.decision !== undefined) {
    if (typeof record.decision === 'string') {
      if (['approved', 'accept', 'allow'].includes(record.decision.toLowerCase())) {
        return { approved: true };
      }
      return {
        approved: false,
        reason: (typeof record.reason === 'string' ? record.reason : undefined) || 'Denied by client',
      };
    }
    if (typeof record.decision === 'object' && record.decision !== null) {
      const decObj = record.decision as Record<string, unknown>;
      if (typeof decObj.type === 'string' && ['approved', 'accept', 'allow'].includes(decObj.type.toLowerCase())) {
        return { approved: true };
      }
      return {
        approved: false,
        reason: (typeof decObj.reason === 'string' ? decObj.reason : undefined) || 'Denied by client',
      };
    }
  }

  // ConfirmationResult { confirmed: boolean, feedback?: string }
  if (typeof record.confirmed === 'boolean') {
    if (record.confirmed) {
      return { approved: true };
    }
    return {
      approved: false,
      reason: (typeof record.feedback === 'string' ? record.feedback : undefined) || 'Denied by client',
    };
  }

  // Content record inside result
  if (typeof record.content === 'object' && record.content !== null) {
    const content = record.content as Record<string, unknown>;
    if (typeof content.decision === 'string') {
      if (['accept', 'approved', 'allow'].includes(content.decision.toLowerCase())) {
        return { approved: true };
      }
      return {
        approved: false,
        reason: (typeof content.reason === 'string' ? content.reason : undefined) || 'Declined by client',
      };
    }
    if (typeof content.confirmed === 'boolean') {
      return {
        approved: content.confirmed,
        reason: content.confirmed ? undefined : (typeof content.feedback === 'string' ? content.feedback : 'Denied by client'),
      };
    }
  }

  return { approved: false, reason: 'Unknown decision format' };
}

/**
 * Transports an elicitation approval request to an MCP client and waits for the response
 * within a strict timeout (default: 60s). Fails closed on timeout or unsupported client.
 */
export async function sendElicitationApprovalRequest(
  serverInstance: unknown,
  request: PatchApprovalElicitRequest | ExecApprovalElicitRequest | Record<string, unknown>,
  timeoutMs: number = DEFAULT_APPROVAL_TIMEOUT_MS,
): Promise<{ confirmed: boolean; feedback?: string }> {
  const anyServer = serverInstance as Record<string, unknown> | null | undefined;
  const underlyingServer = (anyServer?.server ?? anyServer) as {
    getClientCapabilities?: () => { elicitation?: { form?: unknown } };
    elicitInput?: (params: unknown, options?: unknown) => Promise<unknown>;
    request?: (req: unknown, schema?: unknown, options?: unknown) => Promise<unknown>;
    sendRequest?: (req: unknown) => Promise<unknown>;
  } | undefined;

  if (!underlyingServer) {
    return {
      confirmed: false,
      feedback: 'Approval elicitation failed: MCP server instance is unavailable',
    };
  }

  // Check client capabilities: must support elicitation
  if (typeof underlyingServer.getClientCapabilities === 'function') {
    const caps = underlyingServer.getClientCapabilities();
    const supportsElicitation = Boolean(caps?.elicitation?.form || caps?.elicitation);
    if (!supportsElicitation) {
      return {
        confirmed: false,
        feedback: 'Approval denied: Client does not support elicitation (fail-closed)',
      };
    }
  }

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<{ confirmed: boolean; feedback?: string }>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        confirmed: false,
        feedback: `Approval request timed out after ${Math.round(timeoutMs / 1000)}s (fail-closed)`,
      });
    }, timeoutMs);
  });

  const responsePromise = (async (): Promise<{ confirmed: boolean; feedback?: string }> => {
    try {
      let rawResult: unknown;
      const params = (request as { params?: unknown }).params ?? request;

      if (typeof underlyingServer.elicitInput === 'function') {
        rawResult = await underlyingServer.elicitInput(params);
      } else if (typeof underlyingServer.request === 'function') {
        rawResult = await underlyingServer.request({
          method: 'elicitation/create',
          params,
        });
      } else if (typeof underlyingServer.sendRequest === 'function') {
        rawResult = await underlyingServer.sendRequest({
          method: 'elicitation/create',
          params,
        });
      } else {
        return {
          confirmed: false,
          feedback: 'Approval elicitation failed: server does not provide an elicitation transport',
        };
      }

      const parsed = parseElicitationDecision(rawResult);
      return {
        confirmed: parsed.approved,
        feedback: parsed.reason,
      };
    } catch (error) {
      return {
        confirmed: false,
        feedback: `Approval elicitation request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  })();

  try {
    const outcome = await Promise.race([responsePromise, timeoutPromise]);
    return outcome;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Creates an interactive bridge function for ConfirmationService routing requests
 * to an MCP client over structured elicitation.
 */
export function createMcpApprovalBridge(
  serverInstance: unknown,
  bridgeOptions: { timeoutMs?: number; cwd?: string } = {},
): (options: ConfirmationOptions, operationType?: ConfirmationOperationType) => Promise<ConfirmationResult> {
  const timeoutMs = bridgeOptions.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  const cwd = bridgeOptions.cwd ?? process.cwd();

  return async (
    options: ConfirmationOptions,
    operationType: ConfirmationOperationType = 'file',
  ): Promise<ConfirmationResult> => {
    let request: PatchApprovalElicitRequest | ExecApprovalElicitRequest;

    if (operationType === 'bash') {
      const command = options.filename;
      const execCwd = (options.detail?.cwd as string) ?? cwd;
      request = buildExecApprovalRequest({
        command,
        cwd: execCwd,
        riskLevel: options.riskLevel,
        reason: options.operation,
      });
    } else {
      // file or generic tool
      const filePath = options.filename;
      let diffContent = options.diffPreview;

      if (!diffContent && options.content) {
        diffContent = options.content;
      }

      request = buildPatchApprovalRequest({
        files: [
          {
            path: filePath,
            before: options.diffPreview ? undefined : '',
            after: options.diffPreview ? undefined : options.content,
          },
        ],
        cwd,
        reason: options.operation,
      });

      // If diffPreview was already given, set diff and message accurately
      if (options.diffPreview) {
        request.params.diff = boundText(options.diffPreview, MAX_DIFF_BYTES);
        request.params.files = [
          {
            path: normalizeRelativePath(filePath, cwd),
            diff: request.params.diff,
          },
        ];
      }
    }

    const result = await sendElicitationApprovalRequest(serverInstance, request, timeoutMs);
    return {
      confirmed: result.confirmed,
      feedback: result.feedback,
    };
  };
}
