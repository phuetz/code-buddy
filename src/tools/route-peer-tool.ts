/**
 * route_peer tool — Fleet semantic peer router.
 *
 * Best-effort LLM-facing wrapper around Fleet's TaskRouter. It discovers
 * connected peer capabilities via peer.describe, classifies the prompt,
 * and returns the best peer/model lane for a later peer_delegate call.
 */

import {
  NoPeerAvailableError,
  TaskRouter,
  planChainDispatch,
  type DispatchConstraints,
  type PeerSlot,
} from '../fleet/task-router.js';
import {
  DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS,
  FLEET_DISPATCH_PROFILES,
  buildHermesToolsetDescriptor,
  getDispatchToolPolicy,
  isFleetDispatchProfile,
  type FleetDispatchProfile,
} from '../fleet/dispatch-profile.js';
import {
  resolveActiveCustomAgentDispatchProfile,
  shouldPropagateResolvedDispatchProfile,
} from '../agent/custom/custom-agent-runtime.js';
import type { PeerCapability } from '../fleet/types.js';
import { getFleetRegistry } from '../fleet/fleet-registry.js';
import { classifyTaskComplexity } from '../optimization/model-routing.js';
import type { ToolResult } from '../types/index.js';
import { getGlobalEventBus } from '../events/event-bus.js';
import { scanForSecrets } from '../fleet/privacy-lint.js';

export interface RoutePeerParams {
  prompt: string;
  privacyTag?: 'sensitive' | 'public';
  maxCostUsd?: number;
  maxLatencyMs?: number;
  parallelism?: number;
  estimatedTokens?: number;
  dispatchProfile?: FleetDispatchProfile | string;
  chainRoles?: unknown;
  timeoutMs?: number;
}

interface DescribeError {
  peer: string;
  error: string;
}

interface PeerDescribePayload {
  capabilities?: unknown;
}

const DEFAULT_DESCRIBE_TIMEOUT_MS = 5_000;
const MAX_CHAIN_ROLES = 6;

