import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeBuddyAdapter } from '../src/main/codebuddy/codebuddy-adapter';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

describe('CodeBuddyAdapter honesty', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('throws instead of returning empty chat content on HTTP errors', async () => {
    const adapter = new CodeBuddyAdapter({ endpoint: 'http://codebuddy.test' });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });

    await expect(adapter.chatSync([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'Code Buddy chatSync failed: HTTP 500 Server Error'
    );
  });

  it('throws when chatSync returns no assistant content', async () => {
    const adapter = new CodeBuddyAdapter({ endpoint: 'http://codebuddy.test' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    });

    await expect(adapter.chatSync([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'Code Buddy chatSync returned empty content'
    );
  });

  it('throws when submitTask succeeds without a task id', async () => {
    const adapter = new CodeBuddyAdapter({ endpoint: 'http://codebuddy.test' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await expect(adapter.submitTask('do work')).rejects.toThrow(
      'Code Buddy submitTask returned no task id'
    );
  });

  it('throws instead of returning unknown status on status HTTP errors', async () => {
    const adapter = new CodeBuddyAdapter({ endpoint: 'http://codebuddy.test' });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

    await expect(adapter.getTaskStatus('task_123')).rejects.toThrow(
      'Code Buddy getTaskStatus failed: HTTP 404 Not Found'
    );
  });
});
