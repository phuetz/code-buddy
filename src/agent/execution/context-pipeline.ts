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
 *   3. `injectNextRoundContext` — subsequent rounds (lessons + CKG when the
 *      collective-memory flag is on, KG when query is complex, todo suffix always)
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
import {
  getInjectionLevel,
  type ContextInjectionLevel,
  type QueryComplexity,
} from './query-classifier.js';
import { classifyLisaIntrospection } from '../../identity/lisa-introspection.js';
import type { CompanionRuntimeEvidence } from '../../identity/operational-self-model.js';

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

type OptionalContextBlock = CodeBuddyMessage | null;
export const TRUNCATED_TOOL_OUTPUT_STUB = '[output tronqué pour tenir dans le contexte]';
const MIN_SLIMMABLE_TOOL_OUTPUT_CHARS = 512;

/** True when the provider transcript is not already in canonical call/result order. */
export function transcriptNeedsToolRepair(messages: readonly CodeBuddyMessage[]): boolean {
  const seenCallIds = new Set<string>();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === 'tool') return true;
    const calls = 'tool_calls' in message && Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [];
    if (calls.length === 0) continue;

    for (let callIndex = 0; callIndex < calls.length; callIndex++) {
      const callId = calls[callIndex]?.id;
      if (!callId || seenCallIds.has(callId)) return true;
      seenCallIds.add(callId);
      const result = messages[index + callIndex + 1];
      if (
        result?.role !== 'tool' ||
        (result as { tool_call_id?: string }).tool_call_id !== callId
      ) {
        return true;
      }
    }
    index += calls.length;
  }
  return false;
}

function contextThresholdExceeded(
  contextManager: ContextManagerV2,
  messages: CodeBuddyMessage[],
): boolean {
  try {
    if (
      typeof contextManager.shouldAutoCompact !== 'function' ||
      typeof contextManager.getStats !== 'function'
    ) {
      return true;
    }
    const stats = contextManager.getStats(messages);
    return contextManager.shouldAutoCompact(messages) || stats.isNearLimit;
  } catch {
    // Preserve the old full-preparation path for partial host test doubles and
    // third-party context managers whose budget inspection failed.
    return true;
  }
}

/**
 * Replace old, large tool observations first until the context is back below
 * its compaction threshold. Message identity fields, especially
 * `tool_call_id`, are preserved verbatim.
 */
export function slimToolResultsToFit(
  contextManager: ContextManagerV2,
  messages: CodeBuddyMessage[],
): CodeBuddyMessage[] {
  if (!contextThresholdExceeded(contextManager, messages)) return messages;
  let result: CodeBuddyMessage[] | null = null;

  for (let index = 0; index < messages.length; index++) {
    const source = (result ?? messages)[index];
    if (
      source?.role !== 'tool' ||
      typeof source.content !== 'string' ||
      source.content.length < MIN_SLIMMABLE_TOOL_OUTPUT_CHARS ||
      source.content === TRUNCATED_TOOL_OUTPUT_STUB
    ) {
      continue;
    }

    if (!result) result = [...messages];
    result[index] = { ...source, content: TRUNCATED_TOOL_OUTPUT_STUB } as CodeBuddyMessage;
    if (!contextThresholdExceeded(contextManager, result)) return result;
  }

  return result ?? messages;
}

/** Run one best-effort context provider without delaying or failing its siblings. */
async function buildOptionalContextBlock(
  enabled: boolean | undefined,
  build: () => OptionalContextBlock | Promise<OptionalContextBlock>
): Promise<OptionalContextBlock> {
  if (!enabled) return null;
  try {
    return await build();
  } catch {
    return null;
  }
}

/**
 * Phase 1 — Slim large observations, compact only if still necessary, and
 * repair only when the transcript is dirty. The canonical fast path returns
 * the original array without replaying compaction or transcript repair.
 */
