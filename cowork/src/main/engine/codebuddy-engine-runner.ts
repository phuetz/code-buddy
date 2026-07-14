/**
 * Code Buddy Engine Runner
 *
 * Implements the AgentRunner interface used by Cowork's SessionManager,
 * delegating to the Code Buddy EngineAdapter for in-process execution.
 * Translates EngineStreamEvents back to Cowork ServerEvent format.
 *
 * @module main/engine/codebuddy-engine-runner
 */

import { v4 as uuidv4 } from 'uuid';
import { log, logError } from '../utils/logger';
import { isBrowserOperatorTool, buildBrowserActionPayload } from './browser-action';
import { getReasoningBridge } from '../reasoning/reasoning-bridge';
import { createReasoningCapture } from '../reasoning/reasoning-capture';
import { configStore } from '../config/config-store';
import {
  CoworkCrossChannelContinuity,
  classifyCoworkCanonicalAttachment,
  normalizeCoworkCanonicalTurn,
  renderCoworkCanonicalTurn,
  type CoworkCanonicalTurn,
} from '../companion/cross-channel-continuity';
import { CoworkCompanionModelRouting } from '../companion/model-routing';
import {
  resolveCoworkModelEgress,
  type CoworkCognitionPort,
  type CoworkCognitiveTurn,
} from '../companion/cognitive-context';
import { loadCoreModule } from '../utils/core-loader';
import type { ContextOptimizationMetadata } from '@codebuddy/shared/context-optimization-metadata';
import { isCompanionThreadTags } from '../../shared/companion-thread';
import type {
  Session,
  Message,
  ServerEvent,
  ContentBlock,
  FileAttachmentContent,
  TextContent,
  ToolUseContent,
  ToolResultContent,
} from '../../renderer/types';

/** Minimal EngineAdapter interface (avoids direct import from Code Buddy src) */
interface EngineAdapter {
  runSession(
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
    onEvent: (event: EngineStreamEvent) => void,
    options?: Record<string, unknown>
  ): Promise<{ content: string; tokenCount?: number; toolCallCount?: number }>;
  cancel(sessionId: string): void;
  replaceLastAssistantResponse?(
    sessionId: string,
    expected: string,
    replacement: string
  ): boolean;
  resumeTranscriptSnapshots?(sessionId: string): void;
  steer?(sessionId: string, prompt: string): boolean | Promise<boolean>;
  clearSession(sessionId: string): void;
  discardSession?(sessionId: string): void;
}

interface EngineStreamEvent {
  type: string;
  content?: string;
  thinking?: string;
  tool?: {
    id: string;
    name: string;
    input?: string;
    output?: string;
    isError?: boolean;
    delta?: string;
    data?: unknown;
    contextOptimization?: ContextOptimizationMetadata;
  };
  tokenCount?: number;
  cost?: { inputTokens: number; outputTokens: number; totalCost: number };
  error?: string;
  askUser?: { question: string; options: string[] };
  planProgress?: {
    taskId: string;
    status: string;
    total: number;
    completed: number;
    message?: string;
  };
  steer?: {
    content: string;
    source: string;
  };
  diffPreview?: { turnId: number; diffs: Array<Record<string, unknown>>; plan?: string };
  goalStatus?: {
    goalId?: string;
    goal: string;
    status: 'active' | 'paused' | 'done' | 'cleared';
    turnsUsed: number;
    maxTurns: number;
    verifyGated?: boolean;
    lastVerdict?: 'done' | 'continue' | 'skipped';
    lastReason?: string;
  };
}

interface TurnCheckpoint {
  id: string;
  commitHash: string;
  description: string;
  timestamp: number;
  turn: number;
}

interface RelationshipSafetyGuard {
  push(delta: string): string[];
  finish(): string[];
  assessment(): { intervened: boolean; issues: string[] };
}

interface CoreRelationshipSafetyModule {
  RelationshipSafetyStreamGuard?: new () => RelationshipSafetyGuard;
}

type RelationshipSafetyLoader = () => Promise<CoreRelationshipSafetyModule | null>;

interface SemanticReviewHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface SemanticReviewCandidate {
  request: string;
  history?: readonly SemanticReviewHistoryTurn[];
}

interface SemanticReviewMainProvider {
  apiKey: string;
  baseURL: string;
  model: string;
  provider?: string;
}

interface SemanticReviewInput extends SemanticReviewCandidate {
  draft: string;
  evidence?: string;
  mainProvider?: SemanticReviewMainProvider;
  signal?: AbortSignal;
}

interface SemanticReviewResult {
  response: string;
}

interface SemanticRuntimeOptions {
  env?: Record<string, string | undefined>;
}

interface CoreSemanticResponseModule {
  shouldReviewSemanticResponse?: (
    input: SemanticReviewCandidate,
    options?: SemanticRuntimeOptions
  ) => boolean;
  reviewSemanticResponse?: (
    input: SemanticReviewInput,
    dependencies?: undefined,
    options?: SemanticRuntimeOptions
  ) => Promise<SemanticReviewResult>;
  /** Privileged settings stay outside critic inputs and renderer telemetry. */
  runtimeEnv?: Record<string, string>;
}

interface CoreAssistantConfigModule {
  readAssistantRuntimeEnv?: () => Record<string, string>;
}

type SemanticResponseLoader = () => Promise<CoreSemanticResponseModule | null>;

const RELATIONSHIP_SAFETY_UNAVAILABLE_REPLY =
  "Je n'arrive pas à vérifier cette réponse avec la barrière relationnelle. Je préfère ne pas l'afficher plutôt que risquer une formulation manipulatrice.";

class UnavailableRelationshipSafetyGuard implements RelationshipSafetyGuard {
  push(_delta: string): string[] {
    return [];
  }

  finish(): string[] {
    return [RELATIONSHIP_SAFETY_UNAVAILABLE_REPLY];
  }

