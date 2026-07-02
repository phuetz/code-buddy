/**
 * Context Pipeline — extracted per-turn context injections.
 *
 * Both `processUserMessage` (sequential) and `processUserMessageStream`
 * apply the same set of context injections per turn. This module factors
 * those out so the two paths share one source of truth.
 *
 * The pipeline has three phases:
 *   1. `prepareTurnMessages` — compaction + transcript repair (always)
 *   2. `injectInitialContext` — round 0 enrichment (workspace, lessons, KG,
 *      decision memory, ICM memory, code graph)
 *   3. `injectNextRoundContext` — subsequent rounds (lessons + KG when query
 *      is complex, todo suffix always)
 *   4. `sanitizeAssistantOutput` — strip leakage tokens from final text
 *
 * @module agent/execution/context-pipeline
 */

import type { CodeBuddyMessage } from '../../codebuddy/client.js';
import type { ContextManagerV2 } from '../../context/context-manager-v2.js';
import { repairToolCallPairs } from '../../context/transcript-repair.js';
import { sanitizeModelOutput, stripInvisibleChars } from '../../utils/output-sanitizer.js';
import { getLessonsTracker } from '../lessons-tracker.js';
import { getTodoTracker } from '../todo-tracker.js';
import { getUserModel } from '../../memory/user-model.js';
import { isFeatureEnabled } from '../../config/feature-flags.js';
import type { ContextInjectionLevel, QueryComplexity } from './query-classifier.js';

/** Minimal shape of the ICM bridge that this pipeline consumes. */
interface ICMBridgeLike {
  isAvailable(): boolean;
  searchMemory(message: string, opts: { limit: number }): Promise<Array<{ content: string }>>;
}

/** Race a promise against a timeout, returning fallback if it doesn't settle. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise.finally(() => { if (timer) clearTimeout(timer); }),
    new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]);
}

/**
 * Phase 1 — Compact via contextManager + repair orphaned tool_call/tool_result
 * pairs left by compression. Always runs at the start of every turn.
 */
export function prepareTurnMessages(
  contextManager: ContextManagerV2,
  messages: CodeBuddyMessage[]
): CodeBuddyMessage[] {
  return repairToolCallPairs(contextManager.prepareMessages(messages));
}

/**
 * Compact + repair IN PLACE — for mid-loop compaction sites where `messages`
 * is a SHARED reference (the turn loop and its helpers keep pushing into it).
 * `prepareMessages()` is pure and returns a NEW array; the agent-executor
 * call sites that discarded its return value were silent no-ops: the
 * transcript never shrank, the middleware 'compact' action did nothing, and
 * proactive compaction re-fired forever while the provider limit approached.
 * Returns true when the transcript actually changed.
 */
export function compactTurnMessagesInPlace(
  contextManager: ContextManagerV2,
  messages: CodeBuddyMessage[]
): boolean {
  const compacted = prepareTurnMessages(contextManager, messages);
  if (compacted === messages) return false;
  const changed =
    compacted.length !== messages.length || compacted.some((m, i) => m !== messages[i]);
  if (!changed) return false;
  messages.splice(0, messages.length, ...compacted);
  return true;
}

export interface InitialContextDeps {
  message: string;
  cwd: string;
  ctxLevel: ContextInjectionLevel;
  loadWorkspaceContext: (cwd: string) => Promise<string>;
  decisionContextProvider: ((q: string) => Promise<string | null>) | null;
  icmBridgeProvider: (() => ICMBridgeLike | null) | null;
  codeGraphContextProvider: ((msg: string) => string | null) | null;
  docsContextProvider?: ((msg: string) => string | null) | null;
}

/**
 * Phase 2 — Inject round-0 context: workspace, lessons, knowledge graph,
 * decision memory, ICM memory, code graph. Each block is gated by the
 * `ctxLevel` from query classification. Mutates `preparedMessages` in place.
 */
