/**
 * OrchestratorBridge — Claude Cowork parity
 *
 * Wraps Code Buddy's MultiAgentSystem to decompose complex goals into
 * parallel sub-agent tasks. Emits ServerEvents as the orchestrator runs.
 *
 * @module main/agent/orchestrator-bridge
 */

import { log, logError, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import type { ServerEvent, SubAgent, SubAgentRole } from '../../renderer/types';

export type OrchestratorStrategy =
  | 'sequential'
  | 'parallel'
  | 'hierarchical'
  | 'peer_review'
  | 'iterative';

export interface OrchestratorOptions {
  strategy?: OrchestratorStrategy;
  maxRounds?: number;
  requireConsensus?: boolean;
}

export interface OrchestratorResult {
  success: boolean;
  summary: string;
  artifacts: Record<string, unknown>;
  agentResults: Array<{
    role: string;
    success: boolean;
    output: string;
    duration: number;
  }>;
  duration: number;
  errors: string[];
}

// Lazy-loaded core module
type MultiAgentModule = {
  MultiAgentSystem: new (
    apiKey: string,
    baseURL?: string,
    toolExecutor?: unknown,
    perAgentOverrides?: {
      orchestrator?: { model?: string };
      coder?: { model?: string };
      reviewer?: { model?: string };
      tester?: { model?: string };
    }
  ) => {
    runWorkflow: (
      goal: string,
      options: Partial<{
        strategy: OrchestratorStrategy;
        maxRounds: number;
        requireConsensus: boolean;
      }>
    ) => Promise<{
      success: boolean;
      summary: string;
      artifacts?: Map<string, unknown> | Record<string, unknown>;
      results?: Map<string, { success: boolean; output: string; duration?: number; role?: string }>;
      errors?: string[];
      duration: number;
    }>;
    on: (event: string, listener: (data: unknown) => void) => void;
    off: (event: string, listener: (data: unknown) => void) => void;
  };
};

let cachedModule: MultiAgentModule | null = null;

async function loadModule(): Promise<MultiAgentModule | null> {
  if (cachedModule) return cachedModule;
  const mod = await loadCoreModule<MultiAgentModule>('agent/multi-agent/multi-agent-system.js');
  if (mod) {
    cachedModule = mod;
    log('[OrchestratorBridge] Core multi-agent-system loaded');
  } else {
    logWarn('[OrchestratorBridge] Core multi-agent-system unavailable');
  }
  return mod;
}

export class OrchestratorBridge {
  private sendToRenderer: (event: ServerEvent) => void;
  private getApiKey: () => string;
  private getBaseURL: () => string | undefined;
  private getModel: () => string | undefined;
  private activeSystem: { on: (e: string, l: (d: unknown) => void) => void; off: (e: string, l: (d: unknown) => void) => void } | null = null;

  constructor(
    sendToRenderer: (event: ServerEvent) => void,
    getApiKey: () => string,
    getBaseURL: () => string | undefined,
    getModel: () => string | undefined = () => undefined
  ) {
    this.sendToRenderer = sendToRenderer;
    this.getApiKey = getApiKey;
    this.getBaseURL = getBaseURL;
    this.getModel = getModel;
  }

  /** Heuristic: detect if a goal would benefit from multi-agent decomposition */
  isComplexGoal(goal: string): boolean {
    // Simple heuristic: long prompt, multiple action verbs, or explicit orchestration keywords
    if (goal.length > 400) return true;
    const actionVerbs = /\b(implement|build|create|design|refactor|review|test|deploy|analyze|research|debug|fix|migrate)\b/gi;
    const matches = goal.match(actionVerbs);
    if (matches && matches.length >= 3) return true;
    if (/\b(orchestrate|multi-?agent|parallel|team|sub-?agents?)\b/i.test(goal)) return true;
    return false;
  }

  /** Run a multi-agent workflow for a complex goal */
  async run(
    sessionId: string,
    goal: string,
    options: OrchestratorOptions = {}
  ): Promise<OrchestratorResult> {
    const mod = await loadModule();
    if (!mod) {
      return {
        success: false,
        summary: 'Multi-agent system unavailable',
        artifacts: {},
        agentResults: [],
        duration: 0,
        errors: ['Multi-agent system module could not be loaded'],
      };
    }

    // The built-in agent configs hardcode Grok model names, so without an
    // override every sub-agent calls the active provider's endpoint with a
    // `grok-*` model — which silently hangs on ChatGPT/Codex OAuth and 404s on
    // Ollama. Thread the user's selected model into every role so the swarm
    // actually runs on whatever provider is configured (incl. local Ollama).
    const model = this.getModel();
    const perAgentOverrides = model
      ? {
          orchestrator: { model },
          coder: { model },
          reviewer: { model },
          tester: { model },
        }
      : undefined;
    const system = new mod.MultiAgentSystem(
      this.getApiKey(),
      this.getBaseURL(),
      undefined,
      perAgentOverrides
    );
    this.activeSystem = system;

    // Forward orchestrator events to renderer
    const onAgentStart = (data: unknown) => {
      const d = data as { role?: string; agentId?: string };
      if (d.role) {
        const subAgent: SubAgent = {
          // Role-based id (no timestamp) so it matches the id used by the
          // `subagent.completed`/`subagent.status` events below — the core
          // agent:start/complete events carry no agentId, so a timestamped id
          // here would never match and the panel would show every agent stuck
          // on "running" forever even after the workflow finished.
          id: d.agentId ?? `orchestrator-${d.role}`,
          nickname: d.role,
          role: d.role as SubAgentRole,
          status: 'running',
          depth: 1,
          parentId: null,
          createdAt: Date.now(),
          sessionId,
        };
        this.sendToRenderer({
          type: 'subagent.spawned',
          payload: { sessionId, subAgent },
        });
      }
    };

    const onAgentComplete = (data: unknown) => {
      // The core emits `agent:complete` as `{ role, result }` where `result`
      // is an AgentExecutionResult ({ success, output, ... }) — NOT a bare
      // `output` string. Reading `d.output` (the old code) always yielded ''
      // so the panel showed "No output yet" for every finished agent.
      const d = data as {
        role?: string;
        agentId?: string;
        output?: string;
        result?: string | { output?: string };
      };
      if (d.role) {
        const result =
          typeof d.result === 'string'
            ? d.result
            : (d.result?.output ?? d.output ?? '');
        this.sendToRenderer({
          type: 'subagent.completed',
          payload: {
            sessionId,
            agentId: d.agentId ?? `orchestrator-${d.role}`,
            nickname: d.role,
            result,
          },
        });
      }
    };

    const onAgentError = (data: unknown) => {
      const d = data as { role?: string; agentId?: string; error?: string };
      if (d.role) {
        this.sendToRenderer({
          type: 'subagent.status',
          payload: {
            sessionId,
            agentId: d.agentId ?? `orchestrator-${d.role}`,
            nickname: d.role,
            status: 'error',
          },
        });
      }
    };

    // Live activity — surface what each agent is doing *while* it works
    // (round number + the tool it is invoking) so the panel isn't an opaque
    // "running" spinner for minutes at a time.
    const emitActivity = (role: string, currentStep: string) => {
      this.sendToRenderer({
        type: 'subagent.activity',
        payload: { sessionId, agentId: `orchestrator-${role}`, nickname: role, currentStep },
      });
    };
    const onAgentRound = (data: unknown) => {
      const d = data as { role?: string; round?: number };
      if (d.role && typeof d.round === 'number') emitActivity(d.role, `Thinking · round ${d.round}`);
    };
    const onAgentTool = (data: unknown) => {
      const d = data as { role?: string; tool?: string };
      if (d.role && d.tool) emitActivity(d.role, `Running tool · ${d.tool}`);
    };

    try {
      system.on('agent:start', onAgentStart);
      system.on('agent:complete', onAgentComplete);
      system.on('agent:error', onAgentError);
      system.on('agent:round', onAgentRound);
      system.on('agent:tool', onAgentTool);

      const result = await system.runWorkflow(goal, {
        strategy: options.strategy ?? 'hierarchical',
        maxRounds: options.maxRounds,
        requireConsensus: options.requireConsensus,
      });

      // Normalize artifacts
      let artifacts: Record<string, unknown> = {};
      if (result.artifacts instanceof Map) {
        artifacts = Object.fromEntries(result.artifacts.entries());
      } else if (result.artifacts) {
        artifacts = result.artifacts as Record<string, unknown>;
      }

      // Normalize agent results
      const agentResults: OrchestratorResult['agentResults'] = [];
      if (result.results instanceof Map) {
        for (const [role, res] of result.results.entries()) {
          agentResults.push({
            role: res.role ?? role,
            success: res.success,
            output: res.output,
            duration: res.duration ?? 0,
          });
        }
      }

      return {
        success: result.success,
        summary: result.summary,
        artifacts,
        agentResults,
        duration: result.duration,
        errors: result.errors ?? [],
      };
    } catch (err) {
      logError('[OrchestratorBridge] Workflow failed:', err);
      return {
        success: false,
        summary: err instanceof Error ? err.message : 'Workflow failed',
        artifacts: {},
        agentResults: [],
        duration: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    } finally {
      try {
        system.off('agent:start', onAgentStart);
        system.off('agent:complete', onAgentComplete);
        system.off('agent:error', onAgentError);
        system.off('agent:round', onAgentRound);
        system.off('agent:tool', onAgentTool);
      } catch { /* ignore */ }
      this.activeSystem = null;
    }
  }

  /** Check if an orchestration is currently running */
  isRunning(): boolean {
    return this.activeSystem !== null;
  }
}
