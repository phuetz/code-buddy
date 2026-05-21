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

export interface RoutePeerParams {
  prompt: string;
  privacyTag?: 'sensitive' | 'public';
  maxCostUsd?: number;
  maxLatencyMs?: number;
  parallelism?: number;
  estimatedTokens?: number;
  dispatchProfile?: FleetDispatchProfile | string;
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
    ...(params.privacyTag ? { privacyTag: params.privacyTag } : {}),
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
    const plan = router.plan(classification, peers, constraints);
    const output = {
      recommendation: {
        peer: plan.primary.peerId,
        model: plan.primary.model,
        score: plan.primary.score,
      },
      fallback: plan.fallback
        ? {
            peer: plan.fallback.peerId,
            model: plan.fallback.model,
            score: plan.fallback.score,
          }
        : null,
      parallel: plan.parallel?.map((lane) => ({
        peer: lane.peerId,
        model: lane.model,
        score: lane.score,
      })),
      dispatchProfile,
      dispatchProfileSource: dispatchResolution.source,
      ...(dispatchResolution.agentId ? { dispatchProfileAgent: dispatchResolution.agentId } : {}),
      toolPolicy,
      toolDecisions,
      toolset,
      rationale: plan.rationale,
      classification,
      describeErrors,
      nextCall: {
        tool: 'peer_delegate',
        args: {
          peer: plan.primary.peerId,
          prompt: params.prompt,
          model: plan.primary.model,
          ...(shouldPropagateResolvedDispatchProfile(dispatchResolution) ? { dispatchProfile } : {}),
        },
      },
    };

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
        data: { classification, describeErrors },
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      data: { classification, describeErrors },
    };
  }
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
    egress: candidate.egress ?? 'local',
    machineLabel: candidate.machineLabel ?? '',
    machineSpec: candidate.machineSpec,
    maxConcurrency: candidate.maxConcurrency,
    activeRequests: candidate.activeRequests,
  };
}