export function prepareTurnMessages(
  contextManager: ContextManagerV2,
  messages: CodeBuddyMessage[],
  options: { isolatedSharedHost?: boolean } = {},
): CodeBuddyMessage[] {
  const dirty = transcriptNeedsToolRepair(messages);
  const thresholdExceeded = contextThresholdExceeded(contextManager, messages);
  const hasContextEngine = !options.isolatedSharedHost &&
    typeof contextManager.getContextEngine === 'function' &&
    contextManager.getContextEngine() !== null;

  if (!dirty && !thresholdExceeded && !hasContextEngine) return [...messages];

  const slimmed = thresholdExceeded
    ? slimToolResultsToFit(contextManager, messages)
    : messages;
  const stillOverThreshold = thresholdExceeded &&
    contextThresholdExceeded(contextManager, slimmed);
  const prepared = stillOverThreshold || hasContextEngine
    ? options.isolatedSharedHost
      ? contextManager.prepareMessagesRaw(slimmed)
      : contextManager.prepareMessages(slimmed)
    : slimmed;

  if (transcriptNeedsToolRepair(prepared)) return repairToolCallPairs(prepared);
  return prepared === messages ? [...prepared] : prepared;
}

/**
 * Repair only the explicitly supplied turn, bypassing ContextManager and any
 * plugin ContextEngine. Used by core-only self-inspection where even a local
 * plugin must not inject workspace, memory, or cross-session content.
 */
export function prepareIsolatedTurnMessages(
  messages: CodeBuddyMessage[],
): CodeBuddyMessage[] {
  return transcriptNeedsToolRepair(messages)
    ? repairToolCallPairs(messages)
    : [...messages];
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
  messages: CodeBuddyMessage[],
  options: { isolatedSharedHost?: boolean } = {},
): boolean {
  const compacted = prepareTurnMessages(contextManager, messages, options);
  if (compacted === messages) return false;
  const changed =
    compacted.length !== messages.length || compacted.some((m, i) => m !== messages[i]);
  if (!changed) return false;
  messages.splice(0, messages.length, ...compacted);
  return true;
}

