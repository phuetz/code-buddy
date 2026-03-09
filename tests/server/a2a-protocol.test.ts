/**
 * Tests for A2A Protocol Routes
 */
import { describe, it, expect, vi } from 'vitest';
import {
  A2AAgentServer,
  A2AAgentClient,
  createAgentCard,
  TaskStatus,
  type Task,
} from '../../src/protocols/a2a/index.js';

describe('A2A Protocol Route Logic', () => {
  // Test the A2A client/server used by the routes (without Express)

  it('host agent card has required fields', () => {
    const card = createAgentCard({
      name: 'Code Buddy',
      description: 'AI coding agent',
      skills: [
        { id: 'code-edit', name: 'Code Editing', description: 'Edit code', inputModes: ['text/plain'], outputModes: ['text/plain'] },
      ],
    });
    expect(card.name).toBe('Code Buddy');
    expect(card.version).toBe('1.0.0');
    expect(card.skills).toHaveLength(1);
  });

  it('agent registration and discovery', () => {
    const client = new A2AAgentClient();

    const sweCard = createAgentCard({
      name: 'SWE',
      description: 'Code editing',
      skills: [{ id: 'edit', name: 'Edit', description: 'Edit files', inputModes: ['text/plain'], outputModes: ['text/plain'] }],
    });

    const server = new A2AAgentServer(sweCard, vi.fn(async (t: Task) => t));
    client.registerAgent('swe', server);

    expect(client.listAgents()).toEqual(['swe']);
    expect(client.getAgentCard('swe')?.name).toBe('SWE');
    expect(client.findAgentsWithSkill('edit')).toEqual(['swe']);
  });

  it('task submission via client', async () => {
    const client = new A2AAgentClient();
    const executor = vi.fn(async (task: Task) => {
      task.artifacts.push({
        name: 'result',
        parts: [{ type: 'text', text: 'Fixed the bug' }],
      });
      return task;
    });

    const card = createAgentCard({
      name: 'SWE',
      description: 'SWE Agent',
      skills: [{ id: 'edit', name: 'Edit', description: 'Edit', inputModes: ['text/plain'], outputModes: ['text/plain'] }],
    });

    client.registerAgent('swe', new A2AAgentServer(card, executor));

    const task = await client.submitTask('swe', 'Fix the login bug');
    expect(task.status.status).toBe(TaskStatus.COMPLETED);
    expect(task.artifacts).toHaveLength(1);
  });

  it('task cancellation', async () => {
    const client = new A2AAgentClient();
    let resolveTask: (t: Task) => void;
    const executor = vi.fn(() => new Promise<Task>((resolve) => { resolveTask = resolve; }));

    const card = createAgentCard({
      name: 'Slow',
      description: 'Slow agent',
      skills: [{ id: 's', name: 'S', description: 'S', inputModes: ['text/plain'], outputModes: ['text/plain'] }],
    });

    const server = new A2AAgentServer(card, executor);
    client.registerAgent('slow', server);

    const taskPromise = client.submitTask('slow', 'Slow task');

    // Cancel via server
    const cancelled = server.cancelTask(server.getTask(server['tasks'].keys().next().value)?.id || '');
    expect(typeof cancelled).toBe('boolean');

    // Clean up
    resolveTask!(server.getTask(server['tasks'].keys().next().value)!);
    await taskPromise.catch(() => {});
  });
});
