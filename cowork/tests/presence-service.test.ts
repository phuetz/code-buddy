/**
 * @vitest-environment happy-dom
 *
 * PresenceService unit tests.
 *
 * Strategy: mock window.electronAPI.presence + navigator.mediaDevices +
 * the FaceDetector factory. We don't drive real time — the service uses
 * setInterval which we control via vi.useFakeTimers(). The detector
 * mock returns either an empty array or a single fake detection at the
 * test's request.
 *
 * Needs the happy-dom environment because PresenceService creates an
 * HTMLVideoElement via `document.createElement('video')`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockHasModel = vi.fn();
const mockList = vi.fn();
const mockEncode = vi.fn();
const mockMatch = vi.fn();
const mockGetUserMedia = vi.fn();

// Track the fake detector and let tests swap its detect() behaviour.
let detectImpl: () => Promise<unknown[]> = async () => [];
const detectorClose = vi.fn();
const detectorInitialize = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/renderer/services/presence/face-detector', () => ({
  FaceDetector: class {},
  createFaceDetector: () => ({
    initialize: detectorInitialize,
    detect: () => detectImpl(),
    close: detectorClose,
  }),
}));

// face-utils' cropFaceToRgbBytes uses canvas APIs that happy-dom doesn't
// implement reliably. Mock it to a constant byte array — encode() is
// the mock's job to assert anyway.
vi.mock('../src/renderer/services/presence/face-utils', () => ({
  CROP_SIZE: 112,
  largestFace: (arr: unknown[]) => arr[0],
  cropFaceToRgbBytes: () => new Uint8Array(112 * 112 * 3),
}));

function installWindowMocks(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: {
        presence: {
          hasModel: mockHasModel,
          list: mockList,
          encode: mockEncode,
          match: mockMatch,
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: mockGetUserMedia } },
  });
  // PresenceService instantiates an HTMLVideoElement via document; happy-dom
  // is the test env, so document already exists. Stub play() (happy-dom
  // refuses without a real source) and override srcObject's setter (it
  // type-checks against the real MediaStream class which we don't have).
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    set() {},
    get: () => null,
  });
}

async function loadService() {
  vi.resetModules();
  installWindowMocks();
  const mod = await import('../src/renderer/services/presence/PresenceService');
  // Always start each test with a fresh singleton.
  mod.PresenceService.resetForTesting();
  return mod;
}

describe('PresenceService', () => {
  beforeEach(() => {
    mockHasModel.mockReset();
    mockList.mockReset();
    mockEncode.mockReset();
    mockMatch.mockReset();
    mockGetUserMedia.mockReset();
    detectorClose.mockReset();
    detectorInitialize.mockReset().mockResolvedValue(undefined);
    detectImpl = async () => [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes a singleton via getInstance()', async () => {
    const { PresenceService } = await loadService();
    const a = PresenceService.getInstance();
    const b = PresenceService.getInstance();
    expect(a).toBe(b);
  });

  it('moves to no-model when the model file is missing', async () => {
    const { PresenceService } = await loadService();
    mockHasModel.mockResolvedValue({ installed: false, path: '/x' });
    const svc = PresenceService.getInstance();
    await svc.start();
    expect(svc.getState()).toBe('no-model');
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it('moves to no-enrollment when the store is empty', async () => {
    const { PresenceService } = await loadService();
    mockHasModel.mockResolvedValue({ installed: true, path: '/x' });
    mockList.mockResolvedValue([]);
    const svc = PresenceService.getInstance();
    await svc.start();
    expect(svc.getState()).toBe('no-enrollment');
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it('moves to permission-denied when getUserMedia rejects', async () => {
    const { PresenceService } = await loadService();
    mockHasModel.mockResolvedValue({ installed: true, path: '/x' });
    mockList.mockResolvedValue([{ id: '1' }]);
    mockGetUserMedia.mockRejectedValue(new Error('NotAllowedError'));
    const svc = PresenceService.getInstance();
    await svc.start();
    expect(svc.getState()).toBe('permission-denied');
  });

  it('reaches running state and ticks call encode + match when faces are detected', async () => {
    const { PresenceService } = await loadService();
    mockHasModel.mockResolvedValue({ installed: true, path: '/x' });
    mockList.mockResolvedValue([{ id: '1' }]);
    mockGetUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    detectImpl = async () => [
      { boundingBox: { x: 0, y: 0, width: 100, height: 100 }, keypoints: [], confidence: 1 },
    ];
    mockEncode.mockResolvedValue([0.1, 0.2, 0.3]);
    mockMatch.mockResolvedValue(null);

    const svc = PresenceService.getInstance({ intervalMs: 100 });
    await svc.start();
    expect(svc.getState()).toBe('running');

    // First tick fires after intervalMs; advance timers + flush microtasks.
    await vi.advanceTimersByTimeAsync(150);
    expect(mockEncode).toHaveBeenCalled();
    expect(mockMatch).toHaveBeenCalled();
  });

  it('pauses and resumes without releasing the camera', async () => {
    const { PresenceService } = await loadService();
    mockHasModel.mockResolvedValue({ installed: true, path: '/x' });
    mockList.mockResolvedValue([{ id: '1' }]);
    const stopTrack = vi.fn();
    mockGetUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
    const svc = PresenceService.getInstance({ intervalMs: 100 });
    await svc.start();
    svc.pause();
    expect(svc.getState()).toBe('paused');
    expect(stopTrack).not.toHaveBeenCalled();
    svc.resume();
    expect(svc.getState()).toBe('running');
  });

  it('stops to error after MAX_CONSECUTIVE_ERRORS encode failures', async () => {
    const { PresenceService } = await loadService();
    mockHasModel.mockResolvedValue({ installed: true, path: '/x' });
    mockList.mockResolvedValue([{ id: '1' }]);
    mockGetUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    detectImpl = async () => [
      { boundingBox: { x: 0, y: 0, width: 100, height: 100 }, keypoints: [], confidence: 1 },
    ];
    mockEncode.mockRejectedValue(new Error('encode boom'));

    const svc = PresenceService.getInstance({ intervalMs: 50 });
    await svc.start();

    // 10 consecutive failures should trip the breaker.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(60);
    }
    expect(svc.getState()).toBe('error');
  });

  it('stop() releases the stream and detector, returning to idle', async () => {
    const { PresenceService } = await loadService();
    mockHasModel.mockResolvedValue({ installed: true, path: '/x' });
    mockList.mockResolvedValue([{ id: '1' }]);
    const stopTrack = vi.fn();
    mockGetUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
    const svc = PresenceService.getInstance({ intervalMs: 100 });
    await svc.start();
    svc.stop();
    expect(svc.getState()).toBe('idle');
    expect(stopTrack).toHaveBeenCalled();
    expect(detectorClose).toHaveBeenCalled();
  });

  it('start() is a no-op when already running', async () => {
    const { PresenceService } = await loadService();
    mockHasModel.mockResolvedValue({ installed: true, path: '/x' });
    mockList.mockResolvedValue([{ id: '1' }]);
    mockGetUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    const svc = PresenceService.getInstance({ intervalMs: 100 });
    await svc.start();
    await svc.start();
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
  });

  it('onStateChange listener fires on transitions and unsubscribes cleanly', async () => {
    const { PresenceService } = await loadService();
    mockHasModel.mockResolvedValue({ installed: false, path: '/x' });
    const svc = PresenceService.getInstance();
    const states: string[] = [];
    const unsub = svc.onStateChange((s) => states.push(s));
    await svc.start();
    expect(states).toContain('starting');
    expect(states).toContain('no-model');
    unsub();
    states.length = 0;
    svc.stop();
    expect(states).toEqual([]); // unsubscribed listener doesn't fire
  });
});
