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
import { CoworkCrossChannelContinuity } from '../companion/cross-channel-continuity';
import type { ContextOptimizationMetadata } from '@codebuddy/shared/context-optimization-metadata';
import type {
  Session,
  Message,
  ServerEvent,
  ContentBlock,
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
  steer?(sessionId: string, prompt: string): boolean | Promise<boolean>;
  clearSession(sessionId: string): void;
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
  private continuity: Pick<CoworkCrossChannelContinuity, 'prepare'>;

  constructor(
    adapter: EngineAdapter,
    callbacks: RunnerCallbacks,
    continuity: Pick<CoworkCrossChannelContinuity, 'prepare'> = new CoworkCrossChannelContinuity(),
  ) {
    this.adapter = adapter;
    this.callbacks = callbacks;
    this.continuity = continuity;
  }

  /**
   * Run a session using the Code Buddy engine.
   * Translates EngineStreamEvents to Cowork ServerEvents.
   */
  async run(session: Session, prompt: string, existingMessages: Message[]): Promise<void> {
    const { sendToRenderer, saveMessage } = this.callbacks;
    const turnStartedAt = Date.now();

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

    if (!hasUserMessageAtEnd) {
      // Save user message (fallback for tests/standalone runs)
      const userMessage: Message = {
        id: userMessageId,
        sessionId: session.id,
        role: 'user',
        content: [{ type: 'text', text: prompt } as TextContent],
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
    const localEngineMessages = this.convertMessages(historyMessages, prompt);
    const [snapshot, personaPrompt, sharedContinuity] = await Promise.all([
      this.createTurnCheckpoint(session, prompt),
      this.resolveActivePersonaPrompt(),
      this.continuity.prepare(session, localEngineMessages, prompt, userMessageId),
    ]);
    const engineMessages = sharedContinuity.active
      ? [...sharedContinuity.messages, ...localEngineMessages]
      : localEngineMessages;
    const systemPromptAppend = [personaPrompt, sharedContinuity.systemPrompt]
      .filter((part): part is string => Boolean(part?.trim()))
      .join('\n\n') || undefined;
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
      problem: prompt,
      mode: session.model ?? 'embedded',
    });
    const engineStartedAt = Date.now();
    let firstVisibleEventRecorded = false;
    const runtimeConfig = session.intelligence?.configSetId
      ? configStore.getConfigForSet(session.intelligence.configSetId)
      : configStore.getAll();

    try {
      await this.adapter.runSession(
        session.id,
        engineMessages,
        (event: EngineStreamEvent) => {
          if (
            !firstVisibleEventRecorded &&
            (event.type === 'content' || event.type === 'thinking' || event.type === 'tool_start')
          ) {
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
                model: session.model || runtimeConfig.model,
              },
            };
            log('[EngineRunner] first visible stream event', {
              sessionId: session.id,
              setupMs: engineStartedAt - turnStartedAt,
              engineMs: Date.now() - engineStartedAt,
              totalMs: Date.now() - turnStartedAt,
              eventType: event.type,
            });
          }
          switch (event.type) {
            case 'content':
              if (event.content) {
                fullContent += event.content;
                sendToRenderer({
                  type: 'stream.partial',
                  payload: { sessionId: session.id, delta: event.content },
                });
              }
              break;

            case 'thinking':
              if (event.thinking) {
                reasoningCapture.push(event.thinking);
                sendToRenderer({
                  type: 'stream.thinking',
                  payload: { sessionId: session.id, delta: event.thinking },
                });
              }
              break;

            case 'tool_start':
              if (event.tool) {
                const step = {
                  id: event.tool.id,
                  type: 'tool_call' as const,
                  status: 'running' as const,
                  title: event.tool.name,
                  toolName: event.tool.name,
                  toolInput: event.tool.input ? tryParseJSON(event.tool.input) : undefined,
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
                  input: event.tool.input ? tryParseJSON(event.tool.input) : {},
                } as ToolUseContent);
              }
              break;

            case 'tool_end':
              if (event.tool) {
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
                      toolOutput: event.tool.output,
                      isError: event.tool.isError,
                      duration,
                    },
                  },
                });

                // Add tool_result content block
                contentBlocks.push({
                  type: 'tool_result',
                  toolUseId: event.tool.id,
                  content: event.tool.output || '',
                  isError: event.tool.isError,
                  ...(event.tool.data !== undefined ? { data: event.tool.data } : {}),
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
                    event.tool.input,
                    event.tool.data
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
                      rawInput: event.tool.input,
                      data: event.tool.data,
                      output: event.tool.output,
                    }),
                  });
                }
              }
              break;

            case 'tool_stream':
              if (event.tool?.delta) {
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
                const inputData = { 
                  questions: [ 
                    { 
                      question: event.askUser.question, 
                      options: event.askUser.options?.map(o => ({ label: o })) 
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
              sendToRenderer({
                type: 'stream.done',
                payload: { sessionId: session.id },
              } as ServerEvent);
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
          apiKey: runtimeConfig.apiKey,
          baseURL: runtimeConfig.baseUrl,
          model: session.model || runtimeConfig.model,
          thinkingLevel: session.intelligence?.thinkingLevel,
          permissionMode: session.permissionModeOverride ?? session.permissionMode ?? 'default',
          systemPromptAppend,
        }
      );
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
          model: session.model || runtimeConfig.model,
        },
      };
      log('[EngineRunner] turn options', { sessionId: session.id, cwd: session.cwd ?? '(undefined)' });

      if (runtimeError && !fullContent && contentBlocks.length === 0) {
        fullContent = `**Error**: ${runtimeError}`;
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
      logError('[CodeBuddyEngineRunner] session error', error);
      sendToRenderer({
        type: 'error',
        payload: {
          message: error instanceof Error ? error.message : String(error),
          sessionId: session.id,
        },
      } as ServerEvent);
    } finally {
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
      this.adapter.cancel(sessionId);
      log('[CodeBuddyEngineRunner] cancelled', sessionId);
    } catch (error) {
      logError('[CodeBuddyEngineRunner] cancel failed', error);
    }
  }

  /**
   * Clear session state.
   */
  clearSdkSession(sessionId: string): void {
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
