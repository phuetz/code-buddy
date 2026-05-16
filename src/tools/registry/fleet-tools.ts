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

export class PeerDelegateTool implements ITool {
  readonly name = 'peer_delegate';
  readonly description =
    'Delegate a one-shot question or task to a connected fleet peer Code Buddy. ' +
    'The peer answers independently with its own model and returns its response. ' +
    'Use list_peers first to see which peers are available. Peer IDs come from the ' +
    '--name flag used in /fleet listen.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return executePeerDelegate({
      peer: typeof input.peer === 'string' ? input.peer : '',
      prompt: typeof input.prompt === 'string' ? input.prompt : '',
      systemPrompt: typeof input.systemPrompt === 'string' ? input.systemPrompt : undefined,
      model: typeof input.model === 'string' ? input.model : undefined,
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
      keywords: ['peers', 'fleet', 'connected', 'remote', 'claudes', 'list', 'discover', 'status'],
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

export function createFleetTools(): ITool[] {
  return [new PeerDelegateTool(), new ListPeersTool()];
}

export function resetFleetToolInstances(): void {
  // Stateless adapter classes — nothing to reset.
  // The per-turn call counter in peer-delegate-tool.ts has its own
  // _resetCallCounterForTests() hook for test isolation.
}
