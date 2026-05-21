/**
 * Fleet Tool Adapters — Phase (d).17.
 *
 * ITool-compliant wrappers for `peer_delegate` and `list_peers`.
 * Both tools are explicitly NOT fleetSafe — they're outbound from the
 * caller; inbound peers run their own gating via the A2A executor.
 */

import type { ToolResult } from '../../types/index.js';
import type {
  ITool,
  ToolSchema,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
} from './types.js';
import { executePeerDelegate } from '../peer-delegate-tool.js';
import { executeListPeers } from '../list-peers-tool.js';
import { executeRoutePeer } from '../route-peer-tool.js';
import {
  FLEET_DISPATCH_PROFILES,
  FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT,
  isFleetDispatchProfile,
} from '../../fleet/dispatch-profile.js';

const DISPATCH_PROFILE_PARAMETER_DESCRIPTION =
  'Optional Fleet dispatch profile. When set, Code Buddy carries the operating posture ' +
  'through peer.chat and returns peer-side policy metadata when supported. Selection guide: ' +
  `${FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT}.`;

const ROUTE_DISPATCH_PROFILE_PARAMETER_DESCRIPTION =
  'Hermes-style operating posture for routing and later peer_delegate guidance. ' +
  `Selection guide: ${FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT}.`;

export class PeerDelegateTool implements ITool {
  readonly name = 'peer_delegate';
  readonly description =
    'Delegate a one-shot question or task to a connected fleet peer Code Buddy. ' +
    'The peer answers independently with its own model and returns its response. ' +
    'Use route_peer first when several peers are available; pass dispatchProfile to ' +
    'carry the selected posture and receive peer-side policy metadata. Peer IDs come ' +
    'from the --name flag used in /fleet listen.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return executePeerDelegate({
      peer: typeof input.peer === 'string' ? input.peer : '',
      prompt: typeof input.prompt === 'string' ? input.prompt : '',
      systemPrompt: typeof input.systemPrompt === 'string' ? input.systemPrompt : undefined,
      model: typeof input.model === 'string' ? input.model : undefined,
      dispatchProfile: typeof input.dispatchProfile === 'string' ? input.dispatchProfile : undefined,
      timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          peer: {
            type: 'string',
            description:
              'The peer ID (from /fleet listen --name). Use list_peers to discover available peer IDs.',
          },
          prompt: {
            type: 'string',
            description:
              'The question or task to ask the peer. Be specific and self-contained — the peer has no shared context with you.',
          },
          systemPrompt: {
            type: 'string',
            description:
              'Optional system prompt override for the peer. Defaults to the peer\'s default brief-answer mode.',
          },
          model: {
            type: 'string',
            description:
              'Optional model hint for the peer (e.g. "grok-3", "claude-opus-4-5"). The peer may ignore if its config takes precedence.',
          },
          dispatchProfile: {
            type: 'string',
            enum: [...FLEET_DISPATCH_PROFILES],
            description: DISPATCH_PROFILE_PARAMETER_DESCRIPTION,
          },
          timeoutMs: {
            type: 'number',
            description:
              'Request timeout in milliseconds. Default 60000. Increase for complex tasks.',
          },
        },
        required: ['peer', 'prompt'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const inp = input as Record<string, unknown>;
    const errors: string[] = [];
    if (typeof inp.peer !== 'string' || !inp.peer) errors.push('peer is required (string)');
    if (typeof inp.prompt !== 'string' || !inp.prompt) errors.push('prompt is required (string)');
    if (inp.dispatchProfile !== undefined && !isFleetDispatchProfile(inp.dispatchProfile)) {
      errors.push(`dispatchProfile must be one of ${FLEET_DISPATCH_PROFILES.join(', ')}`);
    }
    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: [
        'peer',
        'delegate',
        'fleet',
        'consult',
        'ask',
        'collaborate',
        'remote',
        'claude',
        'orchestrate',
        'sub-agent',
        'multi-ai',
        'distributed',
        'hermes',
        'dispatch',
        'dispatchProfile',
        'profile',
        'toolset',
        'toolsets',
        'policy',
      ],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: true,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export class ListPeersTool implements ITool {
  readonly name = 'list_peers';
  readonly description =
    'List all connected fleet peers with their status (last seen, compacting, peer chat availability). ' +
    'Use this before peer_delegate to discover peer IDs and pick a healthy peer. ' +
    'Set includeCapabilities=true when you need provider/model metadata for routing.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return executeListPeers({
      includeCapabilities: input.includeCapabilities === true,
      timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          includeCapabilities: {
            type: 'boolean',
            description:
              'When true, also call peer.describe on each peer and include provider/model capability summaries. Requires peer:invoke on the fleet key.',
          },
          timeoutMs: {
            type: 'number',
            description:
              'Per-peer peer.describe timeout in milliseconds when includeCapabilities is true. Default 5000.',
          },
        },
        required: [],
      },
    };
  }

  validate(_input: unknown): IValidationResult {
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: [
        'peers',
        'fleet',
        'connected',
        'remote',
        'claudes',
        'list',
        'discover',
        'status',
        'provider',
        'model',
        'capabilities',
        'route',
        'routing',
        'hermes',
        'dispatch',
      ],
      priority: 5,
      modifiesFiles: false,
      makesNetworkRequests: true,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export class RoutePeerTool implements ITool {
  readonly name = 'route_peer';
  readonly description =
    'Choose the best connected fleet peer and model for a prompt using peer.describe capabilities and Fleet TaskRouter. ' +
    'Use this before peer_delegate when multiple peers or providers are available.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return executeRoutePeer({
      prompt: typeof input.prompt === 'string' ? input.prompt : '',
      privacyTag:
        input.privacyTag === 'sensitive' || input.privacyTag === 'public'
          ? input.privacyTag
          : undefined,
      maxCostUsd: typeof input.maxCostUsd === 'number' ? input.maxCostUsd : undefined,
      maxLatencyMs: typeof input.maxLatencyMs === 'number' ? input.maxLatencyMs : undefined,
      parallelism: typeof input.parallelism === 'number' ? input.parallelism : undefined,
      estimatedTokens: typeof input.estimatedTokens === 'number' ? input.estimatedTokens : undefined,
      dispatchProfile: typeof input.dispatchProfile === 'string' ? input.dispatchProfile : undefined,
      timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'The task or question that will later be delegated. Used for classification and routing.',
          },
          privacyTag: {
            type: 'string',
            enum: ['sensitive', 'public'],
            description:
              'Use sensitive to veto cloud-egress peers; use public to allow cloud providers.',
          },
          maxCostUsd: {
            type: 'number',
            description: 'Optional per-task cost cap in USD.',
          },
          maxLatencyMs: {
            type: 'number',
            description: 'Optional max expected peer/model latency in milliseconds.',
          },
          parallelism: {
            type: 'number',
            description: 'Optional number of parallel lanes to recommend for ensemble/redundancy.',
          },
          estimatedTokens: {
            type: 'number',
            description: 'Optional estimated input token count for context-window filtering.',
          },
          dispatchProfile: {
            type: 'string',
            enum: [...FLEET_DISPATCH_PROFILES],
            description: ROUTE_DISPATCH_PROFILE_PARAMETER_DESCRIPTION,
          },
          timeoutMs: {
            type: 'number',
            description: 'Per-peer peer.describe timeout in milliseconds. Default 5000.',
          },
        },
        required: ['prompt'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const inp = input as Record<string, unknown>;
    const errors: string[] = [];
    if (typeof inp.prompt !== 'string' || !inp.prompt) errors.push('prompt is required (string)');
    if (
      inp.privacyTag !== undefined &&
      inp.privacyTag !== 'sensitive' &&
      inp.privacyTag !== 'public'
    ) {
      errors.push('privacyTag must be "sensitive" or "public"');
    }
    if (inp.dispatchProfile !== undefined && !isFleetDispatchProfile(inp.dispatchProfile)) {
      errors.push(`dispatchProfile must be one of ${FLEET_DISPATCH_PROFILES.join(', ')}`);
    }
    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: [
        'peer',
        'route',
        'fleet',
        'model',
        'provider',
        'capability',
        'delegate',
        'multi-ai',
        'orchestrate',
        'hermes',
        'dispatch',
        'dispatchProfile',
        'profile',
        'toolset',
        'toolsets',
        'policy',
        'safe',
        'review',
        'research',
        'code',
      ],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: true,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createFleetTools(): ITool[] {
  return [new PeerDelegateTool(), new ListPeersTool(), new RoutePeerTool()];
}

export function resetFleetToolInstances(): void {
  // Stateless adapter classes — nothing to reset.
  // The per-turn call counter in peer-delegate-tool.ts has its own
  // _resetCallCounterForTests() hook for test isolation.
}