export interface InitialContextDeps {
  message: string;
  /** Exact current utterance when `message` also contains transport history. */
  introspectionText?: string;
  cwd: string;
  ctxLevel: ContextInjectionLevel;
  loadWorkspaceContext: (cwd: string) => Promise<string>;
  decisionContextProvider: ((q: string) => Promise<string | null>) | null;
  icmBridgeProvider: (() => ICMBridgeLike | null) | null;
  codeGraphContextProvider: ((msg: string) => string | null) | null;
  docsContextProvider?: ((msg: string) => string | null) | null;
  /** Verified metadata for the active turn; omitted values remain unknown. */
  operationalRuntime?: CompanionRuntimeEvidence;
  /** Validated active companion display name, if the host has one. */
  operationalRobotName?: string;
  /** Exclude process-global mutable memories on a shared HTTP host. */
  isolatedSharedHost?: boolean;
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
  const introspectionIntent = classifyLisaIntrospection(
    deps.introspectionText ?? deps.message
  );
  const readOnlySelfInspection =
    introspectionIntent === 'describe' || introspectionIntent === 'inspect';
  const allowMutableSharedContext =
    !readOnlySelfInspection && deps.isolatedSharedHost !== true;
  // Every provider below is independent. Start them together so a slow workspace,
  // memory, or graph lookup contributes at most its own latency instead of making
  // time-to-first-token the sum of all provider latencies. Promise.all preserves
  // this array order, keeping the model-facing context deterministic.
  const blocks = await Promise.all([
    // Collective Knowledge Graph first among extras so compaction of later
    // optional blocks cannot drop the relevance-ranked recall.
    buildOptionalContextBlock(
      allowMutableSharedContext &&
        deps.ctxLevel.collectiveGraph &&
        process.env.CODEBUDDY_COLLECTIVE_MEMORY === 'true',
      async () => {
        const { getCollectiveKnowledgeGraph } = await import('../../memory/collective-knowledge-graph.js');
        const ckgBlock = await getCollectiveKnowledgeGraph().formatCollectiveContext(deps.message, 1_600);
        return ckgBlock ? { role: 'system', content: ckgBlock } : null;
      }
    ),

    buildOptionalContextBlock(!readOnlySelfInspection && deps.ctxLevel.workspace, async () => {
      const wsCtx = await deps.loadWorkspaceContext(deps.cwd);
      return wsCtx ? { role: 'system', content: wsCtx } : null;
    }),

    // Lisa's self-model is an evidence contract, not a prompt-only persona
    // claim. Inject a compact source snapshot on every introspection surface so
    // even a chat-only provider can distinguish implemented/configured/live.
    // Tool-capable providers still receive the root-confined self_describe
    // reader and can deepen the inspection in the normal agent loop.
    buildOptionalContextBlock(introspectionIntent !== null, async () => {
      const { buildOperationalSelfModel } = await import(
        '../../identity/operational-self-model.js'
      );
      const model = buildOperationalSelfModel({
        cwd: deps.cwd,
        focus: deps.introspectionText ?? deps.message,
        depth: introspectionIntent === 'describe' ? 'summary' : 'deep',
        ...(deps.operationalRobotName?.trim()
          ? { robotName: deps.operationalRobotName.trim() }
          : process.env.CODEBUDDY_ROBOT_NAME?.trim()
            ? { robotName: process.env.CODEBUDDY_ROBOT_NAME.trim() }
          : {}),
        runtime: deps.operationalRuntime,
      });
      const effectContract = introspectionIntent === 'improve'
        ? 'Inspect and establish source evidence before proposing a change. Mutations remain subject to the active permission/write gates and must be tested.'
        : 'The model-invoked inspection tool surface is strictly read-only: no code/file modification, command execution, or outbound messaging tool is available. Internal transcript, recovery, metrics, and policy bookkeeping may still be persisted.';
      return {
        role: 'system',
        content:
          `<context type="operational_self_model" intent="${introspectionIntent}" ephemeral="true">\n` +
          `${model.text}\n\n` +
          `${effectContract}\n` +
          'Ground the answer in the relative source paths above. State what was observed, what remains unknown, and never present this operational model as proof of subjective consciousness.\n' +
          '</context>',
      };
    }),

    buildOptionalContextBlock(allowMutableSharedContext && deps.ctxLevel.lessons, () => {
      // Budgeted + ranked against the current message (BM25) — the block used
      // to inject EVERY lesson unconditionally on every turn.
      const lessonsBlock = getLessonsTracker(deps.cwd).buildContextBlock({ query: deps.message });
      return lessonsBlock ? {
        role: 'system',
        content: `<context type="lessons">\n${lessonsBlock}\n</context>`,
      } : null;
    }),

    buildOptionalContextBlock(
      allowMutableSharedContext && isFeatureEnabled('USER_MODEL_INJECTION'),
      () => {
      const userModelSummary = getUserModel(deps.cwd).summarize();
      return userModelSummary ? {
        role: 'system',
        content: `<user_model_context>\n${userModelSummary}\n</user_model_context>`,
      } : null;
      }
    ),

    buildOptionalContextBlock(allowMutableSharedContext && deps.ctxLevel.knowledgeGraph, async () => {
      const { getKnowledgeGraph } = await import('../../memory/knowledge-graph.js');
      const kg = getKnowledgeGraph();
      await kg.load();
      const kgBlock = kg.formatContextBlockSmart(deps.message, 600);
      return kgBlock ? { role: 'system', content: kgBlock } : null;
    }),

    buildOptionalContextBlock(
      allowMutableSharedContext &&
        deps.ctxLevel.decisionMemory &&
        deps.decisionContextProvider !== null,
      async () => {
        const decisionsBlock = await withTimeout(
          deps.decisionContextProvider!(deps.message),
          3000,
          null
        );
        return decisionsBlock ? {
          role: 'system',
          content: `<context type="decision">\n${decisionsBlock}\n</context>`,
        } : null;
      }
    ),

    buildOptionalContextBlock(
      allowMutableSharedContext &&
        deps.ctxLevel.icmMemory &&
        deps.icmBridgeProvider !== null,
      async () => {
        const icm = deps.icmBridgeProvider!();
        if (icm?.isAvailable()) {
          const memories = await withTimeout(
            icm.searchMemory(deps.message, { limit: 3 }),
            3000,
            [] as Array<{ content: string }>
          );
          if (memories.length > 0) {
            const memoryLines = memories.map((m) => `- ${m.content}`).join('\n');
            return {
              role: 'system',
              content: `<context type="memory">\nRelevant cross-session memories:\n${memoryLines}\n</context>`,
            };
          }
        }
        return null;
      }
    ),

    buildOptionalContextBlock(
      allowMutableSharedContext &&
        deps.ctxLevel.codeGraph &&
        deps.codeGraphContextProvider !== null,
      () => {
        const graphCtx = deps.codeGraphContextProvider!(deps.message);
        return graphCtx ? {
          role: 'system',
          content: `<context type="code_graph">\n${graphCtx}\n</context>`,
        } : null;
      }
    ),

    buildOptionalContextBlock(
      allowMutableSharedContext && deps.ctxLevel.docs && deps.docsContextProvider != null,
      () => {
        const docsCtx = deps.docsContextProvider!(deps.message);
        return docsCtx ? {
          role: 'system',
          content: `<context type="docs">\n${docsCtx}\n</context>`,
        } : null;
      }
    ),

    buildOptionalContextBlock(allowMutableSharedContext && deps.ctxLevel.todo, () => {
      const todoSuffix = getTodoTracker(deps.cwd).buildContextSuffix();
      return todoSuffix ? {
        role: 'system',
        content: `<context type="todo">\n${todoSuffix}\n</context>`,
      } : null;
    }),
  ]);

