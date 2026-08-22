import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '../renderer/types';

/**
 * Confirmation-delivery routing (App Studio "Generate with AI" bug class):
 * tool-approval modals must reach the ACTIVE (focused) renderer, never only a
 * background window where they silently expire. These tests pin the routing:
 * confirmation events fan out to {focused, main} (deduped, live-only); every
 * other event keeps the historical single-target `getMainWindow()` path.
 */

type FakeWin = {
  id: number;
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
};

const state = vi.hoisted(() => ({
  focused: null as FakeWin | null,
  main: null as FakeWin | null,
}));

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => state.focused },
}));
vi.mock('./window-management', () => ({ getMainWindow: () => state.main }));
vi.mock('./remote/remote-manager', () => ({
  remoteManager: { isRemoteSession: () => false },
}));
vi.mock('./utils/logger', () => ({ log: vi.fn(), logError: vi.fn() }));

import { sendToRenderer } from './ipc-main-bridge';

function makeWin(id: number, destroyed = false): FakeWin {
  return { id, isDestroyed: () => destroyed, webContents: { send: vi.fn() } };
}

const permissionEvent = {
  type: 'permission.request',
  payload: { toolUseId: 't1', toolName: 'create_file', input: {}, sessionId: 'engine', bridgeId: 't1' },
} as unknown as ServerEvent;

const streamEvent = {
  type: 'stream.message',
  payload: { sessionId: 's1', message: { role: 'assistant', content: [] } },
} as unknown as ServerEvent;

describe('ipc-main-bridge confirmation delivery', () => {
  beforeEach(() => {
    state.focused = null;
    state.main = null;
  });

  it('single window: delivers a confirmation exactly once (focused === main)', () => {
    const win = makeWin(1);
    state.focused = win;
    state.main = win;
    sendToRenderer(permissionEvent);
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith('server-event', permissionEvent);
  });

  it('active renderer differs from main: confirmation reaches BOTH (never background-only)', () => {
    const focused = makeWin(2);
    const main = makeWin(1);
    state.focused = focused;
    state.main = main;
    sendToRenderer(permissionEvent);
    expect(focused.webContents.send).toHaveBeenCalledWith('server-event', permissionEvent);
    expect(main.webContents.send).toHaveBeenCalledWith('server-event', permissionEvent);
  });

  it('falls back to main when no window is focused', () => {
    const main = makeWin(1);
    state.focused = null;
    state.main = main;
    sendToRenderer(permissionEvent);
    expect(main.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('skips destroyed windows for confirmations', () => {
    const focused = makeWin(2, /* destroyed */ true);
    const main = makeWin(1);
    state.focused = focused;
    state.main = main;
    sendToRenderer(permissionEvent);
    expect(focused.webContents.send).not.toHaveBeenCalled();
    expect(main.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('non-confirmation events keep the single-target main-window path', () => {
    const focused = makeWin(2);
    const main = makeWin(1);
    state.focused = focused;
    state.main = main;
    sendToRenderer(streamEvent);
    // Historical behaviour: only getMainWindow() receives it, never the
    // focused-but-not-main window.
    expect(main.webContents.send).toHaveBeenCalledWith('server-event', streamEvent);
    expect(focused.webContents.send).not.toHaveBeenCalled();
  });
});
