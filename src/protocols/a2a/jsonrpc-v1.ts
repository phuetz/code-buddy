import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TaskStatus, type Task, type TaskExecutor, type A2AMessage } from './index.js';

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const requestSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string().max(128), z.number().finite(), z.null()]), method: z.string().max(64), params: z.record(z.string(), z.unknown()).default({}) }).strict();
const messageSchema = z.object({ messageId: identifier, contextId: identifier.optional(), role: z.enum(['ROLE_USER', 'user']).optional(),
  parts: z.array(z.object({ text: z.string(), type: z.literal('text').optional(), kind: z.literal('text').optional() }).strict()).min(1).max(64) }).strict();
export interface A2AWireTask {
  id: string; contextId: string; status: { state: string; timestamp: string; message?: { role: 'ROLE_AGENT'; parts: Array<{ text: string }> } };
  artifacts: Array<{ artifactId: string; parts: Array<{ text: string }> }>;
}
interface Stored { peer: string; contextId: string; fingerprint: string; task: A2AWireTask; promise?: Promise<A2AWireTask>; running?: boolean; at: number }
interface Context { messages: A2AMessage[]; turns: number; busy: boolean; at: number }
const MAX_TEXT = 64 * 1024;
const timestamp = () => new Date().toISOString();
function truncateUtf8(text: string, limit: number): string {
  const buffer = Buffer.from(text);
  let end = Math.min(buffer.length, limit);
  while (end > 0 && end < buffer.length && (buffer[end]! & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString('utf8');
}
export const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Bounded text-only A2A 1.0 JSON-RPC subset; no automatic retries, streaming or pretend cancellation. */
export class A2AJsonRpcAdapter {
  private tasks = new Map<string, Stored>();
  private messages = new Map<string, string>();
  private contexts = new Map<string, Context>();
  constructor(private readonly executor: TaskExecutor, private readonly timeoutMs = 120000, private readonly peerCount = 1) {}

  async handle(peer: string, input: unknown, version?: string): Promise<unknown> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return rpcError(null, -32600, 'Invalid JSON-RPC request');
    const { id, method, params } = parsed.data;
    if (version && !['1.0', '1.0.0'].includes(version)) return rpcError(id, -32602, 'Only A2A 1.0 is supported');
    this.prune();
    if (method === 'GetTask' || method === 'tasks/get') {
      const key = typeof params.id === 'string' ? params.id : typeof params.name === 'string' ? params.name.replace(/^tasks\//, '') : '';
      const stored = this.tasks.get(key);
      return stored?.peer === peer ? { jsonrpc: '2.0', id, result: structuredClone(stored.task) } : rpcError(id, -32001, 'Task not found');
    }
    if (method === 'CancelTask' || method === 'tasks/cancel') return rpcError(id, -32004, 'Cancellation is not supported; no cancellation was performed');
    if (!['SendMessage', 'message/send'].includes(method)) return rpcError(id, -32601, 'Method not supported (including streaming)');
    const message = messageSchema.safeParse(params.message);
    if (!message.success) return rpcError(id, -32602, 'A text message with messageId is required');
    const text = message.data.parts.map(p => p.text).join('\n').trim();
    if (!text || Buffer.byteLength(text) > MAX_TEXT) return rpcError(id, -32602, 'Message must contain 1–65536 UTF-8 bytes');
    if (params.contextId !== undefined && !identifier.safeParse(params.contextId).success) return rpcError(id, -32602, 'Invalid contextId');
    if (params.configuration !== undefined && (!params.configuration || typeof params.configuration !== 'object' || (params.configuration as { blocking?: unknown }).blocking !== true)) return rpcError(id, -32602, 'Only blocking SendMessage is supported');
    const contextId = message.data.contextId ?? (typeof params.contextId === 'string' && identifier.safeParse(params.contextId).success ? params.contextId : randomUUID());
    const fingerprint = createHash('sha256').update(JSON.stringify([message.data.contextId ?? params.contextId ?? null, text])).digest('hex');
    const messageKey = `${peer}:${message.data.messageId}`;
    const previousId = this.messages.get(messageKey);
    const previous = previousId ? this.tasks.get(previousId) : undefined;
    if (previous) {
      if (previous.fingerprint !== fingerprint) return rpcError(id, -32602, 'messageId already used with different content');
      return { jsonrpc: '2.0', id, result: { task: await (previous.promise ?? Promise.resolve(structuredClone(previous.task))) } };
    }
    const contextKey = `${peer}:${contextId}`;
    const context = this.contexts.get(contextKey) ?? { messages: [], turns: 0, busy: false, at: Date.now() };
    if (context.messages.reduce((bytes, msg) => bytes + Buffer.byteLength(JSON.stringify(msg)), Buffer.byteLength(text)) > MAX_TEXT) return rpcError(id, -32602, 'Context text limit reached');
    if (context.busy) return rpcError(id, -32005, 'Context is busy; no second task was started');
    if (context.turns >= 5) return rpcError(id, -32005, 'Context turn limit reached');
    const shares = Math.max(1, Math.min(32, Math.floor(this.peerCount)));
    const peerTasks = [...this.tasks.values()].filter(value => value.peer === peer).length;
    const peerContexts = [...this.contexts.keys()].filter(key => key.startsWith(`${peer}:`)).length;
    if (peerTasks >= Math.floor(256 / shares) || (!this.contexts.has(contextKey) && peerContexts >= Math.floor(128 / shares))) return rpcError(id, -32005, 'Peer task capacity reached');
    if (this.tasks.size >= 256 || (!this.contexts.has(contextKey) && this.contexts.size >= 128)) return rpcError(id, -32005, 'Task capacity reached');
    const task: A2AWireTask = { id: randomUUID(), contextId, status: { state: 'TASK_STATE_WORKING', timestamp: timestamp() }, artifacts: [] };
    const stored: Stored = { peer, contextId, fingerprint, task, at: Date.now() };
    this.tasks.set(task.id, stored); this.messages.set(messageKey, task.id);
    if (text.startsWith('/')) {
      task.status = { state: 'TASK_STATE_REJECTED', timestamp: timestamp(), message: { role: 'ROLE_AGENT', parts: [{ text: 'Slash commands are not allowed over A2A' }] } };
      return { jsonrpc: '2.0', id, result: { task: structuredClone(task) } };
    }
    context.busy = true; context.turns++; context.at = Date.now(); this.contexts.set(contextKey, context);
    const inputTask: Task = { id: task.id, sessionId: `a2a:${peer}:${contextId}`, metadata: { peerId: peer },
      messages: [...structuredClone(context.messages), { role: 'user', parts: [{ type: 'text', text }] }], artifacts: [], history: [], status: { status: TaskStatus.WORKING, timestamp: Date.now() } };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    stored.running = true;
    const execution = Promise.resolve().then(() => this.executor(inputTask, controller.signal)).finally(() => { context.busy = false; stored.running = false; });
    stored.promise = (async () => {
      try {
        const completed = await Promise.race([execution, new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('TIMEOUT')); }, this.timeoutMs);
          timer.unref?.();
        })]);
        const failed = completed.status.status !== TaskStatus.COMPLETED;
        const output = completed.messages.filter(m => m.role === 'agent').at(-1)?.parts.filter(p => p.type === 'text').map(p => p.text).join('\n') ?? '';
        task.status = { state: failed ? 'TASK_STATE_FAILED' : 'TASK_STATE_COMPLETED', timestamp: timestamp() };
        if (!failed) {
          const returnedText = Buffer.byteLength(output) > MAX_TEXT ? truncateUtf8(output, MAX_TEXT - 32) + '\n[Output truncated]' : output;
          task.artifacts = [{ artifactId: randomUUID(), parts: [{ text: returnedText }] }];
          context.messages = [...structuredClone(completed.messages).slice(0, -1), { role: 'agent' as const, parts: [{ type: 'text' as const, text: returnedText }] }].slice(-10);
          while (context.messages.length > 1 && Buffer.byteLength(JSON.stringify(context.messages)) > MAX_TEXT) context.messages.shift();
        } else task.status.message = { role: 'ROLE_AGENT', parts: [{ text: 'Executor failed; inspect local diagnostics' }] };
      } catch {
        task.status = { state: 'TASK_STATE_FAILED', timestamp: timestamp(), message: { role: 'ROLE_AGENT', parts: [{ text: 'Execution failed or timed out; no automatic retry' }] } };
      } finally { clearTimeout(timer!); stored.promise = undefined; stored.at = Date.now(); }
      return structuredClone(task);
    })();
    return { jsonrpc: '2.0', id, result: { task: await stored.promise } };
  }
  private prune(): void {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, value] of this.tasks) if (!value.running && !value.promise && value.at < cutoff) this.tasks.delete(id);
    for (const [id, taskId] of this.messages) if (!this.tasks.has(taskId)) this.messages.delete(id);
    for (const [id, context] of this.contexts) if (!context.busy && context.at < cutoff) this.contexts.delete(id);
  }
}
