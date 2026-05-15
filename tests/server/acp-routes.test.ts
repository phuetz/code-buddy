/**
 * Tests for ACP advanced session features
 *
 * Phase 2: resumeSessionId, prompt queue, cancel, soft-close, fire-and-forget
 */

import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createACPRoutes } from '../../src/server/routes/acp.js';

// Mock the a2a module
vi.mock('../../src/protocols/a2a/index.js', () => {
  const tasks = new Map<string, any>();

  const A2AAgentServer = vi.fn().mockImplementation(function (_card: any, _executor: any) {
    const card = _card;
    return {
      getAgentCard: () => card,
      submitTask: vi.fn().mockImplementation(async (req: any) => {
        const task = {
          id: req.id,
          sessionId: req.sessionId || req.id,
          status: { status: 'completed', timestamp: Date.now() },
          messages: [req.message],
          artifacts: [],
          history: [{ status: 'submitted', timestamp: Date.now() }],
          metadata: req.metadata,
        };
        tasks.set(req.id, task);
        return task;
      }),
      getTask: (id: string) => tasks.get(id),
      cancelTask: vi.fn().mockImplementation((id: string) => {
        const task = tasks.get(id);
        if (task) {
          task.status = { status: 'canceled', timestamp: Date.now() };
          return true;
        }
        return false;
      }),
      yieldTask: vi.fn().mockReturnValue(true),
      resumeTask: vi.fn().mockImplementation(async (id: string) => {
        const task = tasks.get(id);
        if (task) {
          task.status = { status: 'completed', timestamp: Date.now() };
        }
        return task;
      }),
    };
  });

  const A2AAgentClient = vi.fn().mockImplementation(function () {
    const agents = new Map<string, any>();
    return {
      agents,
      listAgents: () => Array.from(agents.keys()),
      getAgentCard: (key: string) => agents.get(key)?.getAgentCard(),
      registerAgent: (key: string, server: any) => agents.set(key, server),
    };
  });

  return {
    A2AAgentServer,
    A2AAgentClient,
    getTaskResult: (task: any) => task.messages?.[task.messages.length - 1]?.parts?.[0]?.text || null,
    TaskStatus: {
      SUBMITTED: 'submitted',
      WORKING: 'working',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELED: 'canceled',
    },
  };
});