export async function injectInitialContext(
  preparedMessages: CodeBuddyMessage[],
  deps: InitialContextDeps
): Promise<void> {
  if (deps.ctxLevel.workspace) {
    try {
      const wsCtx = await deps.loadWorkspaceContext(deps.cwd);
      if (wsCtx) {
        preparedMessages.push({ role: 'system', content: wsCtx });
      }
    } catch { /* workspace context optional */ }
  }

  if (deps.ctxLevel.lessons) {
    // Budgeted + ranked against the current message (BM25) — the block used
    // to inject EVERY lesson unconditionally on every turn.
    const lessonsBlock = getLessonsTracker(deps.cwd).buildContextBlock({ query: deps.message });
    if (lessonsBlock) {
      preparedMessages.push({
        role: 'system',
        content: `<context type="lessons">\n${lessonsBlock}\n</context>`,
      });
    }
  }

  if (isFeatureEnabled('USER_MODEL_INJECTION')) {
    try {
      const userModelSummary = getUserModel(deps.cwd).summarize();
      if (userModelSummary) {
        preparedMessages.push({
          role: 'system',
          content: `<user_model_context>\n${userModelSummary}\n</user_model_context>`,
        });
      }
    } catch { /* optional */ }
  }

  if (deps.ctxLevel.knowledgeGraph) {
    try {
      const { getKnowledgeGraph } = await import('../../memory/knowledge-graph.js');
      const kg = getKnowledgeGraph();
      await kg.load();
      const kgBlock = kg.formatContextBlockSmart(deps.message, 600);
      if (kgBlock) {
        preparedMessages.push({ role: 'system', content: kgBlock });
      }
    } catch { /* knowledge graph is optional */ }
  }

  // Collective Knowledge Graph — shared cross-agent memory (Phase 0, opt-in & off by default
  // via CODEBUDDY_COLLECTIVE_MEMORY so behavior is unchanged until enabled). Runs in PARALLEL
  // with the per-process graph above; once validated it folds the fragmented blocks into one.
  if (deps.ctxLevel.collectiveGraph && process.env.CODEBUDDY_COLLECTIVE_MEMORY === 'true') {
    try {
      const { getCollectiveKnowledgeGraph } = await import('../../memory/collective-knowledge-graph.js');
      const ckgBlock = await getCollectiveKnowledgeGraph().formatCollectiveContext(deps.message, 600);
      if (ckgBlock) {
        preparedMessages.push({ role: 'system', content: ckgBlock });
      }
    } catch { /* collective graph is optional */ }
  }

  if (deps.ctxLevel.decisionMemory && deps.decisionContextProvider) {
    try {
      const decisionsBlock = await withTimeout(
        deps.decisionContextProvider(deps.message),
        3000,
        null
      );
      if (decisionsBlock) {
        preparedMessages.push({
          role: 'system',
          content: `<context type="decision">\n${decisionsBlock}\n</context>`,
        });
      }
    } catch { /* decision-memory optional */ }
  }

  if (deps.ctxLevel.icmMemory && deps.icmBridgeProvider) {
    try {
      const icm = deps.icmBridgeProvider();
      if (icm?.isAvailable()) {
        const memories = await withTimeout(
          icm.searchMemory(deps.message, { limit: 3 }),
          3000,
          [] as Array<{ content: string }>
        );
        if (memories.length > 0) {
          const memoryLines = memories.map((m) => `- ${m.content}`).join('\n');
          preparedMessages.push({
            role: 'system',
            content: `<context type="memory">\nRelevant cross-session memories:\n${memoryLines}\n</context>`,
          });
        }
      }
    } catch { /* ICM search optional */ }
  }

  if (deps.ctxLevel.codeGraph && deps.codeGraphContextProvider) {
    try {
      const graphCtx = deps.codeGraphContextProvider(deps.message);
      if (graphCtx) {
        preparedMessages.push({
          role: 'system',
          content: `<context type="code_graph">\n${graphCtx}\n</context>`,
        });
      }
    } catch { /* code graph context optional */ }
  }

  if (deps.ctxLevel.docs && deps.docsContextProvider) {
    try {
      const docsCtx = deps.docsContextProvider(deps.message);
      if (docsCtx) {
        preparedMessages.push({
          role: 'system',
          content: `<context type="docs">\n${docsCtx}\n</context>`,
        });
      }
    } catch { /* docs context optional */ }
  }

  if (deps.ctxLevel.todo) {
    const todoSuffix = getTodoTracker(deps.cwd).buildContextSuffix();
    if (todoSuffix) {
      preparedMessages.push({
        role: 'system',
        content: `<context type="todo">\n${todoSuffix}\n</context>`,
      });
    }
  }
}