  for (const block of blocks) {
    if (block) preparedMessages.push(block);
  }
}

export interface NextRoundContextDeps {
  message: string;
  /** Exact utterance when the transport embeds prior conversation text. */
  introspectionText?: string;
  cwd: string;
  queryComplexity: QueryComplexity;
  /**
   * When set, overrides the complexity table for CKG injection.
   * Unset → `getInjectionLevel(queryComplexity).collectiveGraph`.
   */
  collectiveGraph?: boolean;
  /** Exclude process-global mutable memories on a shared HTTP host. */
  isolatedSharedHost?: boolean;
}

/** Collective graph: same opt-in as round 0. Unset flag is an explicit no-op. */
async function injectCollectiveGraphIfWanted(
  preparedMessages: CodeBuddyMessage[],
  deps: NextRoundContextDeps,
): Promise<void> {
  const collectiveWanted =
    deps.collectiveGraph ?? getInjectionLevel(deps.queryComplexity).collectiveGraph;
  if (
    deps.isolatedSharedHost ||
    !collectiveWanted ||
    process.env.CODEBUDDY_COLLECTIVE_MEMORY !== 'true'
  ) {
    return;
  }
  try {
    const { getCollectiveKnowledgeGraph } = await import('../../memory/collective-knowledge-graph.js');
    const ckgBlock = await getCollectiveKnowledgeGraph().formatCollectiveContext(deps.message, 1_600);
    if (ckgBlock) {
      preparedMessages.push({ role: 'system', content: ckgBlock });
    }
  } catch { /* collective graph is optional */ }
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
  const introspectionIntent = classifyLisaIntrospection(
    deps.introspectionText ?? deps.message
  );
  if (introspectionIntent === 'describe' || introspectionIntent === 'inspect') {
    // The attested self-model was injected on round 0 and the following round
    // receives the root-confined tool observation. Do not re-open unrelated
    // workspace, lesson, user-model, KG, ICM, code-graph, docs, or todo sources.
    // Collective memory stays opt-in on later rounds even here: skipping it
    // dropped CODEBUDDY_COLLECTIVE_MEMORY=true for self-inspection follow-ups.
    preparedMessages.push({
      role: 'system',
      content:
        '<context type="operational_self_inspection_contract" ephemeral="true">\n' +
        'Use only the attested operational self-model and this turn\'s root-confined tool observations. ' +
        'Do not infer subjective consciousness; it remains not established.\n' +
        '</context>',
    });
    await injectCollectiveGraphIfWanted(preparedMessages, deps);
    return;
  }
  if (deps.isolatedSharedHost) {
    return;
  }
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

  await injectCollectiveGraphIfWanted(preparedMessages, deps);

  // Knowledge graph stays gated on complexity — it can be large and is
  // less universally relevant than lessons. Use the SAME smart formatter as
  // round-0 (formatContextBlockSmart) so the block's shape is consistent across
  // rounds; the singleton was already loaded at round-0 for a complex query.
  if (deps.queryComplexity === 'complex') {
    try {
      const { getKnowledgeGraph } = await import('../../memory/knowledge-graph.js');
      const kg = getKnowledgeGraph();
      const kgBlock = kg.formatContextBlockSmart(deps.message, 600);
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
