/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ipcHook = vi.hoisted(() => ({
  startSession: vi.fn(),
  continueSession: vi.fn(),
}));

vi.mock('../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ipcHook,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>
    ) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) =>
          value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template
      );
    },
  }),
}));

import { VoiceChatOverlay } from '../src/renderer/components/VoiceChatOverlay';
import { useAppStore } from '../src/renderer/store';
import { MissionStatus, SubTaskStatus, type Mission } from '../src/main/missions/mission-types';
import { VOICE_MISSION_EVENT } from '../src/shared/voice-background-mission';

function voiceMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'voice-mission-1',
    title: 'Recherche robotique',
    description: 'Faire une recherche approfondie sur la robotique.',
    status: MissionStatus.Running,
    subTasks: [
      {
        id: 'voice-task-1',
        title: 'Exécuter la mission',
        status: SubTaskStatus.Running,
        progress: 10,
        result: { sessionId: 'background-session-1' },
      },
    ],
    progress: 0,
    createdAt: '2026-07-12T04:00:00.000Z',
    updatedAt: '2026-07-12T04:01:00.000Z',
    events: [
      {
        ts: '2026-07-12T04:00:00.000Z',
        type: VOICE_MISSION_EVENT.queued,
        message: 'Queued',
      },
      {
        ts: '2026-07-12T04:01:00.000Z',
        type: VOICE_MISSION_EVENT.sessionStarted,
        message: 'Started',
        data: { sessionId: 'background-session-1' },
      },
    ],
    costUsd: 0,
    tokens: 0,
    ...overrides,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('VoiceChatOverlay background missions', () => {
  let root: Root | null = null;
  let target: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    target = document.createElement('div');
    document.body.appendChild(target);
    localStorage.clear();
    ipcHook.startSession.mockReset();
    ipcHook.continueSession.mockReset();
    useAppStore.setState({
      activeSessionId: null,
      activeProjectId: null,
      workingDir: '/workspace',
      sessions: [],
      missionRuntime: {},
      missionRuntimeEvents: {},
      missionRuntimeHeartbeats: {},
      primaryView: 'chat',
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('runs a direct voice turn with a guarded override without changing a plan session', async () => {
    const onClose = vi.fn();
    ipcHook.continueSession.mockResolvedValue(undefined);
    (
      window as unknown as {
        electronAPI?: {
          missions: {
            list: () => Promise<{ ok: boolean; missions: Mission[] }>;
          };
          voice: {
            conversationStatus: () => Promise<null>;
            recordConversationEvent: () => Promise<{ ok: true }>;
          };
        };
      }
    ).electronAPI = {
      missions: {
        list: async () => ({ ok: true, missions: [] }),
      },
      voice: {
        conversationStatus: async () => null,
        recordConversationEvent: async () => ({ ok: true }),
      },
    };
    useAppStore.setState({
      activeSessionId: 'coding-plan-session',
      sessions: [
        {
          id: 'coding-plan-session',
          title: 'Plan de code',
          status: 'idle',
          cwd: '/workspace',
          mountedPaths: [],
          allowedTools: [],
          memoryEnabled: false,
          permissionMode: 'plan',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    root = createRoot(target);
    await act(async () => {
      root?.render(<VoiceChatOverlay isOpen onClose={onClose} />);
      await flush();
    });

    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      Simulate.change(textarea, { target: { value: 'Quel temps fait-il ?' } } as never);
      await flush();
    });
    await act(async () => {
      Simulate.click(target.querySelector('[data-testid="voice-overlay-send"]') as Element);
      await flush();
    });

    await vi.waitFor(() => expect(ipcHook.continueSession).toHaveBeenCalledTimes(1));
    expect(ipcHook.continueSession).toHaveBeenCalledWith(
      'coding-plan-session',
      'Quel temps fait-il ?',
      { conversationMode: 'companion', permissionModeOverride: 'default' }
    );
    expect(useAppStore.getState().sessions[0]?.permissionMode).toBe('plan');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit mission choice, acknowledges immediately, and keeps the overlay open', async () => {
    const mission = voiceMission({ status: MissionStatus.Planning, progress: 0 });
    const createVoice = vi.fn(async () => ({ ok: true, mission }));
    const cancel = vi.fn();
    const onClose = vi.fn();
    (
      window as unknown as {
        electronAPI?: {
          missions: {
            list: () => Promise<{ ok: boolean; missions: Mission[] }>;
            createVoice: typeof createVoice;
            cancel: typeof cancel;
          };
          voice: {
            conversationStatus: () => Promise<null>;
            recordConversationEvent: () => Promise<{ ok: true }>;
          };
        };
      }
    ).electronAPI = {
      missions: {
        list: async () => ({ ok: true, missions: [] }),
        createVoice,
        cancel,
      },
      voice: {
        conversationStatus: async () => null,
        recordConversationEvent: async () => ({ ok: true }),
      },
    };

    root = createRoot(target);
    await act(async () => {
      root?.render(<VoiceChatOverlay isOpen onClose={onClose} />);
      await flush();
    });

    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      Simulate.change(textarea, {
        target: {
          value:
            'Fais une recherche approfondie puis crée un rapport détaillé avec plusieurs étapes.',
        },
      } as never);
      await flush();
    });

    expect(target.querySelector('[data-testid="voice-mission-recommendation"]')).not.toBeNull();
    expect(createVoice).not.toHaveBeenCalled();

    await act(async () => {
      Simulate.click(
        target.querySelector('[data-testid="voice-mission-mode-background"]') as Element
      );
      await flush();
    });
    await act(async () => {
      Simulate.click(target.querySelector('[data-testid="voice-overlay-send"]') as Element);
      await flush();
    });

    await vi.waitFor(() => expect(createVoice).toHaveBeenCalledTimes(1));
    expect(createVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('recherche approfondie'),
        cwd: '/workspace',
      })
    );
    expect(target.querySelector('[data-testid="voice-mission-ack"]')?.textContent).toContain(
      'Mission lancée en arrière-plan'
    );
    expect(
      target.querySelector('[data-testid="voice-mission-row-voice-mission-1"]')
    ).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(ipcHook.startSession).not.toHaveBeenCalled();
    expect(ipcHook.continueSession).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('only cancels by explicit id and opens a terminal mission result session', async () => {
    const running = voiceMission();
    const completed = voiceMission({
      id: 'voice-mission-complete',
      status: MissionStatus.Completed,
      progress: 100,
      updatedAt: '2026-07-12T05:00:00.000Z',
      events: [
        ...running.events,
        {
          ts: '2026-07-12T05:00:00.000Z',
          type: VOICE_MISSION_EVENT.completed,
          message: 'Completed',
          data: {
            sessionId: 'background-session-1',
            resultPreview: 'Rapport prêt.',
          },
        },
      ],
    });
    const cancel = vi.fn(async () => ({
      ok: true,
      mission: { ...running, status: MissionStatus.Cancelled },
    }));
    const onClose = vi.fn();
    (
      window as unknown as {
        electronAPI?: {
          missions: {
            list: () => Promise<{ ok: boolean; missions: Mission[] }>;
            createVoice: () => Promise<never>;
            cancel: typeof cancel;
          };
          voice: { conversationStatus: () => Promise<null> };
        };
      }
    ).electronAPI = {
      missions: {
        list: async () => ({ ok: true, missions: [running, completed] }),
        createVoice: async () => {
          throw new Error('not used');
        },
        cancel,
      },
      voice: { conversationStatus: async () => null },
    };
    useAppStore.setState({
      sessions: [
        {
          id: 'background-session-1',
          title: 'Résultat mission',
          status: 'idle',
          mountedPaths: [],
          allowedTools: [],
          memoryEnabled: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    root = createRoot(target);
    await act(async () => {
      root?.render(<VoiceChatOverlay isOpen onClose={onClose} />);
      await flush();
    });

    await vi.waitFor(() =>
      expect(
        target.querySelector('[data-testid="voice-mission-cancel-voice-mission-1"]')
      ).not.toBeNull()
    );
    await act(async () => {
      Simulate.click(
        target.querySelector('[data-testid="voice-mission-cancel-voice-mission-1"]') as Element
      );
      await flush();
    });
    expect(cancel).toHaveBeenCalledWith('voice-mission-1');

    await act(async () => {
      Simulate.click(
        target.querySelector('[data-testid="voice-mission-open-voice-mission-complete"]') as Element
      );
      await flush();
    });
    expect(useAppStore.getState().activeSessionId).toBe('background-session-1');
    expect(useAppStore.getState().primaryView).toBe('chat');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
