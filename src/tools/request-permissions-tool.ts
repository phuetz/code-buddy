/**
 * Dynamic Permission Requests Tool
 *
 * Allows the AI agent to request additional filesystem or network
 * permissions mid-session. The user approves/denies, and the grant
 * is scoped to either the current turn or the entire session.
 *
 * Inspired by OpenAI Codex CLI's request_permissions.rs
 */

import { BaseTool, ParameterDefinition } from './base-tool.js';
import { ToolResult } from '../types/index.js';
import { ConfirmationService } from '../utils/confirmation-service.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Permission Grant Store
// ============================================================================

export type PermissionScope = 'turn' | 'session';

export interface PermissionGrant {
  /** Type of permission */
  type: 'filesystem' | 'network' | 'execute';
  /** Path pattern or domain */
  target: string;
  /** Scope of the grant */
  scope: PermissionScope;
  /** When the grant was issued */
  grantedAt: Date;
  /** Turn number when granted (for turn-scoped grants) */
  turnNumber?: number;
}

/** Active grants for this session */
const states = new WeakMap<ConfirmationService, { grants: PermissionGrant[]; currentTurn: number }>();
function grantState() {
  const service = ConfirmationService.getInstance();
  let state = states.get(service);
  if (!state) { state = { grants: [], currentTurn: 0 }; states.set(service, state); }
  return state;
}

/**
 * Set the current turn number (called from agent executor).
 */
export function setCurrentTurn(turn: number): void {
  const state = grantState();
  state.currentTurn = turn;
  const { grants } = state;
  // Expire turn-scoped grants from previous turns
  for (let i = grants.length - 1; i >= 0; i--) {
    const g = grants[i];
    if (g === undefined) continue;
    if (g.scope === 'turn' && g.turnNumber !== undefined && g.turnNumber < turn) {
      grants.splice(i, 1);
    }
  }
}

/**
 * Check if a permission has been granted.
 */
export function hasPermission(type: PermissionGrant['type'], target: string): boolean {
  return grantState().grants.some(g => {
    if (g.type !== type) return false;
    // Simple glob match
    if (g.target === '*') return true;
    if (g.target === target) return true;
    if (g.target.endsWith('*') && target.startsWith(g.target.slice(0, -1))) return true;
    return false;
  });
}

/**
 * List all active grants.
 */
export function listGrants(): PermissionGrant[] {
  return [...grantState().grants];
}

/**
 * Clear all grants (for testing or session reset).
 */
export function clearGrants(): void {
  grantState().grants.length = 0;
}

// ============================================================================
// Tool Implementation
// ============================================================================

export class RequestPermissionsTool extends BaseTool {
  readonly name = 'request_permissions';
  readonly description = 'Request additional filesystem, network, or execution permissions from the user. Use when you need access beyond the current project directory.';

  private get confirmationService(): ConfirmationService { return ConfirmationService.getInstance(); }

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      type: {
        type: 'string',
        description: 'Permission type: "filesystem" (path access), "network" (domain access), "execute" (command execution)',
        enum: ['filesystem', 'network', 'execute'],
        required: true,
      },
      target: {
        type: 'string',
        description: 'Target path, domain, or command pattern. Use * for wildcard.',
        required: true,
      },
      reason: {
        type: 'string',
        description: 'Why this permission is needed.',
        required: true,
      },
      scope: {
        type: 'string',
        description: 'Grant scope: "turn" (current turn only) or "session" (entire session)',
        enum: ['turn', 'session'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const type = input.type as PermissionGrant['type'];
    const target = input.target as string;
    const reason = input.reason as string;
    const scope: PermissionScope = (input.scope as PermissionScope) ?? 'turn';

    if (!type || !target || !reason) {
      return this.error('type, target, and reason are required');
    }

    // Check if already granted
    if (hasPermission(type, target)) {
      return this.success(`Permission already granted: ${type} access to ${target}`);
    }

    // Request user confirmation
    const confirmResult = await this.confirmationService.requestConfirmation(
      {
        operation: 'Permission Request',
        filename: `${type}: ${target}`,
        showVSCodeOpen: false,
        content: [
          `The AI agent is requesting additional permissions:`,
          ``,
          `Type: ${type}`,
          `Target: ${target}`,
          `Scope: ${scope}`,
          `Reason: ${reason}`,
          ``,
          `Grant this permission?`,
        ].join('\n'),
      },
      'file',
    );

    if (!confirmResult.confirmed) {
      return this.error(`Permission denied: ${type} access to ${target}`);
    }

    // Store the grant
    const grant: PermissionGrant = {
      type,
      target,
      scope,
      grantedAt: new Date(),
      turnNumber: scope === 'turn' ? grantState().currentTurn : undefined,
    };
    grantState().grants.push(grant);

    logger.info(`Permission granted: ${type} access to ${target} (scope: ${scope})`);
    return this.success(`Permission granted: ${type} access to ${target} (scope: ${scope})`);
  }
}
