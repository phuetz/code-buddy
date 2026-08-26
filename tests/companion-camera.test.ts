import { EventEmitter } from 'events';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { vi } from 'vitest';
import {
  buildCameraSnapshotArgs,
  captureCameraSnapshot,
  checkCameraAvailability,
  formatCameraSnapshotInspection,
  getDefaultCameraOutputPath,
  importCameraSnapshot,
  inspectCameraSnapshot,
  type CameraRuntime,
} from '../src/companion/camera.js';
import { readRecentCompanionPercepts } from '../src/companion/percepts.js';
import { readRecentCompanionSafetyEvents } from '../src/companion/safety-ledger.js';

function createRuntime(options: {
  ffmpegAvailable?: boolean;
  spawnCode?: number;
  stderr?: string;
  writeOutput?: boolean;
} = {}): CameraRuntime {
  const {
    ffmpegAvailable = true,
    spawnCode = 0,
    stderr = '',
    writeOutput = true,
  } = options;

  return {
    execFile: vi.fn((_command, _args, _options, callback) => {
      if (!ffmpegAvailable) {
        callback(new Error('ffmpeg not found'), '', 'not found');
        return;
      }
      callback(null, 'ffmpeg version 6', '');
    }),
    spawn: vi.fn((_command, args) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true);

      setImmediate(async () => {
        if (stderr) child.stderr.emit('data', stderr);
        if (writeOutput && spawnCode === 0) {
          await writeFile(args[args.length - 1], 'png-data');
        }
        child.emit('close', spawnCode);
      });

      return child;
    }),
  } as unknown as CameraRuntime;
}

