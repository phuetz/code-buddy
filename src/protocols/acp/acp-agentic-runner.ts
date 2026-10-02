import { withToolExecutionContext } from '../../utils/tool-execution-context.js';
/** ACP adapts the interactive agent loop; it never executes tools itself. */
import path from 'node:path';
import type { CodeBuddyAgent, AgentModelClient } from '../../agent/codebuddy-agent.js';
import type { StreamingChunk } from '../../agent/types.js';
import { toolCallContext } from '../../agent/execution/tool-call-context.js';
import { ConfirmationService, type ConfirmationOptions } from '../../utils/confirmation-service.js';
import { withVfsTextTransportAsync, type VfsTextTransport } from '../../services/vfs/unified-vfs-router.js';
import { getWorkspaceIsolation } from '../../workspace/workspace-isolation.js';
import { TodoTool, type TodoItem } from '../../tools/todo-tool.js';
import { withTodoToolAsync } from '../../tools/registry/todo-tools.js';
import { TextEditorTool } from '../../tools/text-editor.js';
import { withTextEditorAsync } from '../../tools/registry/text-editor-tools.js';
import { MCPManager } from '../../mcp/client.js';
import { withMCPManagerAsync } from '../../codebuddy/tools.js';
import { getTodoTracker } from '../../agent/todo-tracker.js';
import type { AcpPromptContext, AcpPromptRunner, AcpSessionUpdate } from './acp-stdio-server.js';
import type { CodeBuddyToolCall } from '../../codebuddy/client.js';

interface AcpRunnerOptions {
  apiKey: string;
  baseURL?: string;
  model?: string;
  /** In-process deterministic provider; never enabled by the CLI. */
  modelClient?: AgentModelClient;
  maxRounds?: number;
}

type ConversationState = ReturnType<CodeBuddyAgent['exportConversationState']> & { acpTodos?: TodoItem[] };

interface AcpRuntime {
  agent: CodeBuddyAgent;
  confirmation: ConfirmationService;
  editor: TextEditorTool;
  mcp: MCPManager;
  mcpKey: string;
  todo: TodoTool;
  cwd: string;
}

function withSessionContext<T>(session: AcpRuntime, ctx: AcpPromptContext, transport: VfsTextTransport, fn: () => Promise<T>): Promise<T> {
  return ConfirmationService.withInstanceAsync(session.confirmation, () =>
    withMCPManagerAsync(session.mcp, () =>
      getWorkspaceIsolation().withWorkspaceRootAsync(ctx.cwd, () =>
        withTextEditorAsync(session.editor, () =>
          withTodoToolAsync(session.todo, () => withVfsTextTransportAsync(transport, () =>
            withToolExecutionContext({ cwd: ctx.cwd, signal: ctx.signal }, fn)))))));
}

export interface AcpAgenticRunner extends AcpPromptRunner {
  dispose(): Promise<void>;
}

function argsFor(call: CodeBuddyToolCall): Record<string, unknown> {
  try { return JSON.parse(call.function.arguments) as Record<string, unknown>; }
  catch { return {}; }
}

function toolUpdate(call: CodeBuddyToolCall): AcpSessionUpdate {
  const args = argsFor(call);
  const name = call.function.name;
  const rawPath = args.path ?? args.file_path ?? args.target_file;
  const kind = /view|read/.test(name) ? 'read'
    : /replace|write|create_file|insert|edit|patch/.test(name) ? 'edit'
    : name === 'bash' ? 'execute' : /search/.test(name) ? 'search' : 'other';
  return {
    sessionUpdate: 'tool_call', toolCallId: call.id, title: name,
    kind, status: 'pending', rawInput: args,
    ...(typeof rawPath === 'string' ? { locations: [{ path: rawPath }] } : {}),
  };
}

