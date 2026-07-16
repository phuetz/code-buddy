/**
 * peer_chain tool — route and execute an ordered Fleet collaboration.
 *
 * This is the autonomous counterpart to calling `route_peer` and then
 * manually issuing several `peer_delegate` calls. It keeps each stage
 * one-shot/no-history on the remote peer, but threads completed stage
 * output into the next prompt so Draft -> Review -> Safe chains have a
 * real handoff.
 */

import {
  FLEET_DISPATCH_PROFILES,
  isFleetDispatchProfile,
  type FleetDispatchProfile,
} from '../fleet/dispatch-profile.js';
import type { ToolResult } from '../types/index.js';
import { executePeerDelegate } from './peer-delegate-tool.js';
import { executeRoutePeer } from './route-peer-tool.js';
import { scanForSecrets } from '../fleet/privacy-lint.js';

export interface PeerChainParams {
  prompt: string;
  chainRoles: unknown;
  privacyTag?: 'sensitive' | 'public';
  maxCostUsd?: number;
  maxLatencyMs?: number;
  estimatedTokens?: number;
  describeTimeoutMs?: number;
  stageTimeoutMs?: number;
}

interface RoutedChainCall {
  tool: 'peer_delegate';
  args: {
    peer: string;
    prompt: string;
    model: string;
    dispatchProfile?: string;
  };
}

interface RoutedChainData {
  mode?: string;
  chain?: Array<{
    peer: string;
    model: string;
    role?: string;
    score: number;
  }>;
  nextCalls?: RoutedChainCall[];
  rationale?: string;
}

interface CompletedStage {
  elapsedMs?: number;
  model?: string;
  output?: string;
  peer: string;
  role: FleetDispatchProfile;
  text: string;
}

const MAX_EXECUTABLE_CHAIN_ROLES = 5;

export async function executePeerChain(params: PeerChainParams): Promise<ToolResult> {
  if (!params.prompt || typeof params.prompt !== 'string') {
    return { success: false, error: 'peer_chain: "prompt" parameter is required (string).' };
  }

  const rolesResult = normalizeExecutableChainRoles(params.chainRoles);
  if (rolesResult.error) {
    return { success: false, error: rolesResult.error };
  }
  const roles = rolesResult.roles!;
  const privacyLint = scanForSecrets(params.prompt);
  const privacyTag = privacyLint.hasSecrets ? 'sensitive' : params.privacyTag;

  const routeResult = await executeRoutePeer({
    prompt: params.prompt,
    chainRoles: roles,
    ...(privacyTag ? { privacyTag } : {}),
    ...(typeof params.maxCostUsd === 'number' ? { maxCostUsd: params.maxCostUsd } : {}),
    ...(typeof params.maxLatencyMs === 'number' ? { maxLatencyMs: params.maxLatencyMs } : {}),
    ...(typeof params.estimatedTokens === 'number' ? { estimatedTokens: params.estimatedTokens } : {}),
    ...(typeof params.describeTimeoutMs === 'number' ? { timeoutMs: params.describeTimeoutMs } : {}),
  });
  if (!routeResult.success) {
    return {
      success: false,
      error: `peer_chain route failed: ${routeResult.error ?? 'unknown error'}`,
      data: routeResult.data,
    };
  }

  const routeData = routeResult.data as RoutedChainData;
  if (routeData.mode !== 'chain' || !routeData.nextCalls || routeData.nextCalls.length === 0) {
    return {
      success: false,
      error: 'peer_chain: route_peer did not return an executable chain.',
      data: routeData,
    };
  }

  const completed: CompletedStage[] = [];
  for (const [index, call] of routeData.nextCalls.entries()) {
    const role = resolveStageRole(call, routeData, roles, index);
    const stagePrompt = buildPeerChainStagePrompt({
      completed,
      index,
      originalPrompt: params.prompt,
      role,
      total: routeData.nextCalls.length,
    });
    const delegateResult = await executePeerDelegate({
      peer: call.args.peer,
      prompt: stagePrompt,
      model: call.args.model,
      dispatchProfile: role,
      ...(typeof params.stageTimeoutMs === 'number' ? { timeoutMs: params.stageTimeoutMs } : {}),
    });

    if (!delegateResult.success) {
      return {
        success: false,
        error:
          `peer_chain stage ${index + 1}/${routeData.nextCalls.length} ` +
          `(${role} on ${call.args.peer}) failed: ${delegateResult.error ?? 'unknown error'}`,
        data: {
          route: routeData,
          completedStages: completed,
          failedStage: {
            index,
            role,
            peer: call.args.peer,
            model: call.args.model,
            error: delegateResult.error,
          },
        },
      };
    }

    completed.push({
      peer: call.args.peer,
      model: call.args.model,
      role,
      text: extractDelegateText(delegateResult),
      output: delegateResult.output,
      elapsedMs: extractDelegateElapsedMs(delegateResult),
    });
  }

  const finalText = completed[completed.length - 1]?.text ?? '';
  const output = [
    `Fleet peer chain completed (${completed.length} stage${completed.length === 1 ? '' : 's'}).`,
    ...completed.map((stage, index) => (
      `${index + 1}. ${stage.role}: ${stage.peer}/${stage.model ?? '?'}`
    )),
    '',
    finalText,
  ].join('\n');

  return {
    success: true,
    output,
    data: {
      mode: 'chain',
      route: routeData,
      stages: completed,
      finalText,
    },
  };
}

