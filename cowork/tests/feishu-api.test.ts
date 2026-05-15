import { describe, expect, it, vi } from 'vitest';
import { FeishuAPI } from '../src/main/remote/channels/feishu/feishu-api';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

describe('FeishuAPI', () => {
  it('fails typing indicators explicitly instead of reporting no-op success', async () => {
    const api = new FeishuAPI('app-id', 'app-secret');

    await expect(api.sendTypingIndicator('chat-id')).rejects.toThrow(
      'Feishu does not support typing indicators'
    );
  });
});
