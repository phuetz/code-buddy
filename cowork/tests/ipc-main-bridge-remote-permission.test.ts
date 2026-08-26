import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlePermissionRequest: vi.fn(),
  isRemoteSession: vi.fn(),
  webContentsSend: vi.fn(),
}));

vi.mock('../src/main/remote/remote-manager', () => ({
  remoteManager: {
    isRemoteSession: mocks.isRemoteSession,
    handlePermissionRequest: mocks.handlePermissionRequest,
    sendResponseToChannel: vi.fn(),
    sendToolProgress: vi.fn(),
    clearSessionBuffer: vi.fn(),
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

describe('ipc-main-bridge remote permissions', () => {
  beforeEach(() => {
    mocks.isRemoteSession.mockReturnValue(true);
    mocks.handlePermissionRequest.mockResolvedValue({ allow: true });
  });

  afterEach(() => {
    setPermissionResponder(null);
    vi.clearAllMocks();
  });

  it('applies an allowed remote response instead of forwarding it to the renderer', async () => {
    const responder = vi.fn();
    setPermissionResponder(responder);

    sendToRenderer({
      type: 'permission.request',
      payload: {
        sessionId: 'remote-session',
        toolUseId: 'tool-1',
        toolName: 'bash',
        input: { command: 'pwd' },
      },
    });
    await vi.waitFor(() => expect(responder).toHaveBeenCalledWith('tool-1', 'allow', undefined));

    expect(mocks.webContentsSend).not.toHaveBeenCalled();
  });

  it('routes remembered engine approvals through the bridge id', async () => {
    mocks.handlePermissionRequest.mockResolvedValue({ allow: true, remember: true });
    const responder = vi.fn();
    setPermissionResponder(responder);

    sendToRenderer({
      type: 'permission.request',
      payload: {
        sessionId: 'remote-session',
        toolUseId: 'tool-2',
        toolName: 'write_file',
        input: { path: 'notes.txt' },
        bridgeId: 'engine-bridge-2',
      },
    });
    await vi.waitFor(() =>
      expect(responder).toHaveBeenCalledWith('tool-2', 'allow_always', 'engine-bridge-2')
    );
  });
});
