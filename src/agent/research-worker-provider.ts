/**
 * Research-worker provider seam — breaks the `wide-research → codebuddy-agent`
 * import edge (the last link of the agent↔tool-registry cycle).
 *
 * `WideResearchOrchestrator` spawns sub-agents to research subtopics. Importing
 * the concrete `CodeBuddyAgent` from `wide-research.ts` closed a cycle
 * (agent → agent-executor → tool-handler → registry → research-tools →
 * deep-research-tool → wide-research → agent). Instead, the orchestrator asks
 * this module for a worker, and whoever KNOWS about `CodeBuddyAgent` injects a
 * factory at startup (the agent's own constructor for the tool path; the
 * `buddy research` CLI for the CLI path). Same inversion as
 * `setDelegateAgentProvider` — the low-level module never names the top-level
 * agent.
 *
 * This module imports nothing heavy, so neither side forms a cycle through it.
 */

/** The minimal streaming surface a research worker must expose (CodeBuddyAgent satisfies it). */
export interface ResearchWorkerStreamChunk {
  type: string;
  content?: string;
}

export interface ResearchWorker {
  processUserMessageStream(query: string): AsyncIterable<ResearchWorkerStreamChunk>;
  /** Cooperative cancellation used by bounded Wide Research worker slots. */
  abortCurrentOperation?(): void;
}

export type ResearchWorkerFactory = (params: {
  apiKey: string;
  baseURL?: string | undefined;
  model?: string | undefined;
  maxRounds: number;
}) => ResearchWorker;

let _factory: ResearchWorkerFactory | null = null;

/** Inject the factory that builds a research sub-agent (idempotent last-writer-wins). */
export function setResearchWorkerFactory(factory: ResearchWorkerFactory): void {
  _factory = factory;
}

/** The wired factory, or null if none has been injected yet. */
export function getResearchWorkerFactory(): ResearchWorkerFactory | null {
  return _factory;
}

/** Test/teardown reset. */
export function resetResearchWorkerFactory(): void {
  _factory = null;
}