export function createAcpAgenticRunner(options: AcpRunnerOptions): AcpAgenticRunner {
  const agents = new Map<string, AcpRuntime>();
  // Several core registries still have process-wide mutable state. Reject overlapping
  // turns across sessions until they are all session-scoped; never swap a live bridge.
  let busy = false;
  const runner: AcpAgenticRunner = Object.assign(async (ctx: AcpPromptContext) => {
    if (busy) throw new Error('Another ACP session has an active prompt; wait or cancel it.');
    busy = true;
    try {
      ctx.signal.throwIfAborted();
      let session = agents.get(ctx.sessionId);
      if (!session) {
        const confirmation = new ConfirmationService();
        const editor = new TextEditorTool();
        const mcp = new MCPManager();
        const todo = new TodoTool();
        // Do not initialize the process-global MCP configuration for an editor session.
        await mcp.ensureServersInitialized({ servers: [] });
        const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
        const agent = await ConfirmationService.withInstanceAsync(confirmation, async () =>
          withMCPManagerAsync(mcp, async () => new CodeBuddyAgent(
            options.apiKey, options.baseURL, options.model, options.maxRounds, true,
            undefined, ctx.cwd, undefined, undefined,
            options.modelClient ? { modelClient: options.modelClient } : undefined,
          )));
        await agent.getMCPReady();
        if (ctx.conversation) {
          const state = structuredClone(ctx.conversation) as ConversationState;
          for (const entry of state.chatHistory) entry.timestamp = new Date(entry.timestamp);
          agent.importConversationState(state);
          if (state.acpTodos) await todo.createTodoList(state.acpTodos);
        }
        session = { agent, confirmation, editor, mcp, mcpKey: '', todo, cwd: ctx.cwd };
        agents.set(ctx.sessionId, session);
      }
      if (session.cwd !== ctx.cwd) {
        session.confirmation = new ConfirmationService();
        session.cwd = ctx.cwd;
      }
      const { agent, confirmation, editor, mcp, todo } = session;
      agent.setWorkingDirectory(ctx.cwd);
      editor.setBaseDirectory(ctx.cwd);
      const published = new Map<string, AcpSessionUpdate>();
      const unfinished = new Set<string>();
      const ensurePublished = (call: CodeBuddyToolCall): AcpSessionUpdate => {
        let update = published.get(call.id);
        if (!update) {
          update = toolUpdate(call);
          const locations = update.locations as Array<{ path: string }> | undefined;
          if (locations) for (const location of locations) location.path = path.resolve(ctx.cwd, location.path);
          published.set(call.id, update);
          unfinished.add(call.id);
          ctx.sendUpdate(update);
        }
        return update;
      };
      confirmation.setInteractiveBridge(async (request: ConfirmationOptions) => {
        ctx.signal.throwIfAborted();
        const call = toolCallContext.getStore();
        if (!call) return { confirmed: false, feedback: 'Approval has no active tool call.' };
        const update = ensurePublished(call);
        const content = request.fileChange
          ? [{ type: 'diff', ...request.fileChange }]
          : request.content ? [{ type: 'content', content: { type: 'text', text: request.content } }] : [];
        // Same ordering principle as Gemini CLI (Apache-2.0), acpSession.ts:
        // https://github.com/google-gemini/gemini-cli/pull/29439
        // Publish the call and its proposed diff BEFORE requesting permission.
        // Independently implemented; no Google source code copied.
        const pending = { ...update, sessionUpdate: 'tool_call_update', status: 'pending', content };
        ctx.sendUpdate(pending);
        try {
          const result = await ctx.requestClient('session/request_permission', {
            sessionId: ctx.sessionId, toolCall: { ...pending, sessionUpdate: undefined },
            options: [
              { optionId: 'allow_once', name: 'Autoriser une fois', kind: 'allow_once' },
              { optionId: 'allow_always', name: !request.approvalKey ? 'Toujours autoriser cette catégorie dans ce dossier de session' : 'Toujours autoriser cet appel dans ce dossier de session', kind: 'allow_always' },
              { optionId: 'reject_once', name: 'Refuser', kind: 'reject_once' },
            ],
          }) as { outcome?: { outcome?: string; optionId?: string } };
          ctx.signal.throwIfAborted();
          const selected = result?.outcome?.outcome === 'selected' ? result.outcome.optionId : undefined;
          return { confirmed: selected === 'allow_once' || selected === 'allow_always', dontAskAgain: selected === 'allow_always' };
        } catch {
          return { confirmed: false, feedback: 'Editor permission denied, cancelled or unanswered.' };
        }
      });
      const fileContents = new Map<string, string>();
      const transport = {
        root: ctx.cwd,
        signal: ctx.signal,
        onRead: (file: string, content: string) => { fileContents.set(file, content); },
        onWrite: (file: string, content: string) => {
          const call = toolCallContext.getStore();
          if (call) ctx.sendUpdate({ sessionUpdate: 'tool_call_update', toolCallId: call.id,
            content: [{ type: 'diff', path: file, oldText: fileContents.get(file) ?? null, newText: content }] });
          fileContents.set(file, content);
        },
        ...(ctx.canRequestClient('fs/read_text_file') ? {
          readTextFile: async (filePath: string): Promise<string> => {
            let result: { content?: unknown };
            try {
              result = await ctx.requestClient('fs/read_text_file', { sessionId: ctx.sessionId, path: filePath }) as { content?: unknown };
            } catch (error) {
              if (/ENOENT|not found|does not exist|No such file/i.test(String(error))) {
                throw Object.assign(new Error(String(error)), { code: 'ENOENT' });
              }
              throw error;
            }
            if (typeof result?.content !== 'string') throw new Error('Editor returned invalid file content.');
            return result.content;
          },
        } : {}),
        ...(ctx.canRequestClient('fs/write_text_file') ? {
          writeTextFile: async (filePath: string, content: string): Promise<void> => {
            await ctx.requestClient('fs/write_text_file', { sessionId: ctx.sessionId, path: filePath, content });
          },
        } : {}),
      };
      return await withSessionContext(session, ctx, transport, async () => {
        const mcpKey = JSON.stringify({ cwd: ctx.cwd, servers: ctx.mcpServers ?? [] });
        if (session.mcpKey !== mcpKey) {
          await mcp.shutdown();
          for (const server of parseMcpServers(ctx.mcpServers, ctx.cwd)) {
            ctx.signal.throwIfAborted();
            const onAbort = (): void => { void mcp.removeServer(server.name); };
            ctx.signal.addEventListener('abort', onAbort, { once: true });
            try { await mcp.addServer(server); }
            finally { ctx.signal.removeEventListener('abort', onAbort); }
            ctx.signal.throwIfAborted();
          }
          session.mcpKey = mcpKey;
        }
        ctx.sendUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: ctx.prompt.map((block) => block.text ?? '').join('\n') } });
        const plan = new Map<string, { content: string; priority: string; status: string }>();
        let capped = false;
        try {
          for await (const chunk of agent.processUserMessageStream(
            ctx.prompt.map((block) => block.text ?? '').join('\n'),
            { surface: 'acp', signal: ctx.signal },
          )) {
            if (ctx.signal.aborted) break;
            if (chunk.content?.includes('Maximum tool execution rounds reached.')) capped = true;
            streamUpdate(ctx, chunk, ensurePublished, plan, todo);
            if (chunk.type === 'tool_result' && chunk.toolCall) unfinished.delete(chunk.toolCall.id);
          }
          return { stopReason: ctx.signal.aborted ? 'cancelled' as const : capped ? 'max_turn_requests' as const : 'end_turn' as const };
        } finally {
          if (ctx.signal.aborted) for (const toolCallId of unfinished) {
            ctx.sendUpdate({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed',
              content: [{ type: 'content', content: { type: 'text', text: 'Cancelled by user.' } }] });
          }
          ctx.saveConversation({ ...agent.exportConversationState(), acpTodos: todo.getItems() });
        }
      });
    } finally { busy = false; }
  }, {
    dispose: async (): Promise<void> => {
      for (const { agent, mcp, editor } of agents.values()) {
        agent.abortCurrentOperation();
        agent.dispose({ skipSessionLearning: true });
        editor.dispose();
        await mcp.dispose();
      }
      agents.clear();
    },
  });
  return runner;
}

