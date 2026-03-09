/**
 * Tests for A2A Protocol (Agent-to-Agent Communication)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  A2AAgentServer,
  A2AAgentClient,
  TaskStatus,
  createAgentCard,
  getTaskResult,
  type AgentCard,
  type Task,
} from '../../src/protocols/a2a/index.js';

describe('A2A Protocol', () => {
  function createTestCard(name: string): AgentCard {
    return createAgentCard({
      name,
      description: `${name} agent`,
      skills: [
        { id: 'code', name: 'Code', description: 'Write code', inputModes: ['text/plain'], outputModes: ['text/plain'] },
      ],
    });
  }

  describe('AgentCard', () => {
    it('creates a valid agent card', () => {
      const card = createAgentCard({
        name: 'SWE Agent',
        description: 'Software engineering agent',
        skills: [
          { id: 'edit', name: 'Edit', description: 'Edit files', inputModes: ['text/plain'], outputModes: ['text/plain'] },
        ],
      });

      expect(card.name).toBe('SWE Agent');
      expect(card.version).toBe('1.0.0');
      expect(card.skills).toHaveLength(1);
      expect(card.capabilities.streaming).toBe(false);
    });
  });

  describe('A2AAgentServer', () => {
    it('submits and executes a task', async () => {
      const executor = vi.fn(async (task: Task) => {
        task.artifacts.push({
          name: 'result',
          parts: [{ type: 'text', text: 'Hello from agent' }],
        });
        return task;
      });

      const server = new A2AAgentServer(createTestCard('test'), executor);

      const task = await server.submitTask({
        id: 'task-1',
        message: { role: 'user', parts: [{ type: 'text', text: 'Do something' }] },
      });

      expect(task.status.status).toBe(TaskStatus.COMPLETED);
      expect(task.artifacts).toHaveLength(1);
      expect(executor).toHaveBeenCalled();
    });

    it('handles executor failure', async () => {
      const executor = vi.fn(async () => {
        throw new Error('Agent crashed');
      });

      const server = new A2AAgentServer(createTestCard('failing'), executor);

      const task = await server.submitTask({
        id: 'task-2',
        message: { role: 'user', parts: [{ type: 'text', text: 'Crash' }] },
      });

      expect(task.status.status).toBe(TaskStatus.FAILED);
      expect(task.status.message).toContain('Agent crashed');
    });

    it('tracks task history', async () => {
      const executor = vi.fn(async (task: Task) => task);
      const server = new A2AAgentServer(createTestCard('test'), executor);

      const task = await server.submitTask({
        id: 'task-3',
        message: { role: 'user', parts: [{ type: 'text', text: 'Track me' }] },
      });

      expect(task.history).toHaveLength(3); // SUBMITTED → WORKING → COMPLETED
      expect(task.history[0].status).toBe(TaskStatus.SUBMITTED);
      expect(task.history[1].status).toBe(TaskStatus.WORKING);
      expect(task.history[2].status).toBe(TaskStatus.COMPLETED);
    });

    it('cancels a task', async () => {
      // Create a task that will hang
      let resolveTask: (t: Task) => void;
      const executor = vi.fn(
        () => new Promise<Task>((resolve) => { resolveTask = resolve; })
      );

      const server = new A2AAgentServer(createTestCard('test'), executor);

      // Start task (don't await)
      const taskPromise = server.submitTask({
        id: 'task-4',
        message: { role: 'user', parts: [{ type: 'text', text: 'Cancel me' }] },
      });

      // Cancel it
      const cancelled = server.cancelTask('task-4');
      expect(cancelled).toBe(true);

      // Resolve the executor to clean up
      resolveTask!(server.getTask('task-4')!);
      await taskPromise;
    });

    it('emits events', async () => {
      const events: string[] = [];
      const executor = vi.fn(async (task: Task) => task);

      const server = new A2AAgentServer(createTestCard('test'), executor);
      server.on('task:submitted', () => events.push('submitted'));
      server.on('task:completed', () => events.push('completed'));

      await server.submitTask({
        id: 'task-5',
        message: { role: 'user', parts: [{ type: 'text', text: 'Events' }] },
      });

      expect(events).toEqual(['submitted', 'completed']);
    });
  });

  describe('A2AAgentClient', () => {
    it('registers and lists agents', () => {
      const client = new A2AAgentClient();
      const server = new A2AAgentServer(createTestCard('swe'), vi.fn(async (t: Task) => t));

      client.registerAgent('swe', server);
      expect(client.listAgents()).toEqual(['swe']);
    });

    it('discovers agent cards', () => {
      const client = new A2AAgentClient();
      const card = createTestCard('swe');
      const server = new A2AAgentServer(card, vi.fn(async (t: Task) => t));

      client.registerAgent('swe', server);
      expect(client.getAgentCard('swe')).toEqual(card);
    });

    it('finds agents by skill', () => {
      const client = new A2AAgentClient();

      const sweCard = createAgentCard({
        name: 'SWE',
        description: 'Code',
        skills: [{ id: 'edit', name: 'Edit', description: 'Edit files', inputModes: ['text/plain'], outputModes: ['text/plain'] }],
      });
      const browserCard = createAgentCard({
        name: 'Browser',
        description: 'Browse',
        skills: [{ id: 'browse', name: 'Browse', description: 'Browse web', inputModes: ['text/plain'], outputModes: ['text/plain'] }],
      });

      client.registerAgent('swe', new A2AAgentServer(sweCard, vi.fn(async (t: Task) => t)));
      client.registerAgent('browser', new A2AAgentServer(browserCard, vi.fn(async (t: Task) => t)));

      expect(client.findAgentsWithSkill('edit')).toEqual(['swe']);
      expect(client.findAgentsWithSkill('browse')).toEqual(['browser']);
      expect(client.findAgentsWithSkill('unknown')).toEqual([]);
    });

    it('submits task to agent', async () => {
      const client = new A2AAgentClient();
      const executor = vi.fn(async (task: Task) => {
        task.artifacts.push({ name: 'out', parts: [{ type: 'text', text: 'Done' }] });
        return task;
      });

      client.registerAgent('swe', new A2AAgentServer(createTestCard('swe'), executor));

      const task = await client.submitTask('swe', 'Fix the bug');
      expect(task.status.status).toBe(TaskStatus.COMPLETED);
      expect(getTaskResult(task)).toBe('Done');
    });

    it('throws for unknown agent', async () => {
      const client = new A2AAgentClient();
      await expect(client.submitTask('unknown', 'test')).rejects.toThrow('Agent not found');
    });
  });

  describe('getTaskResult', () => {
    it('extracts from artifacts', () => {
      const task: Task = {
        id: 't1',
        sessionId: 's1',
        status: { status: TaskStatus.COMPLETED, timestamp: Date.now() },
        messages: [],
        artifacts: [{ name: 'out', parts: [{ type: 'text', text: 'Result here' }] }],
        history: [],
      };
      expect(getTaskResult(task)).toBe('Result here');
    });

    it('falls back to last agent message', () => {
      const task: Task = {
        id: 't2',
        sessionId: 's2',
        status: { status: TaskStatus.COMPLETED, timestamp: Date.now() },
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
          { role: 'agent', parts: [{ type: 'text', text: 'Agent reply' }] },
        ],
        artifacts: [],
        history: [],
      };
      expect(getTaskResult(task)).toBe('Agent reply');
    });
  });
});
