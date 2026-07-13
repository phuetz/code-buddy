import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  MeetingDisplayAudioBroker,
  type MeetingDisplayAudioOptions,
} from '../src/main/meeting/meeting-display-audio';

function runtimeFixture(
  platform: NodeJS.Platform = 'win32',
  options: Omit<MeetingDisplayAudioOptions, 'platform'> = {},
) {
  let handler: ((request: Record<string, unknown>, callback: (streams: unknown) => void) => void) | null = null;
  const electronSession = {
    setDisplayMediaRequestHandler: vi.fn((value) => {
      handler = value;
    }),
  };
  const desktopCapturer = {
    getSources: vi.fn(async () => [{ id: 'screen:0:0', name: 'Screen 1' }]),
  };
  const broker = new MeetingDisplayAudioBroker({ platform, ...options });
  broker.install(electronSession as never, desktopCapturer as never);
  const frame = {
    frameTreeNodeId: 42,
    isDestroyed: () => false,
  };
  const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame: frame });
  const mainWindow = {
    isDestroyed: () => false,
    webContents: sender,
  };
  return { broker, desktopCapturer, handler: () => handler!, frame, sender, mainWindow };
}

describe('MeetingDisplayAudioBroker', () => {
  it('reports loopback unavailable on unsupported platforms instead of claiming support', () => {
    const { broker, sender, mainWindow } = runtimeFixture('darwin');

    expect(broker.capability()).toMatchObject({ state: 'unavailable' });
    expect(broker.arm(sender as never, mainWindow as never)).toMatchObject({
      ok: false,
      state: 'unavailable',
    });
  });

  it('creates and releases an ephemeral PipeWire source for the Linux default sink', () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(function kill(this: { signalCode: NodeJS.Signals | null }, signal: NodeJS.Signals) {
        this.signalCode = signal;
        return true;
      }),
    });
    const spawnProcess = vi.fn(() => child as never);
    const spawnSyncProcess = vi.fn(() => ({
      status: 0,
      stdout: '  * node.name = "alsa_output.pci-0000_c6_00.6.analog-stereo"\n',
      stderr: '',
    }));
    const { broker, sender, mainWindow } = runtimeFixture('linux', {
      executableExists: () => true,
      spawnProcess,
      spawnSyncProcess,
      pwLoopbackPath: '/test/pw-loopback',
      wpctlPath: '/test/wpctl',
    });

    expect(broker.capability()).toMatchObject({ state: 'runtime-probe' });
    const armed = broker.arm(sender as never, mainWindow as never);
    expect(armed).toMatchObject({
      ok: true,
      state: 'runtime-probe',
      method: 'pipewire-virtual-source',
      leaseId: expect.any(String),
      deviceLabel: expect.stringMatching(/^CodeBuddy-System-Audio-/u),
    });
    expect(spawnSyncProcess).toHaveBeenCalledWith(
      '/test/wpctl',
      ['inspect', '@DEFAULT_AUDIO_SINK@'],
      expect.objectContaining({ timeout: 2_000 }),
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      '/test/pw-loopback',
      expect.arrayContaining([
        '--capture',
        'alsa_output.pci-0000_c6_00.6.analog-stereo',
      ]),
      { stdio: 'ignore', windowsHide: true },
    );

    expect(broker.release(armed.leaseId!)).toEqual({ ok: true });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(broker.release(armed.leaseId!)).toEqual({ ok: true });
  });

  it('grants one user-gesture loopback request only to the armed main frame', async () => {
    const { broker, desktopCapturer, handler, frame, sender, mainWindow } = runtimeFixture();
    const attacker = { id: 99, mainFrame: { ...frame, frameTreeNodeId: 99 } };
    expect(broker.arm(attacker as never, mainWindow as never).ok).toBe(false);
    expect(broker.arm(sender as never, mainWindow as never)).toEqual({
      ok: true,
      state: 'runtime-probe',
      method: 'electron-loopback',
    });

    const firstCallback = vi.fn();
    handler()({
      frame: { ...frame, top: frame },
      audioRequested: true,
      videoRequested: true,
      userGesture: true,
      securityOrigin: 'file://',
    }, firstCallback);
    await vi.waitFor(() => expect(firstCallback).toHaveBeenCalled());
    expect(firstCallback).toHaveBeenCalledWith({
      video: expect.objectContaining({ id: 'screen:0:0' }),
      audio: 'loopback',
    });

    const replayCallback = vi.fn();
    handler()({
      frame: { ...frame, top: frame },
      audioRequested: true,
      videoRequested: true,
      userGesture: true,
      securityOrigin: 'file://',
    }, replayCallback);
    await vi.waitFor(() => expect(replayCallback).toHaveBeenCalledWith({}));
    expect(desktopCapturer.getSources).toHaveBeenCalledTimes(1);
  });

  it('rejects requests without an active user gesture and consumes the arm', async () => {
    const { broker, handler, frame, sender, mainWindow } = runtimeFixture();
    broker.arm(sender as never, mainWindow as never);
    const callback = vi.fn();

    handler()({
      frame: { ...frame, top: frame },
      audioRequested: true,
      videoRequested: true,
      userGesture: false,
      securityOrigin: 'file://',
    }, callback);

    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith({}));
    expect(broker.isArmedFor(sender as never)).toBe(false);
  });
});