export interface NextRoundContextDeps {
  message: string;
  cwd: string;
  queryComplexity: QueryComplexity;
}

/**
 * Phase 3 — Inject context for rounds ≥1: lessons + knowledge graph (only
 * when query is `complex`), todo suffix (always). Workspace context is NOT
 * re-injected — it's stable across rounds.
 */
export async function injectNextRoundContext(
  preparedMessages: CodeBuddyMessage[],
  deps: NextRoundContextDeps
): Promise<void> {
  // Always re-inject lessons on rounds >0 — they're stable rules/patterns
  // that remain relevant regardless of complexity. Pre-fix: only `complex`
  // queries kept lessons mid-conversation, so trivial multi-round tasks
  // (e.g. rename a variable across 3 files) lost lessons context after
  // round 0. The complexity gate was the wrong signal — lessons are
  // already content-bounded (autoDecay + buildContextBlock 5s cache).
  // Activated alongside the lessons system-prompt directive shipped in
  // the same commit.
  const lessonsBlock = getLessonsTracker(deps.cwd).buildContextBlock({ query: deps.message });
  if (lessonsBlock) {
    preparedMessages.push({
      role: 'system',
      content: `<context type="lessons">\n${lessonsBlock}\n</context>`,
    });
  }

  if (isFeatureEnabled('USER_MODEL_INJECTION')) {
    try {
      const userModelSummary = getUserModel(deps.cwd).summarize();
      if (userModelSummary) {
        preparedMessages.push({
          role: 'system',
          content: `<user_model_context>\n${userModelSummary}\n</user_model_context>`,
        });
      }
    } catch { /* optional */ }
  }

  // Knowledge graph stays gated on complexity — it can be large and is
  // less universally relevant than lessons.
  if (deps.queryComplexity === 'complex') {
    try {
      const { getKnowledgeGraph } = await import('../../memory/knowledge-graph.js');
      const kg = getKnowledgeGraph();
      const kgBlock = kg.formatContextBlock(deps.message, 600);
      if (kgBlock) {
        preparedMessages.push({ role: 'system', content: kgBlock });
      }
    } catch { /* knowledge graph is optional */ }
  }

  const todoSuffix = getTodoTracker(deps.cwd).buildContextSuffix();
  if (todoSuffix) {
    preparedMessages.push({
      role: 'system',
      content: `<context type="todo">\n${todoSuffix}\n</context>`,
    });
  }
}

/**
 * Phase 4 — Sanitize assistant output: strip model leakage tokens
 * (`<think>`, `<|im_start|>`, `[INST]`, GLM-5/DeepSeek artifacts) and
 * invisible characters. Tests assert sanitized output — do not bypass.
 */
export function sanitizeAssistantOutput(raw: string): string {
  return stripInvisibleChars(sanitizeModelOutput(raw));
}

const FILE_TOOLS_JIT = new Set([
  'view_file',
  'create_file',
  'str_replace_editor',
  'file_read',
  'file_write',
  'read_file',
  'grep',
  'glob',
]);

/**
 * JIT context discovery — load subdirectory context files (CODEBUDDY.md,
 * CONTEXT.md, INSTRUCTIONS.md, AGENTS.md, README.md and their .codebuddy/
 * .claude/ siblings) walking upward from the path the tool just touched.
 *
 * Returns the system messages to push (possibly empty). Both sequential and
 * streaming paths consume this — keep them aligned (task #5 décision #2).
 */
export async function runJitContextDiscovery(toolCall: {
  function: { name: string; arguments?: string };
}): Promise<CodeBuddyMessage[]> {
  if (!FILE_TOOLS_JIT.has(toolCall.function.name)) return [];
  try {
    const args = JSON.parse(toolCall.function.arguments || '{}');
    const filePath = args.path || args.file_path || args.target_file || args.pattern || '';
    if (!filePath) return [];
    const { discoverJitContext } = await import('../../context/jit-context.js');
    const jitContext = discoverJitContext(filePath);
    if (!jitContext) return [];
    return [{ role: 'system', content: jitContext }];
  } catch {
    return [];
  }
}
