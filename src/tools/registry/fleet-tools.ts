/**
 * Fleet Tool Adapters — Phase (d).17.
 *
 * ITool-compliant wrappers for `peer_delegate`, `peer_tool_invoke`, and
 * `list_peers`. Fleet tools are explicitly NOT fleetSafe — they're
 * outbound from the caller; inbound peers run their own gating.
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
import { executePeerChain } from '../peer-chain-tool.js';
import { executeListPeers } from '../list-peers-tool.js';
import { executeRoutePeer } from '../route-peer-tool.js';
import {
  DEFAULT_PEER_TOOL_INVOKE_TOOLS,
  PEER_TOOL_INVOKE_DESCRIPTION,
  PEER_TOOL_INVOKE_PARAM_DESCRIPTIONS,
  executePeerToolInvoke,
  isFlatToolArgs,
} from '../peer-tool-invoke-tool.js';
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
      provider: typeof input.provider === 'string' ? input.provider : undefined,
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
          provider: {
            type: 'string',
            enum: ['ollama', 'lmstudio', 'lemonade', 'chatgpt-oauth', 'agy-cli', 'gemini-cli', 'openrouter', 'grok', 'mistral', 'anthropic', 'gemini', 'openai'],
            description:
              'Exact backend to use. The peer refuses the request if this provider is unavailable; it never silently substitutes another backend.',
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

export class PeerToolInvokeTool implements ITool {
  readonly name = 'peer_tool_invoke';
  readonly description = PEER_TOOL_INVOKE_DESCRIPTION;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return executePeerToolInvoke({
      peer: typeof input.peer === 'string' ? input.peer : '',
      tool: typeof input.tool === 'string' ? input.tool : '',
      args: input.args as Record<string, unknown> | undefined,
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
            minLength: 1,
            description: PEER_TOOL_INVOKE_PARAM_DESCRIPTIONS.peer,
          },
          tool: {
            type: 'string',
            enum: [...DEFAULT_PEER_TOOL_INVOKE_TOOLS],
            minLength: 1,
            description: PEER_TOOL_INVOKE_PARAM_DESCRIPTIONS.tool,
          },
          args: {
            type: 'object',
            description: PEER_TOOL_INVOKE_PARAM_DESCRIPTIONS.args,
            properties: {
              path: {
                type: 'string',
                description: 'Peer-relative path, e.g. "oracle.txt" (accepted by view_file and list_directory).',
              },
              file_path: {
                type: 'string',
                description: 'Alias of path for view_file.',
              },
              query: {
                type: 'string',
                description: 'Search query when tool is search.',
              },
            },
          },
          timeoutMs: {
            type: 'number',
            description: PEER_TOOL_INVOKE_PARAM_DESCRIPTIONS.timeoutMs,
          },
        },
        required: ['peer', 'tool'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const inp = input as Record<string, unknown>;
    const errors: string[] = [];
    const keys = Object.keys(inp).join(',') || '(none)';
    if (typeof inp.peer !== 'string' || !inp.peer) {
      errors.push(`peer is required (string); received keys: ${keys}`);
    }
    if (typeof inp.tool !== 'string' || !inp.tool) {
      errors.push(`tool is required (string); received keys: ${keys}`);
    }
    if (inp.args !== undefined && !isFlatToolArgs(inp.args)) {
      errors.push('args must be a flat object of string/number/boolean values');
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
        'tool',
        'invoke',
        'fleet',
        'view_file',
        'list_directory',
        'search',
        'read',
        'remote',
        'workspace',
        'allowlist',
        'file',
        'oracle',
      ],
      priority: 8,
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
      chainRoles: input.chainRoles,
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
          chainRoles: {
            type: 'array',
            items: {
              type: 'string',
              enum: [...FLEET_DISPATCH_PROFILES],
            },
            description:
              'Optional ordered Hermes chain roles. Example: ["code","review","safe"] returns sequential peer_delegate calls. Mutually exclusive with parallelism.',
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
    if (inp.chainRoles !== undefined) {
      if (!Array.isArray(inp.chainRoles)) {
        errors.push('chainRoles must be an array');
      } else if (inp.chainRoles.length === 0) {
        errors.push('chainRoles must include at least one profile');
      } else {
        const nonString = inp.chainRoles.some((role) => typeof role !== 'string');
        if (nonString) {
          errors.push('chainRoles must contain only strings');
        }
        const invalid = inp.chainRoles.filter((role) => !isFleetDispatchProfile(role));
        if (invalid.length > 0) {
          errors.push(`chainRoles must contain only ${FLEET_DISPATCH_PROFILES.join(', ')}`);
        }
      }
    }
    if (
      Array.isArray(inp.chainRoles) &&
      inp.chainRoles.length > 0 &&
      typeof inp.parallelism === 'number' &&
      inp.parallelism > 1
    ) {
      errors.push('chainRoles and parallelism are mutually exclusive');
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
        'chain',
        'roles',
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

export class PeerChainTool implements ITool {
  readonly name = 'peer_chain';
  readonly description =
    'Route and execute an ordered Fleet collaboration chain. ' +
    'Use this when a task should move through specialist peers such as code, review, and safe. ' +
    'Each stage receives prior stage output as handoff context.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return executePeerChain({
      prompt: typeof input.prompt === 'string' ? input.prompt : '',
      chainRoles: input.chainRoles,
      privacyTag:
        input.privacyTag === 'sensitive' || input.privacyTag === 'public'
          ? input.privacyTag
          : undefined,
      maxCostUsd: typeof input.maxCostUsd === 'number' ? input.maxCostUsd : undefined,
      maxLatencyMs: typeof input.maxLatencyMs === 'number' ? input.maxLatencyMs : undefined,
      estimatedTokens: typeof input.estimatedTokens === 'number' ? input.estimatedTokens : undefined,
      describeTimeoutMs:
        typeof input.describeTimeoutMs === 'number' ? input.describeTimeoutMs : undefined,
      stageTimeoutMs: typeof input.stageTimeoutMs === 'number' ? input.stageTimeoutMs : undefined,
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
              'The task that will be routed and executed through the ordered peer chain.',
          },
          chainRoles: {
            type: 'array',
            items: {
              type: 'string',
              enum: [...FLEET_DISPATCH_PROFILES],
            },
            description:
              'Ordered Fleet dispatch profiles to execute. Example: ["code","review","safe"].',
          },
          privacyTag: {
            type: 'string',
            enum: ['sensitive', 'public'],
            description:
              'Use sensitive to veto cloud-egress peers during routing; use public to allow cloud providers.',
          },
          maxCostUsd: {
            type: 'number',
            description: 'Optional per-task route cost cap in USD.',
          },
          maxLatencyMs: {
            type: 'number',
            description: 'Optional max expected peer/model latency in milliseconds.',
          },
          estimatedTokens: {
            type: 'number',
            description: 'Optional estimated input token count for context-window filtering.',
          },
          describeTimeoutMs: {
            type: 'number',
            description: 'Per-peer peer.describe timeout in milliseconds. Default 5000.',
          },
          stageTimeoutMs: {
            type: 'number',
            description: 'Per-stage peer.chat timeout in milliseconds. Default 60000.',
          },
        },
        required: ['prompt', 'chainRoles'],
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
    if (!Array.isArray(inp.chainRoles)) {
      errors.push('chainRoles must be an array');
    } else if (inp.chainRoles.length === 0) {
      errors.push('chainRoles must include at least one profile');
    } else if (inp.chainRoles.length > 5) {
      errors.push('chainRoles supports at most 5 stages');
    } else {
      const nonString = inp.chainRoles.some((role) => typeof role !== 'string');
      if (nonString) {
        errors.push('chainRoles must contain only strings');
      }
      const invalid = inp.chainRoles.filter((role) => !isFleetDispatchProfile(role));
      if (invalid.length > 0) {
        errors.push(`chainRoles must contain only ${FLEET_DISPATCH_PROFILES.join(', ')}`);
      }
    }
    if (
      inp.privacyTag !== undefined &&
      inp.privacyTag !== 'sensitive' &&
      inp.privacyTag !== 'public'
    ) {
      errors.push('privacyTag must be "sensitive" or "public"');
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
        'chain',
        'fleet',
        'delegate',
        'multi-agent',
        'collaborate',
        'orchestrate',
        'hermes',
        'handoff',
        'roles',
        'review',
        'safe',
        'code',
      ],
      priority: 8,
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
  return [
    new PeerDelegateTool(),
    new PeerToolInvokeTool(),
    new PeerChainTool(),
    new ListPeersTool(),
    new RoutePeerTool(),
  ];
}

export function resetFleetToolInstances(): void {
  // Stateless adapter classes — nothing to reset.
  // The per-turn call counter in peer-delegate-tool.ts has its own
  // _resetCallCounterForTests() hook for test isolation.
}
