/**
 * OpenAI function definitions for fleet tools — Phase (d).17.
 *
 * Used by the legacy `ToolRegistry` consumed in `src/codebuddy/tools.ts`.
 * The FormalToolRegistry path consumes the ITool adapters in
 * `src/tools/registry/fleet-tools.ts` instead. We keep both in lock-step
 * because some call sites pull from one registry and some from the other.
 */

import type { CodeBuddyTool } from './client.js';
import { FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT } from '../fleet/dispatch-profile.js';

const DISPATCH_PROFILE_PARAMETER_DESCRIPTION =
  'Optional Fleet dispatch profile. When set, carries the operating posture through peer.chat ' +
  'and returns peer-side policy metadata when supported. Selection guide: ' +
  `${FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT}.`;

const ROUTE_DISPATCH_PROFILE_PARAMETER_DESCRIPTION =
  'Hermes-style operating posture for routing and later peer_delegate guidance. ' +
  `Selection guide: ${FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT}.`;

export const PEER_DELEGATE_TOOL_DEF: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'peer_delegate',
    description:
      'Delegate a one-shot question or task to a connected fleet peer Code Buddy. ' +
      'The peer answers independently with its own model and returns its response. ' +
      'Use route_peer first when multiple peers are available; pass dispatchProfile to carry the selected posture and receive policy metadata.',
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
            'The question or task to ask the peer. Be specific and self-contained — the peer has no shared context.',
        },
        systemPrompt: {
          type: 'string',
          description:
            "Optional system prompt override for the peer. Defaults to the peer's brief-answer mode.",
        },
        model: {
          type: 'string',
          description:
            'Optional model hint for the peer (e.g. "grok-3", "claude-opus-4-5"). Peer may ignore.',
        },
        dispatchProfile: {
          type: 'string',
          enum: ['balanced', 'research', 'code', 'review', 'safe'],
          description: DISPATCH_PROFILE_PARAMETER_DESCRIPTION,
        },
        timeoutMs: {
          type: 'number',
          description: 'Request timeout in milliseconds. Default 60000.',
        },
      },
      required: ['peer', 'prompt'],
    },
  },
};

export const LIST_PEERS_TOOL_DEF: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'list_peers',
    description:
      'List all connected fleet peers with their status (last seen, compacting, ' +
      'peer chat availability). Use this before peer_delegate to discover peer IDs. ' +
      'Set includeCapabilities=true when choosing between providers/models.',
    parameters: {
      type: 'object',
      properties: {
        includeCapabilities: {
          type: 'boolean',
          description:
            'When true, call peer.describe on each peer and include provider/model capability summaries. Requires peer:invoke.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Per-peer peer.describe timeout in milliseconds when includeCapabilities is true. Default 5000.',
        },
      },
      required: [],
    },
  },
};

export const ROUTE_PEER_TOOL_DEF: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'route_peer',
    description:
      'Choose the best connected fleet peer and model for a prompt using peer.describe capabilities and Fleet TaskRouter. ' +
      'Use this before peer_delegate when multiple peers or providers are available.',
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
          description: 'Optional number of parallel lanes to recommend.',
        },
        estimatedTokens: {
          type: 'number',
          description: 'Optional estimated input token count for context-window filtering.',
        },
        dispatchProfile: {
          type: 'string',
          enum: ['balanced', 'research', 'code', 'review', 'safe'],
          description: ROUTE_DISPATCH_PROFILE_PARAMETER_DESCRIPTION,
        },
        timeoutMs: {
          type: 'number',
          description: 'Per-peer peer.describe timeout in milliseconds. Default 5000.',
        },
      },
      required: ['prompt'],
    },
  },
};

export const FLEET_TOOLS: CodeBuddyTool[] = [
  PEER_DELEGATE_TOOL_DEF,
  LIST_PEERS_TOOL_DEF,
  ROUTE_PEER_TOOL_DEF,
];
