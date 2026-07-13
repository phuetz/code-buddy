import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '../src/renderer/types';

const mocks = vi.hoisted(() => ({
  clearSessionBuffer: vi.fn(),
  handlePermissionRequest: vi.fn(),
  isRemoteSession: vi.fn(),
  sendResponseToChannel: vi.fn(),
  sendToolProgress: vi.fn(),
  webContentsSend: vi.fn(),
}));

vi.mock('../src/main/remote/remote-manager', () => ({
  remoteManager: {
    clearSessionBuffer: mocks.clearSessionBuffer,
    handlePermissionRequest: mocks.handlePermissionRequest,
    isRemoteSession: mocks.isRemoteSession,
    sendResponseToChannel: mocks.sendResponseToChannel,
    sendToolProgress: mocks.sendToolProgress,
  },
}));

vi.mock('../src/main/window-management', () => ({
  getMainWindow: () => ({
    isDestroyed: () => false,
    webContents: { send: mocks.webContentsSend },
  }),
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { sendToRenderer, setPermissionResponder } from '../src/main/ipc-main-bridge';

describe('ipc-main-bridge remote event routing', () => {
  beforeEach(() => {
    mocks.isRemoteSession.mockReturnValue(true);
    mocks.clearSessionBuffer.mockResolvedValue(undefined);
    mocks.handlePermissionRequest.mockResolvedValue({ allow: true });
    mocks.sendResponseToChannel.mockResolvedValue(undefined);
    mocks.sendToolProgress.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setPermissionResponder(null);
    vi.clearAllMocks();
  });

  it('forwards assistant text blocks to the remote channel', () => {
    sendToRenderer({
      type: 'stream.message',
      payload: {
        sessionId: 'remote-session',
        message: {
          id: 'message-1',
          sessionId: 'remote-session',
          role: 'assistant',
          content: [
            { type: 'text', text: 'First line' },
            { type: 'thinking', thinking: 'not user-visible' },
            { type: 'text', text: 'Second line' },
          ],
          timestamp: 1,
        },
      },
    });

    expect(mocks.sendResponseToChannel).toHaveBeenCalledOnce();
    expect(mocks.sendResponseToChannel).toHaveBeenCalledWith(
      'remote-session',
      'First line\nSecond line'
    );
  });

  it.each([
    ['pending', 'running'],
    ['running', 'running'],
    ['completed', 'completed'],
    ['error', 'error'],
  ] as const)('maps a %s tool trace to %s remote progress', (status, remoteStatus) => {
    sendToRenderer({
      type: 'trace.step',
      payload: {
        sessionId: 'remote-session',
        step: {
          id: `step-${status}`,
          type: 'tool_call',
          status,
          title: 'Run tool',
          toolName: 'bash',
          timestamp: 1,
        },
      },
    });

    expect(mocks.sendToolProgress).toHaveBeenCalledOnce();
    expect(mocks.sendToolProgress).toHaveBeenCalledWith(
      'remote-session',
      'bash',
      remoteStatus
    );
  });

  it.each(['idle', 'error'] as const)(
    'clears the remote buffer when the session becomes %s',
    (status) => {
      sendToRenderer({
        type: 'session.status',
        payload: { sessionId: 'remote-session', status },
      });

      expect(mocks.clearSessionBuffer).toHaveBeenCalledOnce();
      expect(mocks.clearSessionBuffer).toHaveBeenCalledWith('remote-session');
    }
  );

  it.each(['running', 'completed'] as const)(
    'keeps the remote buffer while the session is %s',
    (status) => {
      sendToRenderer({
        type: 'session.status',
        payload: { sessionId: 'remote-session', status },
      });

      expect(mocks.clearSessionBuffer).not.toHaveBeenCalled();
    }
  );

  it.each([
    [{ allow: true }, 'allow'],
    [{ allow: true, remember: true }, 'allow_always'],
    [{ allow: false, remember: true }, 'deny'],
  ] as const)('maps a remote permission result to %s', async (result, response) => {
    mocks.handlePermissionRequest.mockResolvedValue(result);
    const responder = vi.fn();
    setPermissionResponder(responder);

    sendToRenderer({
      type: 'permission.request',
      payload: {
        sessionId: 'remote-session',
        toolUseId: 'tool-1',
        toolName: 'bash',
        input: { command: 'pwd' },
        bridgeId: 'bridge-1',
      },
    });

    await vi.waitFor(() =>
      expect(responder).toHaveBeenCalledWith('tool-1', response, 'bridge-1')
    );
    expect(mocks.handlePermissionRequest).toHaveBeenCalledWith(
      'remote-session',
      'tool-1',
      'bash',
      { command: 'pwd' }
    );
    expect(mocks.webContentsSend).not.toHaveBeenCalled();
  });

  it('falls back to the local renderer when remote permission handling declines', async () => {
    mocks.handlePermissionRequest.mockResolvedValue(null);
    const responder = vi.fn();
    setPermissionResponder(responder);
    const event: ServerEvent = {
      type: 'permission.request',
      payload: {
        sessionId: 'remote-session',
        toolUseId: 'tool-fallback',
        toolName: 'bash',
        input: { command: 'pwd' },
      },
    };

    sendToRenderer(event);

    await vi.waitFor(() =>
      expect(mocks.webContentsSend).toHaveBeenCalledWith('server-event', event)
    );
    expect(responder).not.toHaveBeenCalled();
  });

  it('sends non-remote events only to the local renderer', () => {
    mocks.isRemoteSession.mockReturnValue(false);
    const event: ServerEvent = {
      type: 'session.status',
      payload: { sessionId: 'local-session', status: 'idle' },
    };

    sendToRenderer(event);

    expect(mocks.webContentsSend).toHaveBeenCalledOnce();
    expect(mocks.webContentsSend).toHaveBeenCalledWith('server-event', event);
    expect(mocks.sendResponseToChannel).not.toHaveBeenCalled();
    expect(mocks.sendToolProgress).not.toHaveBeenCalled();
    expect(mocks.clearSessionBuffer).not.toHaveBeenCalled();
    expect(mocks.handlePermissionRequest).not.toHaveBeenCalled();
  });
});