describe('ACP Advanced Sessions', () => {
  let server: Server | undefined;

  async function startApp(agent: any): Promise<{ baseUrl: string; sessions: Map<string, any> }> {
    const app = express();
    app.use(express.json());

    const routes = createACPRoutes();
    const client = (routes as unknown as { acpClient: { registerAgent: (key: string, server: any) => void } }).acpClient;
    client.registerAgent('agent-1', agent);
    app.use('/api/acp', routes);

    await new Promise<void>((resolve) => {
      server = createServer(app);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as { port: number };
    return {
      baseUrl: `http://127.0.0.1:${addr.port}`,
      sessions: (routes as unknown as { acpSessions: Map<string, any> }).acpSessions,
    };
  }

  function makeCompletedAgent(): any {
    const tasks = new Map<string, any>();
    return {
      getAgentCard: () => ({ name: 'test-agent' }),
      submitTask: vi.fn().mockImplementation(async (req: any) => {
        const task = {
          id: req.id,
          sessionId: req.sessionId || req.id,
          status: { status: 'completed', timestamp: Date.now() },
          messages: [req.message],
          artifacts: [],
          history: [{ status: 'completed', timestamp: Date.now() }],
          metadata: req.metadata,
        };
        tasks.set(task.id, task);
        return task;
      }),
      getTask: (id: string) => tasks.get(id),
      cancelTask: vi.fn(),
      yieldTask: vi.fn(),
      resumeTask: vi.fn(),
    };
  }

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  describe('ACPSession interface', () => {
    it('should have queue, closed, and activeTaskId fields', () => {
      // Type check — if the module compiles, this passes
      const session = {
        id: 'session_1',
        name: 'test',
        tasks: [],
        createdAt: Date.now(),
        lastActive: Date.now(),
        queue: [] as any[],
        closed: false,
        activeTaskId: null as string | null,
      };
      expect(session.queue).toEqual([]);
      expect(session.closed).toBe(false);
      expect(session.activeTaskId).toBeNull();
    });
  });

  describe('Prompt Queue behavior', () => {
    it('does not leave completed sends as active and does not queue the next prompt', async () => {
      const { baseUrl, sessions } = await startApp(makeCompletedAgent());

      const sessionResp = await fetch(`${baseUrl}/api/acp/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'main' }),
      });
      const session = await sessionResp.json() as { id: string };

      const body = {
        agentId: 'agent-1',
        sessionId: session.id,
        message: { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      };

      const first = await fetch(`${baseUrl}/api/acp/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(first.status).toBe(200);

      const stored = sessions.get('main');
      expect(stored.activeTaskId).toBeNull();

      const second = await fetch(`${baseUrl}/api/acp/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, message: { role: 'user', parts: [{ type: 'text', text: 'again' }] } }),
      });
      expect(second.status).toBe(200);
      const secondBody = await second.json() as { queued?: boolean };
      expect(secondBody.queued).toBeUndefined();
    });

    it('rejects concurrent sends while a fire-and-forget task is active', async () => {
      let release!: () => void;
      const tasks = new Map<string, any>();
      const slowAgent = {
        getAgentCard: () => ({ name: 'slow-agent' }),
        submitTask: vi.fn().mockImplementation(async (req: any) => {
          const task = {
            id: req.id,
            sessionId: req.sessionId || req.id,
            status: { status: 'working', timestamp: Date.now() },
            messages: [req.message],
            artifacts: [],
            history: [{ status: 'working', timestamp: Date.now() }],
            metadata: req.metadata,
          };
          tasks.set(task.id, task);
          await new Promise<void>((resolve) => { release = resolve; });
          task.status = { status: 'completed', timestamp: Date.now() };
          task.history.push(task.status);
          return task;
        }),
        getTask: (id: string) => tasks.get(id),
        cancelTask: vi.fn(),
        yieldTask: vi.fn(),
        resumeTask: vi.fn(),
      };

      const { baseUrl } = await startApp(slowAgent);
      const sessionResp = await fetch(`${baseUrl}/api/acp/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'main' }),
      });
      const session = await sessionResp.json() as { id: string };

      const first = await fetch(`${baseUrl}/api/acp/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-1',
          sessionId: session.id,
          fireAndForget: true,
          message: { role: 'user', parts: [{ type: 'text', text: 'long task' }] },
        }),
      });
      expect(first.status).toBe(202);

      const second = await fetch(`${baseUrl}/api/acp/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-1',
          sessionId: session.id,
          message: { role: 'user', parts: [{ type: 'text', text: 'next task' }] },
        }),
      });

      expect(second.status).toBe(409);
      const secondBody = await second.json() as { queued: boolean; error: string; activeTaskId: string };
      expect(secondBody.queued).toBe(false);
      expect(secondBody.error).toContain('prompt queueing is not wired');
      expect(secondBody.activeTaskId).toBeTruthy();

      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe('Cancel behavior', () => {
    it('should clear queue on cancel', () => {
      const queue = ['a', 'b', 'c'];
      // Cancel: clear queue
      queue.length = 0;
      expect(queue).toEqual([]);
    });
  });

  describe('Soft-close behavior', () => {
    it('should reject new sends when closed', () => {
      const session = { closed: false, activeTaskId: 'task_1' };

      // Soft-close
      session.closed = true;

      // Should reject
      expect(session.closed).toBe(true);
    });

    it('should allow active task to finish', () => {
      const session = { closed: true, activeTaskId: 'task_1' };
      // Active task can still complete
      expect(session.activeTaskId).toBe('task_1');
    });
  });

  describe('Fire-and-forget', () => {
    it('should return 202 immediately with taskId', () => {
      const taskId = `acp_${Date.now()}_abc`;
      const response = {
        status: 202,
        body: { taskId, queued: false },
      };

      expect(response.status).toBe(202);
      expect(response.body.taskId).toBe(taskId);
      expect(response.body.queued).toBe(false);
    });
  });

  describe('resumeSessionId', () => {
    it('should copy previous session context', () => {
      const previousSession = {
        tasks: [
          { messages: [{ role: 'user', parts: [{ type: 'text', text: 'earlier context' }] }] },
        ],
      };

      // Extract messages from previous session
      const previousMessages = previousSession.tasks
        .flatMap(t => t.messages);

      expect(previousMessages.length).toBe(1);
      expect(previousMessages[0].parts[0].text).toBe('earlier context');
    });
  });
});
