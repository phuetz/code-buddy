import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageRouter } from '../src/main/remote/message-router';
import type { RemoteContent, RemoteMessage } from '../src/main/remote/types';
import type { ContentBlock, Message } from '../src/renderer/types';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

function makeMessage(content: RemoteContent): RemoteMessage {
  return {
    id: 'remote-msg-1',
    channelType: 'feishu',
    channelId: 'chat-1',
    sender: {
      id: 'user-1',
      isBot: false,
    },
    content,
    timestamp: Date.now(),
    isGroup: false,
  };
}

describe('MessageRouter media metadata', () => {
  let router: MessageRouter;
  let capturedContent: ContentBlock[];

  beforeEach(() => {
    router = new MessageRouter();
    capturedContent = [];
    router.setAgentCallback(
      vi.fn(
        async (
          _sessionId: string,
          _prompt: string,
          content: ContentBlock[],
          _workingDirectory: string | undefined,
          _channelType: string,
          _channelId: string,
          _senderId: string,
          _onMessage: (message: Message) => void,
          _onPartial: (delta: string) => void
        ): Promise<void> => {
          capturedContent = content;
        }
      )
    );
  });

  afterEach(() => {
    router.stopPeriodicCleanup();
  });

  it('keeps Feishu image keys visible instead of dropping the image silently', async () => {
    await router.routeMessage(makeMessage({ type: 'image', imageKey: 'img-key-123' }));

    expect(capturedContent).toHaveLength(1);
    expect(capturedContent[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('key=img-key-123'),
    });
    expect((capturedContent[0] as { text: string }).text).toContain(
      'Image bytes were not attached'
    );
  });

  it('preserves file and voice metadata while declaring missing bytes or transcription', async () => {
    await router.routeMessage(
      makeMessage({
        type: 'file',
        file: {
          name: 'report.pdf',
          key: 'file-key-123',
          size: 4096,
          mimeType: 'application/pdf',
        },
      })
    );

    expect((capturedContent[0] as { text: string }).text).toContain('name=report.pdf');
    expect((capturedContent[0] as { text: string }).text).toContain('key=file-key-123');
    expect((capturedContent[0] as { text: string }).text).toContain(
      'File bytes were not attached'
    );

    await router.routeMessage(
      makeMessage({
        type: 'voice',
        voice: {
          key: 'voice-key-123',
          duration: 8,
        },
      })
    );

    expect((capturedContent[0] as { text: string }).text).toContain('key=voice-key-123');
    expect((capturedContent[0] as { text: string }).text).toContain('duration=8s');
    expect((capturedContent[0] as { text: string }).text).toContain(
      'Audio transcription is not available'
    );
  });
});