describe('companion camera bridge', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-camera-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('builds platform-specific ffmpeg camera arguments', () => {
    expect(buildCameraSnapshotArgs('win32', 'video=USB Camera', 'out.png')).toEqual([
      '-y',
      '-f',
      'dshow',
      '-i',
      'video=USB Camera',
      '-frames:v',
      '1',
      'out.png',
    ]);
    expect(buildCameraSnapshotArgs('darwin', undefined, 'out.png')).toContain('avfoundation');
    expect(buildCameraSnapshotArgs('linux', undefined, 'out.png')).toContain('/dev/video0');
  });

  it('reports camera availability from ffmpeg presence', async () => {
    const ok = await checkCameraAvailability({
      runtime: createRuntime({ ffmpegAvailable: true }),
      platform: 'linux',
    });
    expect(ok.available).toBe(true);
    expect(ok.commandPreview).toContain('ffmpeg');

    const missing = await checkCameraAvailability({
      runtime: createRuntime({ ffmpegAvailable: false }),
      platform: 'linux',
    });
    expect(missing.available).toBe(false);
    expect(missing.reason).toContain('ffmpeg is required');
  });

  it('captures a webcam snapshot into the workspace camera directory by default', async () => {
    const runtime = createRuntime();
    const result = await captureCameraSnapshot({
      cwd: tempDir,
      runtime,
      platform: 'linux',
    });

    expect(result.success).toBe(true);
    expect(result.path).toContain(path.join('.codebuddy', 'camera'));
    expect(result.command).toContain('ffmpeg');
    expect(result.perceptId).toContain('percept-');

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(percepts[0]).toMatchObject({
      modality: 'vision',
      source: 'camera_snapshot',
      summary: expect.stringContaining('Captured camera snapshot'),
    });

    const safetyEvents = await readRecentCompanionSafetyEvents({ cwd: tempDir });
    expect(safetyEvents[0]).toMatchObject({
      kind: 'sense',
      risk: 'medium',
      action: 'camera_snapshot',
      source: 'camera_snapshot',
      artifactPath: result.path,
    });
  });

  it('captures a webcam snapshot to an explicit output path', async () => {
    const result = await captureCameraSnapshot({
      cwd: tempDir,
      outputPath: 'custom/scene.png',
      runtime: createRuntime(),
      platform: 'darwin',
    });

    expect(result.success).toBe(true);
    expect(result.path).toBe(path.join(tempDir, 'custom', 'scene.png'));
  });

  it('supports a private one-shot capture without durable percept or path journals', async () => {
    const result = await captureCameraSnapshot({
      cwd: tempDir,
      outputPath: 'private/frame.png',
      runtime: createRuntime(),
      platform: 'linux',
      recordPercept: false,
      recordSafetyEvent: false,
    });

    expect(result.success).toBe(true);
    await expect(readRecentCompanionPercepts({ cwd: tempDir })).resolves.toEqual([]);
    await expect(readRecentCompanionSafetyEvents({ cwd: tempDir })).resolves.toEqual([]);
  });

  it('records a path-free safety event for an explicit private one-shot capture', async () => {
    const result = await captureCameraSnapshot({
      cwd: tempDir,
      outputPath: 'private/redacted-frame.png',
      runtime: createRuntime(),
      platform: 'linux',
      recordPercept: false,
      redactSafetyEvent: true,
    });

    expect(result.success).toBe(true);
    const events = await readRecentCompanionSafetyEvents({ cwd: tempDir });
    expect(events[0]).toMatchObject({
      action: 'camera_snapshot',
      payload: {
        consent: 'explicit_one_shot',
        platform: 'linux',
        pathRetained: false,
      },
    });
    expect(events[0]?.artifactPath).toBeUndefined();
    expect(events[0]?.payload).not.toHaveProperty('path');
    expect(events[0]?.payload).not.toHaveProperty('command');
    expect(events[0]?.payload).not.toHaveProperty('device');
  });

  it('kills an in-flight ffmpeg capture when consent is withdrawn', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => true);
    const runtime: CameraRuntime = {
      execFile: vi.fn(),
      spawn: vi.fn(() => child as never),
    };
    const controller = new AbortController();
    const capture = captureCameraSnapshot({
      cwd: tempDir,
      outputPath: 'private/aborted.png',
      runtime,
      platform: 'linux',
      signal: controller.signal,
      skipAvailabilityCheck: true,
      recordPercept: false,
      recordSafetyEvent: false,
    });
    setTimeout(() => controller.abort(), 5);

    const result = await capture;
    expect(result.success).toBe(false);
    expect(result.error).toContain('aborted');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('imports renderer camera snapshots without requiring ffmpeg', async () => {
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64',
    );
    const result = await importCameraSnapshot({
      cwd: tempDir,
      dataUrl: `data:image/png;base64,${pngBytes.toString('base64')}`,
      width: 1,
      height: 1,
      mediaPipe: {
        engine: 'mediapipe_tasks_vision',
        models: ['face_detector_blaze_face_short_range', 'hand_landmarker', 'pose_landmarker_lite'],
        runningMode: 'IMAGE',
        status: 'ok',
        faceCount: 1,
        handCount: 1,
        poseCount: 0,
        faces: [{
          boundingBox: { x: 0, y: 0, width: 1, height: 1 },
          confidence: 0.9,
          keypoints: [{ x: 0.5, y: 0.5 }],
        }],
        hands: [{
          handedness: 'Right',
          confidence: 0.8,
          landmarks: [{ x: 0.1, y: 0.2 }],
          fingerTips: { index: { x: 0.3, y: 0.4 } },
        }],
        poses: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.command).toBe('renderer-getUserMedia');
    expect(result.path).toContain(path.join('.codebuddy', 'camera'));
    await expect(readFile(result.path!)).resolves.toEqual(pngBytes);

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(percepts[0]).toMatchObject({
      modality: 'vision',
      source: 'camera_snapshot',
      payload: expect.objectContaining({
        command: 'renderer-getUserMedia',
        captureSource: 'electron_renderer',
        width: 1,
        height: 1,
        mediaPipe: expect.objectContaining({
          engine: 'mediapipe_tasks_vision',
          faceCount: 1,
          handCount: 1,
        }),
      }),
      tags: expect.arrayContaining(['mediapipe', 'face']),
    });

    const safetyEvents = await readRecentCompanionSafetyEvents({ cwd: tempDir });
    expect(safetyEvents[0]).toMatchObject({
      action: 'camera_snapshot',
      source: 'camera_snapshot',
      artifactPath: result.path,
      payload: expect.objectContaining({
        command: 'renderer-getUserMedia',
        captureSource: 'electron_renderer',
        mediaPipe: expect.objectContaining({
          engine: 'mediapipe_tasks_vision',
          handCount: 1,
        }),
      }),
    });
  });

  it('inspects an existing camera image and records a vision percept', async () => {
    const imagePath = path.join(tempDir, 'scene.png');
    await writeFile(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64',
      ),
    );

    const result = await inspectCameraSnapshot({
      cwd: tempDir,
      imagePath: 'scene.png',
    });

    expect(result.success).toBe(true);
    expect(result.analysis?.dimensions).toEqual({ width: 1, height: 1 });
    expect(result.summary).toContain('Inspected camera image');
    expect(formatCameraSnapshotInspection(result)).toContain('Camera Inspection');

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(percepts[0]).toMatchObject({
      modality: 'vision',
      source: 'camera_inspection',
      payload: expect.objectContaining({
        path: imagePath,
      }),
    });

    const safetyEvents = await readRecentCompanionSafetyEvents({ cwd: tempDir });
    expect(safetyEvents[0]).toMatchObject({
      kind: 'sense',
      risk: 'medium',
      action: 'camera_inspection',
      artifactPath: imagePath,
    });
  });

  it('returns actionable troubleshooting when ffmpeg cannot open a Windows camera', async () => {
    const result = await captureCameraSnapshot({
      cwd: tempDir,
      outputPath: 'scene.png',
      runtime: createRuntime({
        spawnCode: 1,
        stderr: 'Could not find video device',
        writeOutput: false,
      }),
      platform: 'win32',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ffmpeg -list_devices true -f dshow -i dummy');
  });

  it('creates deterministic default output paths for status previews', () => {
    const output = getDefaultCameraOutputPath('/repo', new Date('2026-05-24T12:34:56Z'));
    expect(output).toBe(path.join('/repo', '.codebuddy', 'camera', 'camera-20260524-123456.png'));
  });
});