export async function executeRoutePeer(params: RoutePeerParams): Promise<ToolResult> {
  if (!params.prompt || typeof params.prompt !== 'string') {
    return { success: false, error: 'route_peer: "prompt" parameter is required (string).' };
  }
  if (
    params.dispatchProfile !== undefined &&
    !isFleetDispatchProfile(params.dispatchProfile)
  ) {
    return {
      success: false,
      error: `route_peer: dispatchProfile must be one of ${FLEET_DISPATCH_PROFILES.join(', ')}.`,
    };
  }
  const chainRolesResult = normalizeChainRoles(params.chainRoles);
  if (chainRolesResult.error) {
    return { success: false, error: chainRolesResult.error };
  }
  if (
    chainRolesResult.roles &&
    typeof params.parallelism === 'number' &&
    params.parallelism > 1
  ) {
    return {
      success: false,
      error: 'route_peer: chainRoles and parallelism are mutually exclusive.',
    };
  }

  const registry = getFleetRegistry();
  const entries = registry.list();
  if (entries.length === 0) {
    return {
      success: false,
      error:
        'No fleet peers connected. Ask the user to run /fleet listen <ws-url> --name <id> first.',
    };
  }

  const timeoutMs =
    params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : DEFAULT_DESCRIBE_TIMEOUT_MS;
  const describeErrors: DescribeError[] = [];
  const peers: PeerSlot[] = [];

  await Promise.all(
    entries.map(async (entry) => {
      try {
        const raw = (await entry.listener.request(
          'peer.describe',
          {},
          { timeoutMs },
        )) as PeerDescribePayload;
        const capability = normalizeCapability(raw.capabilities);
        if (capability && capability.models.length > 0) {
          peers.push({ peerId: entry.id, capability });
        } else {
          describeErrors.push({
            peer: entry.id,
            error: 'peer.describe returned no routable capabilities',
          });
        }
      } catch (err) {
        describeErrors.push({
          peer: entry.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  if (peers.length === 0) {
    return {
      success: false,
      error:
        'No connected peer exposed routable capabilities. Try list_peers({includeCapabilities:true}) for details.',
      data: { describeErrors },
    };
  }

  const privacyLint = scanForSecrets(params.prompt);
  const privacyTag = privacyLint.hasSecrets ? 'sensitive' : params.privacyTag;
  const routablePeers = privacyLint.highConfidence
    ? keepLocalOnly(peers)
    : peers;
  const classification = classifyTaskComplexity(params.prompt);
  const dispatchResolution = resolveActiveCustomAgentDispatchProfile(params.dispatchProfile);
  const dispatchProfile = dispatchResolution.dispatchProfile;
  const toolPolicy = getDispatchToolPolicy(dispatchProfile);
  const toolset = buildHermesToolsetDescriptor(
    dispatchProfile,
    [...DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS],
  );
  const toolDecisions = toolset.decisions;
  const constraints: DispatchConstraints = {
    ...(privacyTag ? { privacyTag } : {}),
    ...(typeof params.maxCostUsd === 'number' ? { maxCostUsd: params.maxCostUsd } : {}),
    ...(typeof params.maxLatencyMs === 'number' ? { maxLatencyMs: params.maxLatencyMs } : {}),
    ...(typeof params.parallelism === 'number' && params.parallelism > 0
      ? { parallelism: Math.floor(params.parallelism) }
      : {}),
    ...(typeof params.estimatedTokens === 'number' && params.estimatedTokens > 0
      ? { estimatedTokens: Math.floor(params.estimatedTokens) }
      : {}),
    dispatchProfile,
  };

  try {
    const router = new TaskRouter();
    const plan = chainRolesResult.roles
      ? planChainDispatch(classification, routablePeers, {
          chainRoles: chainRolesResult.roles,
          constraints,
        })
      : router.plan(classification, routablePeers, constraints);
    const chainNextCalls = plan.chain?.map((lane) => buildPeerDelegateCall(
      lane.peerId,
      lane.model,
      lane.provider,
      params.prompt,
      lane.role,
    ));
    const output = {
      mode: plan.chain ? 'chain' : 'single',
      recommendation: {
        peer: plan.primary.peerId,
        model: plan.primary.model,
        ...(plan.primary.provider ? { provider: plan.primary.provider } : {}),
        score: plan.primary.score,
        ...(plan.primary.role ? { role: plan.primary.role } : {}),
      },
      fallback: plan.fallback
        ? {
            peer: plan.fallback.peerId,
            model: plan.fallback.model,
            ...(plan.fallback.provider ? { provider: plan.fallback.provider } : {}),
            score: plan.fallback.score,
            ...(plan.fallback.role ? { role: plan.fallback.role } : {}),
          }
        : null,
      parallel: plan.parallel?.map((lane) => ({
        peer: lane.peerId,
        model: lane.model,
        ...(lane.provider ? { provider: lane.provider } : {}),
        score: lane.score,
        ...(lane.role ? { role: lane.role } : {}),
      })),
      chain: plan.chain?.map((lane) => ({
        peer: lane.peerId,
        model: lane.model,
        ...(lane.provider ? { provider: lane.provider } : {}),
        score: lane.score,
        ...(lane.role ? { role: lane.role } : {}),
      })),
      dispatchProfile,
      dispatchProfileSource: dispatchResolution.source,
      ...(dispatchResolution.agentId ? { dispatchProfileAgent: dispatchResolution.agentId } : {}),
      toolPolicy,
      toolDecisions,
      toolset,
      privacyTag: privacyTag ?? 'public',
      privacyLint: {
        hasSecrets: privacyLint.hasSecrets,
        highConfidence: privacyLint.highConfidence,
        matchKinds: privacyLint.matches.map((match) => match.kind),
      },
      rationale: plan.rationale,
      classification,
      describeErrors,
      nextCall: {
        tool: 'peer_delegate',
        args: {
          peer: plan.primary.peerId,
          prompt: params.prompt,
          model: plan.primary.model,
          ...(plan.primary.provider ? { provider: plan.primary.provider } : {}),
          ...(plan.primary.role
            ? { dispatchProfile: plan.primary.role }
            : shouldPropagateResolvedDispatchProfile(dispatchResolution)
              ? { dispatchProfile }
              : {}),
        },
      },
      ...(chainNextCalls ? { nextCalls: chainNextCalls } : {}),
    };

    try {
      if (output.recommendation && output.recommendation.peer) {
        getGlobalEventBus().emit('fleet:activity', {
          
          
          activityType: 'fleet.route',
          title: 'Fleet Route Planned',
          description: `Task routed to peer ${output.recommendation.peer}`,
          metadata: { peer: output.recommendation.peer, model: output.recommendation.model, prompt: params.prompt }
        });
      }
    } catch (_err) {
      // ignore
    }
    return {
      success: true,
      output: JSON.stringify(output, null, 2),
      data: output,
    };
  } catch (err) {
    if (err instanceof NoPeerAvailableError) {
      return {
        success: false,
        error: err.message,
        data: {
          classification,
          describeErrors,
          privacyTag: privacyTag ?? 'public',
          privacyLint: {
            hasSecrets: privacyLint.hasSecrets,
            highConfidence: privacyLint.highConfidence,
            matchKinds: privacyLint.matches.map((match) => match.kind),
          },
        },
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      data: { classification, describeErrors },
    };
  }
}

function keepLocalOnly(peers: PeerSlot[]): PeerSlot[] {
  return peers
    .map((slot) => ({
      ...slot,
      capability: {
        ...slot.capability,
        models: slot.capability.models.filter(
          (model) => (model.egress ?? slot.capability.egress) === 'local',
        ),
      },
    }))
    .filter((slot) => slot.capability.models.length > 0);
}

function buildPeerDelegateCall(
  peer: string,
  model: string,
  provider: string | undefined,
  prompt: string,
  dispatchProfile?: string,
): {
  tool: 'peer_delegate';
  args: {
    peer: string;
    prompt: string;
    model: string;
    provider?: string;
    dispatchProfile?: string;
  };
} {
  return {
    tool: 'peer_delegate',
    args: {
      peer,
      prompt,
      model,
      ...(provider ? { provider } : {}),
      ...(dispatchProfile ? { dispatchProfile } : {}),
    },
  };
}

function normalizeChainRoles(raw: unknown): {
  roles?: FleetDispatchProfile[];
  error?: string;
} {
  if (raw === undefined) {
    return {};
  }
  if (!Array.isArray(raw)) {
    return { error: 'route_peer: chainRoles must be an array of dispatch profiles.' };
  }
  const hasNonString = raw.some((role) => typeof role !== 'string');
  if (hasNonString) {
    return { error: 'route_peer: chainRoles must contain only string dispatch profiles.' };
  }
  const roles = raw
    .map((role) => role.trim())
    .filter(Boolean);
  if (roles.length === 0) {
    return { error: 'route_peer: chainRoles must include at least one dispatch profile.' };
  }
  if (roles.length > MAX_CHAIN_ROLES) {
    return { error: `route_peer: chainRoles supports at most ${MAX_CHAIN_ROLES} stages.` };
  }
  const invalid = roles.filter((role) => !isFleetDispatchProfile(role));
  if (invalid.length > 0) {
    return {
      error:
        `route_peer: chainRoles must contain only ${FLEET_DISPATCH_PROFILES.join(', ')}; ` +
        `invalid: ${invalid.join(', ')}.`,
    };
  }
  return { roles: roles as FleetDispatchProfile[] };
}

function normalizeCapability(raw: unknown): PeerCapability | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<PeerCapability>;
  if (!Array.isArray(candidate.models)) return null;
  return {
    models: candidate.models.filter((model) => (
      model &&
      typeof model.id === 'string' &&
      typeof model.contextWindow === 'number' &&
      Array.isArray(model.strengths) &&
      typeof model.provider === 'string'
    )),
    egress: candidate.egress ?? 'cloud',
    machineLabel: candidate.machineLabel ?? '',
    machineSpec: candidate.machineSpec,
    maxConcurrency: candidate.maxConcurrency,
    activeRequests: candidate.activeRequests,
    roles: Array.isArray(candidate.roles)
      ? candidate.roles.filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
      : undefined,
  };
}