  assessment(): { intervened: boolean; issues: string[] } {
    return { intervened: true, issues: ['guard_unavailable'] };
  }
}

function guardStandaloneCompanionText(
  prototype: RelationshipSafetyGuard,
  value: string,
  unsafeFallback = RELATIONSHIP_SAFETY_UNAVAILABLE_REPLY,
): string {
  const Guard = prototype.constructor as new () => RelationshipSafetyGuard;
  const guard = new Guard();
  const output = [...guard.push(value), ...guard.finish()].join('').trim();
  if (guard.assessment().intervened) return unsafeFallback;
  return output || RELATIONSHIP_SAFETY_UNAVAILABLE_REPLY;
}

/** Derive a safe fallback from the persisted visible message, never from attachment payloads. */
function deriveCoworkCanonicalTurn(currentMessage: Message): CoworkCanonicalTurn {
  const text = currentMessage.content
    .flatMap((block) => block.type === 'text' ? [(block as TextContent).text] : [])
    .join('\n')
    .trim();
  const attachments = currentMessage.content.flatMap((block) =>
    block.type === 'file_attachment' || block.type === 'image'
      ? [{
          kind: block.type === 'image'
            ? classifyCoworkCanonicalAttachment({ image: true })
            : classifyCoworkCanonicalAttachment({
                mimeType: (block as FileAttachmentContent).mimeType,
                filename: (block as FileAttachmentContent).filename,
              }),
        }]
      : [],
  );
  return {
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

/** Callbacks injected by SessionManager */
interface RunnerCallbacks {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage: (message: Message) => void;
  requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string
  ) => Promise<string | null>;
}

/**
 * AgentRunner implementation that delegates to Code Buddy's engine.
 */
export class CodeBuddyEngineRunner {
  private adapter: EngineAdapter;
  private callbacks: RunnerCallbacks;
  private continuity: Pick<CoworkCrossChannelContinuity, 'prepare'> &
    Partial<Pick<CoworkCrossChannelContinuity, 'flush'>>;
  private companionRouting: Pick<CoworkCompanionModelRouting, 'resolve'>;
  private relationshipSafetyLoader: RelationshipSafetyLoader;
  private semanticResponseLoader: SemanticResponseLoader;
  private postProcessingControllers = new Map<string, AbortController>();
  private cognitiveTurns = new Map<string, CoworkCognitiveTurn>();

  constructor(
    adapter: EngineAdapter,
    callbacks: RunnerCallbacks,
    continuity: Pick<CoworkCrossChannelContinuity, 'prepare'> &
      Partial<Pick<CoworkCrossChannelContinuity, 'flush'>> = new CoworkCrossChannelContinuity(),
    companionRouting: Pick<CoworkCompanionModelRouting, 'resolve'> = new CoworkCompanionModelRouting(),
    relationshipSafetyLoader: RelationshipSafetyLoader = () =>
      loadCoreModule<CoreRelationshipSafetyModule>('conversation/relationship-safety.js'),
    semanticResponseLoader: SemanticResponseLoader = async () => {
      const [runtime, assistantConfig] = await Promise.all([
        loadCoreModule<CoreSemanticResponseModule>('conversation/semantic-response-runtime.js'),
        loadCoreModule<CoreAssistantConfigModule>('companion/assistant-config.js'),
      ]);
      if (!runtime) return null;
      return {
        shouldReviewSemanticResponse: runtime.shouldReviewSemanticResponse,
        reviewSemanticResponse: runtime.reviewSemanticResponse,
        runtimeEnv: assistantConfig?.readAssistantRuntimeEnv?.() ?? {},
      };
    },
    private readonly cognition?: CoworkCognitionPort,
  ) {
    this.adapter = adapter;
    this.callbacks = callbacks;
    this.continuity = continuity;
    this.companionRouting = companionRouting;
    this.relationshipSafetyLoader = relationshipSafetyLoader;
    this.semanticResponseLoader = semanticResponseLoader;
  }

  async flush(): Promise<void> {
    await this.continuity.flush?.();
  }

  /**
   * Run a session using the Code Buddy engine.
   * Translates EngineStreamEvents to Cowork ServerEvents.
   */
  async run(
    session: Session,
    enginePrompt: string,
    existingMessages: Message[],
    canonicalTurn?: CoworkCanonicalTurn,
  ): Promise<void> {
    const { sendToRenderer, saveMessage } = this.callbacks;
    const turnStartedAt = Date.now();
    const previousPostProcessing = this.postProcessingControllers.get(session.id);
    previousPostProcessing?.abort();
    // Register this run before awaiting cleanup from the previous one. Barge-in
    // must always have a current controller to abort, even during handover.
    const postProcessingController = new AbortController();
    this.postProcessingControllers.set(session.id, postProcessingController);
    const previousCognitiveTurn = this.cognitiveTurns.get(session.id);
    if (previousCognitiveTurn) {
      this.cognitiveTurns.delete(session.id);
      await previousCognitiveTurn.cancel().catch(() => undefined);
    }
    if (
      postProcessingController.signal.aborted ||
      this.postProcessingControllers.get(session.id) !== postProcessingController
    ) {
      if (this.postProcessingControllers.get(session.id) === postProcessingController) {
        this.postProcessingControllers.delete(session.id);
      }
      return;
    }

    // Notify session is running
    sendToRenderer({
      type: 'session.status',
      payload: { sessionId: session.id, status: 'running' },
    } as ServerEvent);

    // Check if the current user message is already at the end of existingMessages
    const hasUserMessageAtEnd =
      existingMessages.length > 0 &&
      existingMessages[existingMessages.length - 1]?.role === 'user';

    const userMessageId = hasUserMessageAtEnd
      ? existingMessages[existingMessages.length - 1].id
      : uuidv4();
    const currentUserMessage = hasUserMessageAtEnd
      ? existingMessages[existingMessages.length - 1]
      : undefined;
    const companionThread = isCompanionThreadTags(session.tags);
    const derivedTurn = canonicalTurn ?? (
      currentUserMessage ? deriveCoworkCanonicalTurn(currentUserMessage) : undefined
    );
    const safeTurn = normalizeCoworkCanonicalTurn(
      derivedTurn ?? (companionThread ? { text: '' } : { text: enginePrompt }),
    );
    const canonicalPrompt = renderCoworkCanonicalTurn(safeTurn);

    if (!hasUserMessageAtEnd) {
      // Save user message (fallback for tests/standalone runs)
      const userMessage: Message = {
        id: userMessageId,
        sessionId: session.id,
        role: 'user',
        content: [{ type: 'text', text: canonicalPrompt } as TextContent],
        timestamp: Date.now(),
      };
      saveMessage(userMessage);
    }

    // Filter out the current user message to avoid duplicate context assembly
    const historyMessages = hasUserMessageAtEnd
      ? existingMessages.slice(0, -1)
      : existingMessages;

    // Local transcript conversion is synchronous. The safety checkpoint,
    // active persona, and explicit Lisa-thread rendezvous are independent and
    // begin together so continuity never adds a serial first-token waterfall.
    const localEngineMessages = this.convertMessages(historyMessages, enginePrompt);
    const localRoutingHistory = localEngineMessages
      .slice(0, -1)
      .flatMap((message): Array<{ role: 'user' | 'assistant'; content: string }> =>
        message.role === 'user' || message.role === 'assistant'
          ? [{ role: message.role, content: message.content }]
          : [],
      );
    const runtimeConfig = session.intelligence?.configSetId
      ? configStore.getConfigForSet(session.intelligence.configSetId)
      : configStore.getAll();
    const prepareTurn = () => Promise.all([
      this.createTurnCheckpoint(session, canonicalPrompt),
      this.resolveActivePersonaPrompt(),
      // The continuity adapter receives history plus the canonical turn only.
      // The current engine message may contain private attachment excerpts and
      // must remain confined to the adapter request assembled below.
      this.continuity.prepare(
        session,
        localEngineMessages.slice(0, -1),
        safeTurn,
        userMessageId,
      ),
      this.companionRouting.resolve(session, canonicalPrompt, runtimeConfig, localRoutingHistory),
      this.createRelationshipSafetyGuard(session),
      this.loadSemanticResponseModule(session),
    ] as const);
    let preparation: Awaited<ReturnType<typeof prepareTurn>>;
    try {
      preparation = await prepareTurn();
    } catch (error) {
      // Preparation happens before the main run try/finally. Close the same
      // lifecycle boundary here so a rejected checkpoint/persona/continuity
      // promise cannot leave a stale cancellation controller or a permanent
      // `running` renderer state behind.
      postProcessingController.abort();
      if (this.postProcessingControllers.get(session.id) === postProcessingController) {
        this.postProcessingControllers.delete(session.id);
      }
      sendToRenderer({
        type: 'session.status',
        payload: { sessionId: session.id, status: 'idle' },
      } as ServerEvent);
      throw error;
    }
    const [
      snapshot,
      personaPrompt,
      sharedContinuity,
      companionRoute,
      relationshipSafety,
      semanticResponseModule,
    ] = preparation;
    if (postProcessingController.signal.aborted) {
      this.discardEngineSession(session.id);
      if (this.postProcessingControllers.get(session.id) === postProcessingController) {
        this.postProcessingControllers.delete(session.id);
      }
      sendToRenderer({
        type: 'session.status',
        payload: { sessionId: session.id, status: 'idle' },
      } as ServerEvent);
      return;
    }
    const engineMessages = sharedContinuity.active
      ? [...sharedContinuity.messages, ...localEngineMessages]
      : localEngineMessages;
    const systemPromptAppend = [personaPrompt, sharedContinuity.systemPrompt]
      .filter((part): part is string => Boolean(part?.trim()))
      .join('\n\n') || undefined;
    const effectiveModel = companionRoute?.model ?? session.model ?? runtimeConfig.model;
    const effectiveApiKey = companionRoute?.apiKey ?? runtimeConfig.apiKey;
    const effectiveBaseURL = companionRoute?.baseURL ?? runtimeConfig.baseUrl;
    let cognitiveTurn: CoworkCognitiveTurn | null = null;
    if (companionThread && this.cognition) {
      try {
        cognitiveTurn = await this.cognition.begin({
          sessionId: session.id,
          messageId: userMessageId,
          query: canonicalPrompt,
          egress: resolveCoworkModelEgress(companionRoute?.egress, effectiveBaseURL),
        });
      } catch {
        // Cognition enriches a turn but never owns dialogue availability. Keep
        // provider errors and potentially private fragments out of logs.
        log('[CoworkCognition] context unavailable', { sessionId: session.id });
      }
    }
    if (cognitiveTurn) this.cognitiveTurns.set(session.id, cognitiveTurn);
    if (postProcessingController.signal.aborted) {
      if (this.cognitiveTurns.get(session.id) === cognitiveTurn) {
        this.cognitiveTurns.delete(session.id);
      }
      await cognitiveTurn?.cancel().catch(() => undefined);
      this.discardEngineSession(session.id);
      if (this.postProcessingControllers.get(session.id) === postProcessingController) {
        this.postProcessingControllers.delete(session.id);
      }
      sendToRenderer({
        type: 'session.status',
        payload: { sessionId: session.id, status: 'idle' },
      } as ServerEvent);
      return;
    }
    const turnContext = [
      sharedContinuity.turnContext?.trim(),
      cognitiveTurn?.turnContext.trim(),
      cognitiveTurn?.evidence.trim(),
    ].filter((part): part is string => Boolean(part)).join('\n\n') || undefined;
    const semanticHistory = this.buildSemanticReviewHistory(
      sharedContinuity.messages,
      historyMessages,
    );
    const semanticReviewCandidate: SemanticReviewCandidate = {
      request: canonicalPrompt,
      ...(semanticHistory.length > 0 ? { history: semanticHistory } : {}),
    };
    // Cognition was projected for the main route. The semantic reviewer can
    // independently select another provider, so only its pre-qualified fresh
    // evidence may cross that separate model boundary.
    const semanticEvidence = sharedContinuity.freshEvidence?.trim() || undefined;
    const semanticRuntimeOptions: SemanticRuntimeOptions | undefined = semanticResponseModule
      ? { env: { ...process.env, ...(semanticResponseModule.runtimeEnv ?? {}) } }
      : undefined;
    const semanticMainProvider: SemanticReviewMainProvider | undefined =
      effectiveModel && effectiveBaseURL
        ? {
            apiKey: effectiveApiKey ?? '',
            baseURL: effectiveBaseURL,
            model: effectiveModel,
            ...(companionRoute?.provider ? { provider: companionRoute.provider } : {}),
          }
        : undefined;
    let semanticReviewPending = false;
    if (
      companionThread &&
      semanticResponseModule?.shouldReviewSemanticResponse &&
      semanticResponseModule.reviewSemanticResponse
    ) {
      try {
        semanticReviewPending = semanticResponseModule.shouldReviewSemanticResponse(
          semanticReviewCandidate,
          semanticRuntimeOptions,
        );
      } catch {
        // Preflight is deliberately fail-open. No engine/private prompt is logged.
        semanticReviewPending = false;
      }
    }
    if (companionRoute) {
      log('[EngineRunner] evidence-backed companion route', {
        sessionId: session.id,
        profileId: companionRoute.profileId,
        lane: companionRoute.lane,
        model: companionRoute.model,
        provider: companionRoute.provider,
      });
    }
    if (snapshot) {
      sendToRenderer({
        type: 'checkpoint.created',
        payload: {
          sessionId: session.id,
          snapshot,
        },
      } as ServerEvent);
    }

    let fullContent = '';
    let runtimeError: string | null = null;
    const contentBlocks: ContentBlock[] = [];
    // Per-tool start timestamps → real step duration in the Flight Plan panel
    // (Phase 2). Keyed by tool-use id; set on tool_start, read+cleared on tool_end.
    const toolStartTimes = new Map<string, number>();
    const reasoningCapture = createReasoningCapture({
      bridge: getReasoningBridge(),
      toolUseId: `${session.id}:reasoning:${userMessageId}`,
      sessionId: session.id,
      problem: canonicalPrompt,
      mode: effectiveModel ?? 'embedded',
    });
    const engineStartedAt = Date.now();
    let firstVisibleEventRecorded = false;
    let relationshipSafetyFinished = false;
    let streamDoneEmitted = false;
    const recordFirstVisibleEvent = (eventType: string): void => {
      if (firstVisibleEventRecorded) return;
      firstVisibleEventRecorded = true;
      session.intelligence = {
        ...(session.intelligence ?? {
          thinkingLevel: runtimeConfig.thinkingLevel ?? 'off',
          fastMode: false,
          executionLocation: 'local',
          latencyBudgetMs: 900,
        }),
        cacheState: 'warm',
        lastLatency: {
          setupMs: engineStartedAt - turnStartedAt,
          firstTokenMs: Date.now() - turnStartedAt,
          measuredAt: Date.now(),
          configSetId: session.intelligence?.configSetId,
          model: effectiveModel,
        },
      };
      log('[EngineRunner] first visible stream event', {
        sessionId: session.id,
        setupMs: engineStartedAt - turnStartedAt,
        engineMs: Date.now() - engineStartedAt,
        totalMs: Date.now() - turnStartedAt,
        eventType,
      });
    };
    const emitRendererContent = (delta: string): void => {
      if (!delta) return;
      recordFirstVisibleEvent('content');
      sendToRenderer({
        type: 'stream.partial',
        payload: { sessionId: session.id, delta },
      });
    };
    const appendRelationshipSafeContent = (delta: string): void => {
      if (!delta) return;
      fullContent += delta;
      if (!semanticReviewPending) emitRendererContent(delta);
    };
    const emitStreamDone = (): void => {
      if (streamDoneEmitted) return;
      streamDoneEmitted = true;
      sendToRenderer({
        type: 'stream.done',
        payload: { sessionId: session.id },
      } as ServerEvent);
    };
    const finishRelationshipSafety = (): void => {
      if (!relationshipSafety || relationshipSafetyFinished) return;
      relationshipSafetyFinished = true;
      for (const delta of relationshipSafety.finish()) appendRelationshipSafeContent(delta);
      const assessment = relationshipSafety.assessment();
      if (assessment.intervened) {
        log('[EngineRunner] relationship safety gate intervened', {
          sessionId: session.id,
          issues: assessment.issues,
        });
      }
    };
    try {
      await this.adapter.runSession(
        session.id,
        engineMessages,
        (event: EngineStreamEvent) => {
          if (postProcessingController.signal.aborted) return;
          if (
            event.type === 'tool_start' ||
            (event.type === 'thinking' && !relationshipSafety)
          ) {
            recordFirstVisibleEvent(event.type);
          }
          switch (event.type) {
            case 'content':
              if (event.content) {
                const deltas = relationshipSafety
                  ? relationshipSafety.push(event.content)
                  : [event.content];
                for (const delta of deltas) appendRelationshipSafeContent(delta);
              }
              break;

            case 'thinking':
              // Raw reasoning is uncommitted model text and has not passed the
              // relationship gate. Keep it private on companion threads.
              if (event.thinking && !relationshipSafety) {
                reasoningCapture.push(event.thinking);
                sendToRenderer({
                  type: 'stream.thinking',
                  payload: { sessionId: session.id, delta: event.thinking },
                });
              }
              break;

            case 'tool_start':
              if (event.tool) {
                const visibleToolInput = relationshipSafety
                  ? JSON.stringify({ redacted: 'companion-safety' })
                  : event.tool.input;
                const step = {
                  id: event.tool.id,
                  type: 'tool_call' as const,
                  status: 'running' as const,
                  title: event.tool.name,
                  toolName: event.tool.name,
                  toolInput: visibleToolInput ? tryParseJSON(visibleToolInput) : undefined,
                  timestamp: Date.now(),
                };
                sendToRenderer({
                  type: 'trace.step',
                  payload: { sessionId: session.id, step },
                } as ServerEvent);
                toolStartTimes.set(event.tool.id, step.timestamp);

                // Add tool_use content block
                contentBlocks.push({
                  type: 'tool_use',
                  id: event.tool.id,
                  name: event.tool.name,
                  input: visibleToolInput ? tryParseJSON(visibleToolInput) : {},
                } as ToolUseContent);
              }
              break;

            case 'tool_end':
              if (event.tool) {
                const visibleToolInput = relationshipSafety
                  ? JSON.stringify({ redacted: 'companion-safety' })
                  : event.tool.input;
                const visibleToolOutput = relationshipSafety
                  ? 'Résultat traité en interne par Lisa.'
                  : event.tool.output;
                const visibleToolData = relationshipSafety ? undefined : event.tool.data;
                const startedAt = toolStartTimes.get(event.tool.id);
                const duration = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
                toolStartTimes.delete(event.tool.id);
                sendToRenderer({
                  type: 'trace.update',
                  payload: {
                    sessionId: session.id,
                    stepId: event.tool.id,
                    updates: {
                      status: event.tool.isError ? 'error' : 'completed',
                      toolOutput: visibleToolOutput,
                      isError: event.tool.isError,
                      duration,
                    },
                  },
                });

                // Add tool_result content block
                contentBlocks.push({
                  type: 'tool_result',
                  toolUseId: event.tool.id,
                  content: visibleToolOutput || '',
                  isError: event.tool.isError,
                  ...(visibleToolData !== undefined ? { data: visibleToolData } : {}),
                  ...(event.tool.contextOptimization
                    ? { contextOptimization: event.tool.contextOptimization }
                    : {}),
                } as ToolResultContent);

                // Phase 2 step 13: emit gui.action events for Computer Use overlay.
                if (isGuiOperateTool(event.tool.name)) {
                  emitGuiActionEvent(
                    sendToRenderer,
                    session.id,
                    event.tool.id,
                    event.tool.name,
                    visibleToolInput,
                    visibleToolData
                  );
                }

                // S2: emit browser.action events for the Browser Operator overlay.
                if (isBrowserOperatorTool(event.tool.name)) {
                  sendToRenderer({
                    type: 'browser.action',
                    payload: buildBrowserActionPayload({
                      sessionId: session.id,
                      toolUseId: event.tool.id,
                      toolName: event.tool.name,
                      rawInput: visibleToolInput,
                      data: visibleToolData,
                      output: visibleToolOutput,
                    }),
                  });
                }
              }
              break;

            case 'tool_stream':
              if (event.tool?.delta && !relationshipSafety) {
                sendToRenderer({
                  type: 'trace.update',
                  payload: {
                    sessionId: session.id,
                    stepId: event.tool.id,
                    // Delta, not replacement — the store concatenates
                    // toolOutputDelta onto the accumulated toolOutput.
                    updates: { toolOutputDelta: event.tool.delta },
                  },
                });
              }
              break;

            case 'token_count':
              if (event.tokenCount !== undefined) {
                sendToRenderer({
                  type: 'session.contextInfo',
                  payload: { sessionId: session.id, contextWindow: event.tokenCount },
                });
              }
              break;

            case 'ask_user':
              if (event.askUser) {
                const stepId = `ask_user_${Date.now()}`;
                const visibleQuestion = relationshipSafety
                  ? guardStandaloneCompanionText(
                      relationshipSafety,
                      event.askUser.question,
                      'Peux-tu préciser ce que tu souhaites faire ensuite ?',
                    )
                  : event.askUser.question;
                const inputData = { 
                  questions: [ 
                    { 
                      question: visibleQuestion,
                      options: event.askUser.options?.map((option, index) => ({
                        label: relationshipSafety
                          ? guardStandaloneCompanionText(
                              relationshipSafety,
                              option,
                              `Option ${index + 1}`,
                            )
                          : option,
                      })),
                    } 
                  ] 
                };

                sendToRenderer({
                  type: 'trace.step',
                  payload: { 
                    sessionId: session.id, 
                    step: {
                        id: stepId,
                        type: 'tool_call',
                        status: 'completed',
                        title: 'AskUserQuestion',
                        toolName: 'AskUserQuestion',
                        toolInput: inputData,
                        timestamp: Date.now()
                    }
                  },
                } as ServerEvent);

                contentBlocks.push({
                  type: 'tool_use',
                  id: stepId,
                  name: 'AskUserQuestion',
                  input: inputData,
                } as ToolUseContent);
              }
              break;

            case 'diff_preview':
              if (event.diffPreview) {
                sendToRenderer({
                  type: 'diff.preview',
                  payload: {
                    sessionId: session.id,
                    diffPreview: {
                      turnId: event.diffPreview.turnId ?? 0,
                      sessionId: session.id,
                      diffs: (event.diffPreview.diffs || []).map((d: Record<string, unknown>) => ({
                        path: String(d.path || ''),
                        action: String(d.action || 'modify') as
                          | 'create'
                          | 'modify'
                          | 'delete'
                          | 'rename',
                        linesAdded: Number(d.linesAdded || 0),
                        linesRemoved: Number(d.linesRemoved || 0),
                        excerpt: String(d.excerpt || ''),
                      })),
                      plan: event.diffPreview.plan as string | undefined,
                      timestamp: Date.now(),
                      status: 'pending' as const,
                    },
                  },
                } as ServerEvent);
              }
              break;

            case 'steer':
              if (event.steer) {
                sendToRenderer({
                  type: 'trace.step',
                  payload: {
                    sessionId: session.id,
                    step: {
                      id: `steer_${Date.now()}`,
                      type: 'thinking',
                      status: 'completed',
                      title: 'Guidance received',
                      content: event.steer.content,
                      timestamp: Date.now(),
                    },
                  },
                } as ServerEvent);
              }
              break;

            case 'goal_status':
              if (event.goalStatus) {
                sendToRenderer({
                  type: 'goal.status',
                  payload: { sessionId: session.id, goal: event.goalStatus },
                } as ServerEvent);
              }
              break;

            case 'done':
              finishRelationshipSafety();
              if (!semanticReviewPending) emitStreamDone();
              break;

            case 'error':
              runtimeError = event.error || 'Unknown error';
              sendToRenderer({
                type: 'error',
                payload: { message: runtimeError, sessionId: session.id },
              } as ServerEvent);
              break;
          }
        },
        {
          workingDirectory: session.cwd,
          apiKey: effectiveApiKey,
          baseURL: effectiveBaseURL,
          model: effectiveModel,
          thinkingLevel: session.intelligence?.thinkingLevel,
          permissionMode: session.permissionModeOverride ?? session.permissionMode ?? 'default',
          systemPromptAppend,
          ...(turnContext ? { currentTurnContext: turnContext } : {}),
          ...(relationshipSafety ? { relationshipSafety: true } : {}),
          ...(semanticReviewPending ? { bufferAssistantResponse: true } : {}),
        }
      );
      if (postProcessingController.signal.aborted) {
        this.discardEngineSession(session.id);
        return;
      }
      finishRelationshipSafety();
      session.intelligence = {
        ...(session.intelligence ?? {
          thinkingLevel: runtimeConfig.thinkingLevel ?? 'off',
          fastMode: false,
          executionLocation: 'local',
          latencyBudgetMs: 900,
        }),
        lastLatency: {
          ...session.intelligence?.lastLatency,
          totalMs: Date.now() - turnStartedAt,
          measuredAt: Date.now(),
          configSetId: session.intelligence?.configSetId,
          model: effectiveModel,
        },
      };
      log('[EngineRunner] turn options', { sessionId: session.id, cwd: session.cwd ?? '(undefined)' });

      if (runtimeError && !fullContent && contentBlocks.length === 0) {
        fullContent = `**Error**: ${runtimeError}`;
      }

      if (semanticReviewPending) {
        if (!runtimeError && fullContent.trim() && semanticResponseModule?.reviewSemanticResponse) {
          try {
            const reviewedDraft = fullContent;
            const result = await semanticResponseModule.reviewSemanticResponse(
              {
                ...semanticReviewCandidate,
                draft: reviewedDraft,
                ...(semanticEvidence ? { evidence: semanticEvidence } : {}),
                ...(semanticMainProvider ? { mainProvider: semanticMainProvider } : {}),
                signal: postProcessingController.signal,
              },
              undefined,
              semanticRuntimeOptions
            );
            if (typeof result.response === 'string' && result.response.trim()) {
              // A semantic reviser is another model boundary. Its output must
              // pass a fresh relationship guard before crossing IPC or memory.
              fullContent = relationshipSafety
                ? guardStandaloneCompanionText(relationshipSafety, result.response)
                : result.response;
            }
            if (postProcessingController.signal.aborted) {
              this.discardEngineSession(session.id);
              return;
            }
            if (fullContent !== reviewedDraft) {
              let historyReplaced = false;
              try {
                historyReplaced =
                  this.adapter.replaceLastAssistantResponse?.(
                    session.id,
                    reviewedDraft,
                    fullContent,
                  ) === true;
              } catch {
                historyReplaced = false;
              }
              if (!historyReplaced) {
                // Rebuild from Cowork's accepted transcript on the next turn;
                // never retain a rejected draft in a warm agent.
                this.discardEngineSession(session.id);
                log('[EngineRunner] semantic rewrite evicted warm session', {
                  sessionId: session.id,
                });
              }
            }
            log('[EngineRunner] semantic response gate completed', {
              sessionId: session.id,
              revised: fullContent !== reviewedDraft,
            });
          } catch {
            // The shared runtime is fail-open. Keep the relationship-safe draft
            // without exposing prompts, critic output, or provider errors.
            log('[EngineRunner] semantic response gate unavailable', {
              sessionId: session.id,
            });
          }
        }
        if (postProcessingController.signal.aborted) {
          this.discardEngineSession(session.id);
          return;
        }
        // Nothing from the candidate draft has crossed IPC yet. Emit exactly
        // the accepted/revised text, then close the stream once.
        emitRendererContent(fullContent);
        emitStreamDone();
      }

      // Save assistant message
      const assistantContent: ContentBlock[] = [];
      if (fullContent) {
        assistantContent.push({ type: 'text', text: fullContent } as TextContent);
      }
      assistantContent.push(...contentBlocks);

      const assistantMessageId = uuidv4();
      const assistantMessage: Message = {
        id: assistantMessageId,
        sessionId: session.id,
        role: 'assistant',
        content:
          assistantContent.length > 0
            ? assistantContent
            : [{ type: 'text', text: fullContent || '' } as TextContent],
        timestamp: Date.now(),
      };
      saveMessage(assistantMessage);
      if (!runtimeError && fullContent.trim()) {
        try {
          await cognitiveTurn?.complete(fullContent);
        } catch (error) {
          // The visible response is already durable. A failed commit is
          // uncertain; never release and re-inject that context.
          logError('[CoworkCognition] post-save commit uncertain', error);
        }
      } else {
        await cognitiveTurn?.fail().catch(() => undefined);
      }
      if (!runtimeError && fullContent.trim()) {
        sharedContinuity.recordAssistant(assistantMessageId, fullContent);
      }

      // Send final message
      sendToRenderer({
        type: 'stream.message',
        payload: {
          sessionId: session.id,
          message: assistantMessage,
        },
      } as ServerEvent);
    } catch (error) {
      await cognitiveTurn?.fail().catch(() => undefined);
      if (postProcessingController.signal.aborted) {
        this.discardEngineSession(session.id);
        return;
      }
      logError('[CodeBuddyEngineRunner] session error', error);
      sendToRenderer({
        type: 'error',
        payload: {
          message: error instanceof Error ? error.message : String(error),
          sessionId: session.id,
        },
      } as ServerEvent);
    } finally {
      await cognitiveTurn?.fail().catch(() => undefined);
      if (this.cognitiveTurns.get(session.id) === cognitiveTurn) {
        this.cognitiveTurns.delete(session.id);
      }
      if (semanticReviewPending) {
        this.adapter.resumeTranscriptSnapshots?.(session.id);
      }
      if (this.postProcessingControllers.get(session.id) === postProcessingController) {
        this.postProcessingControllers.delete(session.id);
      }
      reasoningCapture.complete(fullContent || undefined);
      // Notify session is idle
      sendToRenderer({
        type: 'session.status',
        payload: { sessionId: session.id, status: 'idle' },
      } as ServerEvent);
    }
  }

  /**
   * Cancel a running session — aborts the in-flight agent turn via the engine
   * adapter (which propagates the AbortSignal to the Code Buddy client).
   *
   * Reached from barge-in: renderer `interruptSpeech('barge_in')` → the
   * `useBargeInTurnCancel` listener → `useIPC.stopSession` → `session.stop` →
   * `SessionManager.stopSession` → here. never-throws so a barge-in with no
   * running turn (or a flaky adapter) can't crash the main process.
   */
  cancel(sessionId: string): void {
    try {
      this.postProcessingControllers.get(sessionId)?.abort();
      const cognitiveTurn = this.cognitiveTurns.get(sessionId);
      this.cognitiveTurns.delete(sessionId);
      void cognitiveTurn?.cancel().catch(() => undefined);
      this.adapter.cancel(sessionId);
      log('[CodeBuddyEngineRunner] cancelled', sessionId);
    } catch (error) {
      logError('[CodeBuddyEngineRunner] cancel failed', error);
    }
  }

  private discardEngineSession(sessionId: string): void {
    if (this.adapter.discardSession) {
      this.adapter.discardSession(sessionId);
    } else {
      this.adapter.clearSession(sessionId);
    }
  }

  /**
   * Clear session state.
   */
  clearSdkSession(sessionId: string): void {
    this.postProcessingControllers.get(sessionId)?.abort();
    this.postProcessingControllers.delete(sessionId);
    const cognitiveTurn = this.cognitiveTurns.get(sessionId);
    this.cognitiveTurns.delete(sessionId);
    void cognitiveTurn?.cancel().catch(() => undefined);
    this.adapter.clearSession(sessionId);
    log('[CodeBuddyEngineRunner] cleared', sessionId);
  }

  /**
   * Convert Cowork messages to engine format.
   * Preserves tool_use/tool_result context as text annotations
   * so the engine can understand prior tool interactions.
   */
  private convertMessages(
    messages: Message[],
    currentPrompt: string
  ): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      const parts: string[] = [];
      let imageCount = 0;

      for (const block of msg.content) {
        switch (block.type) {
          case 'text':
            parts.push((block as TextContent).text);
            break;
          case 'image':
            // Phase 3 step 3: surface pasted images as markers so the agent
            // can reason about their presence even when the underlying
            // adapter can't pass multi-modal content through yet.
            imageCount++;
            break;
          case 'tool_use': {
            const tu = block as ToolUseContent;
            parts.push(`[Tool call: ${tu.name}(${JSON.stringify(tu.input)})]`);
            break;
          }
          case 'tool_result': {
            const tr = block as ToolResultContent;
            const status = tr.isError ? 'error' : 'success';
            const preview = tr.content.length > 500 ? tr.content.slice(0, 500) + '...' : tr.content;
            parts.push(`[Tool result (${status}): ${preview}]`);
            break;
          }
          case 'thinking':
            // Thinking blocks are internal — skip
            break;
        }
      }

      if (imageCount > 0) {
        parts.unshift(`[User attached ${imageCount} image(s)]`);
      }

      const content = parts.join('\n');
      if (content) {
        result.push({ role: msg.role, content });
      }
    }

    // Add current prompt
    result.push({ role: 'user', content: currentPrompt });

    return result;
  }

  private async createRelationshipSafetyGuard(
    session: Session,
  ): Promise<RelationshipSafetyGuard | null> {
    if (!isCompanionThreadTags(session.tags)) return null;
    try {
      const module = await this.relationshipSafetyLoader();
      if (module?.RelationshipSafetyStreamGuard) {
        return new module.RelationshipSafetyStreamGuard();
      }
    } catch (error) {
      logError('[EngineRunner] relationship safety gate failed to load', error);
    }
    // Companion output fails closed. Ordinary coding sessions never enter this
    // branch and keep their existing direct stream.
    return new UnavailableRelationshipSafetyGuard();
  }

  private async loadSemanticResponseModule(
    session: Session
  ): Promise<CoreSemanticResponseModule | null> {
    if (!isCompanionThreadTags(session.tags)) return null;
    try {
      return await this.semanticResponseLoader();
    } catch {
      // Fail open without logging module/provider errors, which could contain
      // request fragments from a custom loader.
      log('[EngineRunner] semantic response runtime unavailable', {
        sessionId: session.id,
      });
      return null;
    }
  }

  /**
   * Build the critic transcript exclusively from user-visible canonical text.
   * Attachment payloads, paths, tool inputs/results, thinking and the enriched
   * engine prompt are intentionally impossible to enter this representation.
   */
  private buildSemanticReviewHistory(
    sharedMessages: Array<{ role: string; content: string }>,
    localMessages: Message[]
  ): SemanticReviewHistoryTurn[] {
    const toTurn = (role: string, content: string): SemanticReviewHistoryTurn | null => {
      if (role !== 'user' && role !== 'assistant') return null;
      const canonicalContent = content.replace(/\s+/g, ' ').trim().slice(0, 4_000);
      return canonicalContent ? { role, content: canonicalContent } : null;
    };
    const localTurns = localMessages.flatMap((message) => {
      const visibleText = message.content
        .flatMap((block) => (block.type === 'text' ? [(block as TextContent).text] : []))
        .join('\n');
      const turn = toTurn(message.role, visibleText);
      return turn ? [turn] : [];
    });
    const localFingerprints = new Set(
      localTurns.map((turn) => `${turn.role}:${turn.content.toLocaleLowerCase('fr')}`)
    );
    const sharedTurns = sharedMessages.flatMap((message) => {
      const turn = toTurn(message.role, message.content);
      if (!turn) return [];
      const fingerprint = `${turn.role}:${turn.content.toLocaleLowerCase('fr')}`;
      return localFingerprints.has(fingerprint) ? [] : [turn];
    });
    return [...sharedTurns, ...localTurns].slice(-12);
  }

  async steer(sessionId: string, prompt: string): Promise<boolean> {
    return Boolean(await this.adapter.steer?.(sessionId, prompt));
  }

  private async createTurnCheckpoint(
    session: Session,
    prompt: string
  ): Promise<TurnCheckpoint | null> {
    if (!session.cwd) return null;
    try {
      const { loadCoreModule } = await import('../utils/core-loader');
      type GhostSnapshotMod = {
        getGhostSnapshotManager: (cwd: string) => {
          createSnapshot: (desc: string) => Promise<
            (Omit<TurnCheckpoint, 'timestamp'> & { timestamp: number | Date }) | null
          >;
        };
      };
      const mod = await loadCoreModule<GhostSnapshotMod>('checkpoints/ghost-snapshot.js');
      if (!mod) return null;
      const snapshot = await mod
        .getGhostSnapshotManager(session.cwd)
        .createSnapshot(`Turn: ${prompt.slice(0, 60)}`);
      if (!snapshot) return null;
      return {
        ...snapshot,
        timestamp: snapshot.timestamp instanceof Date
          ? snapshot.timestamp.getTime()
          : snapshot.timestamp,
      };
    } catch {
      // Checkpoint creation is best-effort, but its attempt remains ahead of tools.
      return null;
    }
  }

  private async resolveActivePersonaPrompt(): Promise<string | undefined> {
    try {
      const { getIdentityBridge } = await import('../identity/identity-bridge');
      const bridge = getIdentityBridge();
      await bridge.ensureLoaded();
      const active = bridge.getActive();
      if (!active || active.kind !== 'persona') {
        return undefined;
      }
      const detail = await bridge.getDetail(active.id);
      if (!detail) {
        return undefined;
      }
      const content = detail.content.trim();
      if (!content) {
        return undefined;
      }
      return [
        `# Active Cowork Persona: ${detail.name}`,
        `Source: ${detail.source} ${detail.kind}`,
        '',
        content,
      ].join('\n');
    } catch {
      return undefined;
    }
  }
}

