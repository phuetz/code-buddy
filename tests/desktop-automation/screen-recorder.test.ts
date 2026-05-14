import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { ScreenRecorder } from '../../src/desktop-automation/screen-recorder.js';
import type { RecordingInfo } from '../../src/desktop-automation/screen-recorder.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type ScreenRecorderInternals = {
  buildLinuxArgs(recording: RecordingInfo): string[];
  currentRecording: RecordingInfo | null;
  recordingStartTime: Date | null;
};

const createRecording = (outputPath: string): RecordingInfo => ({
  id: 'rec-test',
  outputPath,
  state: 'recording',
  startTime: new Date(),
  duration: 0,
  fileSize: 0,
  frameCount: 0,
  options: {
    format: 'mp4',
    fps: 30,
    bitrate: '2M',
    showCursor: true,
  },
});

describe('ScreenRecorder', () => {
  it('rejects Wayland recording instead of using placeholder video', () => {
    const previousWayland = process.env.WAYLAND_DISPLAY;
    process.env.WAYLAND_DISPLAY = 'wayland-0';

    try {
      const recorder = new ScreenRecorder();
      const internal = recorder as unknown as ScreenRecorderInternals;

      expect(() => internal.buildLinuxArgs(createRecording('/tmp/out.mp4')))
        .toThrow('Placeholder video capture is disabled');
    } finally {
      if (previousWayland === undefined) {
        delete process.env.WAYLAND_DISPLAY;
      } else {
        process.env.WAYLAND_DISPLAY = previousWayland;
      }
    }
  });

  it('does not report a successful recording when output is empty', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screen-recorder-'));
    const outputPath = path.join(tempDir, 'empty.mp4');
    await fs.writeFile(outputPath, '');

    try {
      const recorder = new ScreenRecorder({ outputDir: tempDir });
      const internal = recorder as unknown as ScreenRecorderInternals;
      internal.currentRecording = createRecording(outputPath);
      internal.recordingStartTime = new Date(Date.now() - 1000);

      const result = await recorder.stop();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Recording output is empty');
      expect(internal.currentRecording).toBeNull();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
