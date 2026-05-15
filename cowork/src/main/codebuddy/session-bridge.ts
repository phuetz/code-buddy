/**
 * @module main/codebuddy/session-bridge
 *
 * @deprecated Use CodeBuddyEngineRunner (in-process) instead.
 * This SSE bridge is kept for backward compatibility. For embedded mode,
 * the engine events are translated directly by CodeBuddyEngineRunner.
 *
 * Bridges Code Buddy SSE events → Open Cowork renderer IPC events (~200 lines).
 *
 * Responsibilities:
 * - Drives a streaming chat session via CodeBuddyAdapter.chat()
 * - Converts CodeBuddyStreamEvent types to the renderer channel names that
 *   Open Cowork's UI already listens on:
 *     stream.partial  — incremental content delta
 *     stream.message  — final assembled assistant message
 *     trace.step      — tool call activity
 *     session.status  — session lifecycle (running / idle / error)
 *     session.contextInfo — token count updates
 *     error           — fatal error notification
 * - Forwards abort to the underlying adapter
 */
import type { BrowserWindow } from 'electron';
import { log, logError } from '../utils/logger';
import {
  CodeBuddyAdapter,
  type CodeBuddyMessage,
} from './codebuddy-adapter';

// ---------------------------------------------------------------------------
// Payload shapes — mirror what the renderer already expects from agent-runner
// ---------------------------------------------------------------------------

interface SessionStatusPayload {
  sessionId: string;
  status: 'running' | 'idle' | 'error';
}

interface StreamPartialPayload {
  sessionId: string;
  content: string | undefined;
}

interface StreamMessagePayload {
  sessionId: string;
  role: 'assistant';
  content: string;
}

interface TraceStepPayload {
  sessionId: string;
  step: {
    type: 'tool_call';
    tool: string;
    input: string;
    status: 'running';
  };
}

interface SessionContextInfoPayload {
  sessionId: string;
  tokenCount: number | undefined;
}

interface ErrorPayload {
  message: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// SessionBridge
// ---------------------------------------------------------------------------

export class SessionBridge {
  private adapter: CodeBuddyAdapter;
  private mainWindow: BrowserWindow;

  constructor(adapter: CodeBuddyAdapter, mainWindow: BrowserWindow) {
    this.adapter = adapter;
    this.mainWindow = mainWindow;
  }

  /**
   * Runs a full streaming session for the given messages.
   *
   * Sends IPC events to the renderer as data arrives, then emits a final
   * stream.message once the assistant's complete response is assembled.
   *
   * @param sessionId - Identifier forwarded to every renderer event.
   * @param messages  - Conversation history (system + user turns).
   * @param tools     - Optional tool definitions in OpenAI function format.
   */
  async runSession(
    sessionId: string,
    messages: CodeBuddyMessage[],
    tools?: unknown[],
  ): Promise<void> {
    log('[SessionBridge] starting session', sessionId);
    this.sendSessionStatus({ sessionId, status: 'running' });

    let fullContent = '';

    try {
      for await (const event of this.adapter.chat(messages, tools)) {
        switch (event.type) {
          case 'content': {
            fullContent += event.content ?? '';
            this.sendStreamPartial({ sessionId, content: event.content });
            break;
          }

          case 'tool_calls': {
            for (const tc of event.toolCalls ?? []) {
              this.sendTraceStep({
                sessionId,
                step: {
                  type: 'tool_call',
                  tool: tc.function.name,
                  input: tc.function.arguments,
                  status: 'running',
                },
              });
            }
            break;
          }

          case 'tool_stream': {
            // tool_stream carries incremental tool output — surface as a
            // partial so the user sees streaming tool activity.
            if (event.content) {
              this.sendStreamPartial({ sessionId, content: event.content });
            }
            break;
          }

          case 'token_count': {
            this.sendSessionContextInfo({
              sessionId,
              tokenCount: event.tokenCount,
            });
            break;
          }

          case 'done': {
            this.finishSession(sessionId, fullContent);
            return;
          }

          case 'error': {
            logError('[SessionBridge] stream error:', event.error);
            this.sendError({
              message: event.error ?? 'Unknown error from Code Buddy',
              sessionId,
            });
            this.sendSessionStatus({ sessionId, status: 'error' });
            return;
          }
        }
      }

      // Generator exhausted without an explicit 'done' event — treat as done.
      this.finishSession(sessionId, fullContent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('[SessionBridge] unhandled error during session', sessionId, err);
      this.sendError({ message: msg, sessionId });
      this.sendSessionStatus({ sessionId, status: 'error' });
    }
  }

  /**
   * Aborts the currently running stream.
   * The renderer will receive a session.status 'idle' after abort is processed.
   */
  stop(): void {
    log('[SessionBridge] stop requested');
    this.adapter.abort();
  }

  // ---- IPC helpers -----------------------------------------------------------

  private send(channel: string, data: unknown): void {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  private finishSession(sessionId: string, fullContent: string): void {
    if (fullContent.trim().length === 0) {
      const message = 'Code Buddy session ended without assistant content';
      logError('[SessionBridge] empty assistant content', sessionId);
      this.sendError({ message, sessionId });
      this.sendSessionStatus({ sessionId, status: 'error' });
      return;
    }

    this.sendStreamMessage({
      sessionId,
      role: 'assistant',
      content: fullContent,
    });
    this.sendSessionStatus({ sessionId, status: 'idle' });
    log('[SessionBridge] session done', sessionId);
  }

  private sendSessionStatus(payload: SessionStatusPayload): void {
    this.send('session.status', payload);
  }

  private sendStreamPartial(payload: StreamPartialPayload): void {
    this.send('stream.partial', payload);
  }

  private sendStreamMessage(payload: StreamMessagePayload): void {
    this.send('stream.message', payload);
  }

  private sendTraceStep(payload: TraceStepPayload): void {
    this.send('trace.step', payload);
  }

  private sendSessionContextInfo(payload: SessionContextInfoPayload): void {
    this.send('session.contextInfo', payload);
  }

  private sendError(payload: ErrorPayload): void {
    this.send('error', payload);
  }
}