/**
 * Try to parse a JSON string, returning the string as-is if parsing fails.
 */
function tryParseJSON(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return { raw: str };
  }
}

/**
 * Detect Computer Use / GUI automation tool names so we can render their
 * screenshots in the ComputerUseOverlay (Phase 2 step 13).
 */
function isGuiOperateTool(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower === 'gui_operate' ||
    lower === 'computer' ||
    lower === 'gui_control' ||
    lower === 'computer_control' ||
    lower.includes('screenshot') ||
    lower.includes('gui_') ||
    lower.startsWith('computer_') ||
    lower.endsWith('_screenshot')
  );
}

/**
 * Extract a screenshot data URI / file path from a tool output data blob.
 * Supports: base64 data URIs, JSON with `screenshot`/`image` fields.
 */
function extractScreenshotFromData(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const obj = data as Record<string, unknown>;
  const candidate = obj.screenshot ?? obj.image ?? obj.imagePath ?? obj.screenshotPath;
  if (typeof candidate === 'string' && candidate.length > 0) {
    if (!candidate.startsWith('data:image/') && !candidate.startsWith('file://')) {
       if (/^[A-Za-z0-9+/=]+$/.test(candidate.substring(0, 50))) {
         return `data:image/png;base64,${candidate}`;
       }
    }
    return candidate;
  }
  return undefined;
}

function emitGuiActionEvent(
  sendToRenderer: (event: ServerEvent) => void,
  sessionId: string,
  toolUseId: string,
  toolName: string,
  rawInput: string | undefined,
  data: unknown
): void {
  let input: Record<string, unknown> = {};
  if (rawInput) {
    input = tryParseJSON(rawInput);
  }
  const action =
    typeof input.action === 'string'
      ? input.action
      : typeof input.command === 'string'
        ? input.command
        : 'screenshot';
  const click =
    typeof input.x === 'number' && typeof input.y === 'number'
      ? { x: input.x as number, y: input.y as number }
      : undefined;

  sendToRenderer({
    type: 'gui.action',
    payload: {
      sessionId,
      toolUseId,
      action,
      toolName,
      screenshot: extractScreenshotFromData(data),
      click,
      details: input,
      timestamp: Date.now(),
    },
  });
}
