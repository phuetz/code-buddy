import { describe, expect, it } from 'vitest';
import {
  A2AAgentServer,
  TaskStatus,
  createAgentCard,
  type Task,
} from '../../src/protocols/a2a/index.js';

describe('SERV1 A2A failed tasks stay failed', () => {
  it('does not overwrite an executor FAILED status with COMPLETED', async () => {
    const card = createAgentCard({
      name: 'QA',
      description: 'qa',
      skills: [{ id: 's', name: 'S', description: 'S', inputModes: ['text/plain'], outputModes: ['text/plain'] }],
    });
    const server = new A2AAgentServer(card, async (task: Task) => {
      task.status = {
        status: TaskStatus.FAILED,
        message: 'Provider API key not configured (GROK_API_KEY)',
        timestamp: Date.now(),
      };
      task.history.push({ ...task.status });
      return task;
    });

    const task = await server.submitTask({
      id: 'task-serv1-failed',
      message: { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    });

    expect(task.status.status).toBe(TaskStatus.FAILED);
    expect(task.status.message).toMatch(/GROK_API_KEY/);
    expect(task.history.map((h) => h.status)).not.toContain(TaskStatus.COMPLETED);
  });
});
