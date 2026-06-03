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
import { createReasoningCapture } from '../reasoning/reasoning-capture';
import { loadCoreModule } from '../utils/core-loader';
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
  diffPreview?: { turnId: number; diffs: Array<Record<string, unknown>>; plan?: string };
}

async function getLazyReasoningBridge() {
  const mod = await import('../reasoning/reasoning-bridge');
  return mod.getReasoningBridge();
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

  constructor(adapter: EngineAdapter, callbacks: RunnerCallbacks) {
    this.adapter = adapter;
    this.callbacks = callbacks;
  }

  /**
   * Run a session using the Code Buddy engine.
   * Translates EngineStreamEvents to Cowork ServerEvents.
   */
  async run(session: Session, prompt: string, existingMessages: Message[]): Promise<void> {
    const { sendToRenderer, saveMessage } = this.callbacks;

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

    // Create checkpoint before this turn (ghost snapshot)
    try {
      if (session.cwd) {
        type GhostSnapshotMod = {
          getGhostSnapshotManager: (cwd: string) => {
            createSnapshot: (desc: string) => Promise<{
              id: string;
              commitHash: string;
              description: string;
              timestamp: number;
              turn: number;
            } | null>;
          };
        };
        const mod = await loadCoreModule<GhostSnapshotMod>('checkpoints/ghost-snapshot.js');
        if (!mod) {
          throw new Error('ghost-snapshot module unavailable');
        }
        const gsm = mod.getGhostSnapshotManager(session.cwd);
        const snapshot = await gsm.createSnapshot(`Turn: ${prompt.slice(0, 60)}`);
        if (snapshot) {
          sendToRenderer({
            type: 'checkpoint.created',
            payload: {
              sessionId: session.id,
              snapshot: {
                id: snapshot.id,
                commitHash: snapshot.commitHash,
                description: snapshot.description,
                timestamp: snapshot.timestamp,
                turn: snapshot.turn,
              },
            },
          } as ServerEvent);
        }
      }
    } catch {
      // Checkpoint creation is best-effort — don't block the session
    }

    // Filter out the current user message to avoid duplicate context assembly
    const historyMessages = hasUserMessageAtEnd
      ? existingMessages.slice(0, -1)
      : existingMessages;

    // Convert existing messages to engine format
    const engineMessages = this.convertMessages(historyMessages, prompt);
    const systemPromptAppend = await this.resolveActivePersonaPrompt();

    let fullContent = '';
    let runtimeError: string | null = null;
    const contentBlocks: ContentBlock[] = [];
    const reasoningCapture = createReasoningCapture({
      bridge: await getLazyReasoningBridge(),
      toolUseId: `${session.id}:reasoning:${userMessageId}`,
      sessionId: session.id,
      problem: prompt,
      mode: session.model ?? 'embedded',
    });

    try {
      await this.adapter.runSession(
        session.id,
        engineMessages,
        (event: EngineStreamEvent) => {
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
                sendToRenderer({
                  type: 'trace.update',
                  payload: {
                    sessionId: session.id,
                    stepId: event.tool.id,
                    updates: {
                      status: event.tool.isError ? 'error' : 'completed',
                      toolOutput: event.tool.output,
                      isError: event.tool.isError,
                      duration: 0,
                    },
                  },
                });

                // Add tool_result content block
                contentBlocks.push({
                  type: 'tool_result',
                  toolUseId: event.tool.id,
                  content: event.tool.output || '',
                  isError: event.tool.isError,
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
                    updates: { toolOutput: event.tool.delta },
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
                const inputData: Record<string, unknown> = {
                  questions: [ 
                    { 
                      question: event.askUser.question, 
                      options: event.askUser.options?.map(o => ({ label: o })) 
                    } 
                  ] 
                };

                const traceEvent: ServerEvent = {
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
                };
                sendToRenderer(traceEvent);

                const askUserBlock: ToolUseContent = {
                  type: 'tool_use',
                  id: stepId,
                  name: 'AskUserQuestion',
                  input: inputData,
                };
                contentBlocks.push(askUserBlock);
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
          model: session.model,
          systemPromptAppend,
        }
      );

      if (runtimeError && !fullContent && contentBlocks.length === 0) {
        fullContent = `**Error**: ${runtimeError}`;
      }

      // Save assistant message
      const assistantContent: ContentBlock[] = [];
      if (fullContent) {
        assistantContent.push({ type: 'text', text: fullContent } as TextContent);
      }
      assistantContent.push(...contentBlocks);

      const assistantMessage: Message = {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content:
          assistantContent.length > 0
            ? assistantContent
            : [{ type: 'text', text: fullContent || '' } as TextContent],
        timestamp: Date.now(),
      };
      saveMessage(assistantMessage);

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
   * Cancel a running session.
   */
  cancel(sessionId: string): void {
    this.adapter.cancel(sessionId);
    log('[CodeBuddyEngineRunner] cancelled', sessionId);
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

  private async resolveActivePersonaPrompt(): Promise<string | undefined> {
    try {
      const { getIdentityBridge } = await import('../identity/identity-bridge');
      const bridge = getIdentityBridge();
      await bridge.list();
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