function normalizeExecutableChainRoles(raw: unknown): {
  roles?: FleetDispatchProfile[];
  error?: string;
} {
  if (!Array.isArray(raw)) {
    return { error: 'peer_chain: chainRoles must be an array of dispatch profiles.' };
  }
  if (raw.length === 0) {
    return { error: 'peer_chain: chainRoles must include at least one dispatch profile.' };
  }
  if (raw.length > MAX_EXECUTABLE_CHAIN_ROLES) {
    return {
      error:
        `peer_chain: chainRoles supports at most ${MAX_EXECUTABLE_CHAIN_ROLES} ` +
        'stages because peer_delegate has a per-turn safety cap.',
    };
  }
  const nonString = raw.some((role) => typeof role !== 'string');
  if (nonString) {
    return { error: 'peer_chain: chainRoles must contain only string dispatch profiles.' };
  }
  const roles = raw
    .map((role) => role.trim())
    .filter(Boolean);
  if (roles.length === 0) {
    return { error: 'peer_chain: chainRoles must include at least one dispatch profile.' };
  }
  const invalid = roles.filter((role) => !isFleetDispatchProfile(role));
  if (invalid.length > 0) {
    return {
      error:
        `peer_chain: chainRoles must contain only ${FLEET_DISPATCH_PROFILES.join(', ')}; ` +
        `invalid: ${invalid.join(', ')}.`,
    };
  }
  return { roles: roles as FleetDispatchProfile[] };
}

function resolveStageRole(
  call: RoutedChainCall,
  routeData: RoutedChainData,
  requestedRoles: FleetDispatchProfile[],
  index: number,
): FleetDispatchProfile {
  const candidate =
    call.args.dispatchProfile ?? routeData.chain?.[index]?.role ?? requestedRoles[index];
  return isFleetDispatchProfile(candidate) ? candidate : 'balanced';
}

function buildPeerChainStagePrompt(input: {
  completed: CompletedStage[];
  index: number;
  originalPrompt: string;
  role: FleetDispatchProfile;
  total: number;
}): string {
  const header = `Fleet chain stage ${input.index + 1}/${input.total}: ${input.role}`;
  const prior = input.completed.length > 0
    ? [
        'Previous stage outputs:',
        ...input.completed.map((stage, index) => (
          `\n[${index + 1}. ${stage.role} via ${stage.peer}/${stage.model ?? '?'}]\n${stage.text}`
        )),
      ].join('\n')
    : 'Previous stage outputs: none. This is the first stage.';
  return [
    header,
    '',
    roleInstruction(input.role),
    '',
    'Original task:',
    input.originalPrompt,
    '',
    prior,
    '',
    'Return only this stage result. Include: summary, evidence or reasoning, risks, and handoff notes for the next stage.',
  ].join('\n');
}

function roleInstruction(role: FleetDispatchProfile): string {
  switch (role) {
    case 'research':
      return 'Research role: gather context, assumptions, constraints, and unresolved questions. Do not invent external facts.';
    case 'code':
      return 'Code role: propose the implementation path or concrete patch guidance. Keep it scoped and testable.';
    case 'review':
      return 'Review role: audit prior output first. Lead with defects, regressions, missing tests, and unsafe assumptions.';
    case 'safe':
      return 'Safe role: verify risk, reversibility, test evidence, and whether the chain output is safe to apply.';
    case 'balanced':
    default:
      return 'Balanced role: advance the task pragmatically while preserving constraints from earlier stages.';
  }
}

function extractDelegateText(result: ToolResult): string {
  const data = result.data as { text?: unknown } | undefined;
  if (typeof data?.text === 'string') {
    return data.text;
  }
  return result.output ?? '';
}

function extractDelegateElapsedMs(result: ToolResult): number | undefined {
  const data = result.data as { elapsedMs?: unknown } | undefined;
  return typeof data?.elapsedMs === 'number' ? data.elapsedMs : undefined;
}