function streamUpdate(ctx: AcpPromptContext, chunk: StreamingChunk,
  publish: (call: CodeBuddyToolCall) => AcpSessionUpdate,
  plan: Map<string, { content: string; priority: string; status: string }>,
  todo: TodoTool,
): void {
  if (chunk.type === 'content' || chunk.type === 'reasoning') {
    const text = chunk.type === 'content' ? chunk.content : chunk.reasoning;
    if (text) ctx.sendUpdate({ sessionUpdate: chunk.type === 'content' ? 'agent_message_chunk' : 'agent_thought_chunk', content: { type: 'text', text } });
  } else if (chunk.type === 'tool_calls') {
    for (const call of chunk.toolCalls ?? []) publish(call);
  } else if (chunk.type === 'tool_stream' && chunk.toolStreamData) {
    ctx.sendUpdate({ sessionUpdate: 'tool_call_update', toolCallId: chunk.toolStreamData.toolCallId,
      status: 'in_progress', content: [{ type: 'content', content: { type: 'text', text: chunk.toolStreamData.delta } }] });
  } else if (chunk.type === 'tool_result' && chunk.toolCall) {
    publish(chunk.toolCall);
    ctx.sendUpdate({ sessionUpdate: 'tool_call_update', toolCallId: chunk.toolCall.id,
      status: chunk.toolResult?.success ? 'completed' : 'failed', rawOutput: chunk.toolResult,
      content: [{ type: 'content', content: { type: 'text', text: chunk.toolResult?.output ?? chunk.toolResult?.error ?? '' } }] });
    if (['create_todo_list', 'update_todo_list'].includes(chunk.toolCall.function.name) && chunk.toolResult?.success) {
      ctx.sendUpdate({ sessionUpdate: 'plan', entries: todo.getItems().map(({ content, priority, status }) => ({ content, priority, status })) });
    }
    if (chunk.toolCall.function.name === 'todo_update' && chunk.toolResult?.success) {
      ctx.sendUpdate({ sessionUpdate: 'plan', entries: getTodoTracker(ctx.cwd).getAll().map((item) => ({
        content: item.text, priority: item.priority, status: item.status === 'done' ? 'completed' : item.status === 'in_progress' ? 'in_progress' : 'pending',
      })) });
    }
  } else if (chunk.type === 'plan_progress' && chunk.planProgress) {
    const item = chunk.planProgress;
    plan.set(item.taskId, { content: item.message ?? item.taskId, priority: 'medium', status: item.status === 'completed' ? 'completed' : item.status === 'running' ? 'in_progress' : 'pending' });
    ctx.sendUpdate({ sessionUpdate: 'plan', entries: [...plan.values()] });
  }
}

function parseMcpServers(value: unknown, cwd: string): Array<import('../../mcp/types.js').MCPServerConfig> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('ACP mcpServers must be an array.');
  return value.map((item: { name?: unknown; command?: unknown; args?: unknown; env?: unknown; type?: unknown }) => {
    if (item.type || typeof item.name !== 'string' || typeof item.command !== 'string'
      || !Array.isArray(item.args) || !item.args.every((arg) => typeof arg === 'string')
      || !Array.isArray(item.env)) throw new Error('Only ACP stdio MCP servers are supported.');
    const env: Record<string, string> = {};
    for (const entry of item.env as Array<{ name: unknown; value: unknown }>) {
      if (typeof entry.name !== 'string' || typeof entry.value !== 'string') throw new Error('Invalid MCP environment.');
      env[entry.name] = entry.value;
    }
    return { name: item.name, transport: { type: 'stdio', command: item.command, args: item.args, env, cwd, inheritEnv: false } };
  });
}
