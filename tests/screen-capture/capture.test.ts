/**
 * Screen Capture Tests
 */

import {
  CaptureManager,
  getCaptureManager,
  resetCaptureManager,
  type ScreenshotResult,
  type RecordingResult,
  type RecordingStatus,
} from '../../src/screen-capture/index.js';

describe('Screen Capture', () => {
  let manager: CaptureManager;

  beforeEach(() => {
    resetCaptureManager();
    manager = new CaptureManager();
  });

  afterEach(() => {
    if (manager.isRecording()) {
      manager.cancelRecording();
    }
    resetCaptureManager();
  });

  describe('Display Discovery', () => {
    it('should list displays', async () => {
      const displays = await manager.getDisplays();

      expect(displays.length).toBeGreaterThan(0);
      expect(displays[0].id).toBeDefined();
      expect(displays[0].bounds).toBeDefined();
    });

    it('should get primary display', async () => {
      const primary = await manager.getPrimaryDisplay();

      expect(primary).toBeDefined();
      expect(primary?.isPrimary).toBe(true);
    });

    it('should get display by ID', async () => {
      const displays = await manager.getDisplays();
      const display = await manager.getDisplay(displays[0].id);

      expect(display).toBeDefined();
      expect(display?.id).toBe(displays[0].id);
    });
  });

  describe('Window Discovery', () => {
    it('should list windows', async () => {
      const windows = await manager.getWindows();

      expect(windows.length).toBeGreaterThan(0);
      expect(windows[0].title).toBeDefined();
    });

    it('should get window by ID', async () => {
      const windows = await manager.getWindows();
      const window = await manager.getWindow(windows[0].id);

      expect(window).toBeDefined();
      expect(window?.id).toBe(windows[0].id);
    });

    it('should find windows by title', async () => {
      const windows = await manager.findWindows('Terminal');

      expect(windows.length).toBe(1);
      expect(windows[0].title).toBe('Terminal');
    });

    it('should find windows by regex', async () => {
      const windows = await manager.findWindows(/browser/i);

      expect(windows.length).toBe(1);
    });
  });

  describe('Screenshot', () => {
    it('should take screenshot', async () => {
      const result = await manager.takeScreenshot();

      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.format).toBe('png');
    });

    it('should take screenshot with custom format', async () => {
      const result = await manager.takeScreenshot({ format: 'jpeg', quality: 80 });

      expect(result.format).toBe('jpeg');
    });

    it('should capture specific region', async () => {
      const region = { x: 100, y: 100, width: 200, height: 200 };
      const result = await manager.takeScreenshot({ region });

      expect(result.width).toBe(200);
      expect(result.height).toBe(200);
      expect(result.source.region).toEqual(region);
    });

    it('should capture specific window', async () => {
      const windows = await manager.getWindows();
      const result = await manager.takeScreenshot({
        source: 'window',
        windowId: windows[0].id,
      });

      expect(result.source.type).toBe('window');
      expect(result.source.windowId).toBe(windows[0].id);
    });

    it('should capture specific display', async () => {
      const displays = await manager.getDisplays();
      const result = await manager.takeScreenshot({
        source: 'display',
        displayId: displays[0].id,
      });

      expect(result.source.type).toBe('display');
      expect(result.source.displayId).toBe(displays[0].id);
    });

    it('should delay before capture', async () => {
      const start = Date.now();
      await manager.takeScreenshot({ delayMs: 100 });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(90);
    });

    it('should take multiple screenshots', async () => {
      const results = await manager.takeScreenshots(3, 50);

      expect(results.length).toBe(3);
    });

    it('should emit events', async () => {
      const events: string[] = [];

      manager.on('screenshot-start', () => events.push('start'));
      manager.on('screenshot-complete', () => events.push('complete'));

      await manager.takeScreenshot();

      expect(events).toEqual(['start', 'complete']);
    });
  });

  describe('Recording', () => {
    it('should start and stop recording', async () => {
      await manager.startRecording({ path: '/tmp/test.mp4' });

      expect(manager.isRecording()).toBe(true);

      // Wait a bit for frames
      await new Promise(resolve => setTimeout(resolve, 200));

      const result = await manager.stopRecording();

      expect(result.path).toBe('/tmp/test.mp4');
      expect(result.format).toBe('mp4');
      expect(result.frameCount).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(manager.isRecording()).toBe(false);
    });

    it('should not allow multiple recordings', async () => {
      await manager.startRecording({ path: '/tmp/test1.mp4' });

      await expect(
        manager.startRecording({ path: '/tmp/test2.mp4' })
      ).rejects.toThrow('Recording already in progress');

      await manager.stopRecording();
    });

    it('should pause and resume recording', async () => {
      await manager.startRecording({ path: '/tmp/test.mp4' });
      await new Promise(resolve => setTimeout(resolve, 100));

      manager.pauseRecording();
      expect(manager.isPaused()).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 100));

      manager.resumeRecording();
      expect(manager.isRecording()).toBe(true);
      expect(manager.isPaused()).toBe(false);

      await manager.stopRecording();
    });

    it('should not pause when not recording', () => {
      expect(() => manager.pauseRecording()).toThrow('No recording in progress');
    });

    it('should not resume when not paused', async () => {
      await manager.startRecording({ path: '/tmp/test.mp4' });

      expect(() => manager.resumeRecording()).toThrow('Recording not paused');

      await manager.stopRecording();
    });

    it('should cancel recording', async () => {
      await manager.startRecording({ path: '/tmp/test.mp4' });

      manager.cancelRecording();

      expect(manager.isRecording()).toBe(false);
    });

    it('should get recording status', async () => {
      await manager.startRecording({ path: '/tmp/test.mp4', fps: 30 });
      await new Promise(resolve => setTimeout(resolve, 150));

      const status = manager.getRecordingStatus();

      expect(status.state).toBe('recording');
      expect(status.durationMs).toBeGreaterThan(0);
      expect(status.frameCount).toBeGreaterThan(0);

      await manager.stopRecording();
    });

    it('should emit recording events', async () => {
      const events: string[] = [];

      manager.on('recording-start', () => events.push('start'));
      manager.on('recording-progress', () => {
        if (!events.includes('progress')) events.push('progress');
      });
      manager.on('recording-stop', () => events.push('stop'));
      manager.on('recording-complete', () => events.push('complete'));

      await manager.startRecording({ path: '/tmp/test.mp4' });
      await new Promise(resolve => setTimeout(resolve, 100));
      await manager.stopRecording();

      expect(events).toContain('start');
      expect(events).toContain('progress');
      expect(events).toContain('stop');
      expect(events).toContain('complete');
    });

    it('should emit pause/resume events', async () => {
      const events: string[] = [];

      manager.on('recording-pause', () => events.push('pause'));
      manager.on('recording-resume', () => events.push('resume'));

      await manager.startRecording({ path: '/tmp/test.mp4' });
      await new Promise(resolve => setTimeout(resolve, 50));

      manager.pauseRecording();
      manager.resumeRecording();

      await manager.stopRecording();

      expect(events).toContain('pause');
      expect(events).toContain('resume');
    });

    it('should record specific window', async () => {
      const windows = await manager.getWindows();

      await manager.startRecording({
        path: '/tmp/test.mp4',
        source: 'window',
        windowId: windows[0].id,
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      const result = await manager.stopRecording();

      expect(result.source.type).toBe('window');
      expect(result.source.windowId).toBe(windows[0].id);
    });

    it('should record specific region', async () => {
      const region = { x: 0, y: 0, width: 640, height: 480 };

      await manager.startRecording({
        path: '/tmp/test.mp4',
        source: 'region',
        region,
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      const result = await manager.stopRecording();

      expect(result.resolution.width).toBe(640);
      expect(result.resolution.height).toBe(480);
    });

    it('should return idle status when not recording', () => {
      const status = manager.getRecordingStatus();

      expect(status.state).toBe('idle');
      expect(status.frameCount).toBe(0);
      expect(status.durationMs).toBe(0);
    });
  });

  describe('Configuration', () => {
    it('should get configuration', () => {
      const config = manager.getConfig();

      expect(config.outputDir).toBeDefined();
      expect(config.namingPattern).toBeDefined();
    });

    it('should update configuration', () => {
      manager.updateConfig({ outputDir: '/new/output' });

      expect(manager.getConfig().outputDir).toBe('/new/output');
    });
  });

  describe('Statistics', () => {
    it('should return stats', () => {
      const stats = manager.getStats();

      expect(stats.displays).toBeGreaterThan(0);
      expect(stats.windows).toBeGreaterThan(0);
      expect(stats.isRecording).toBe(false);
      expect(stats.recordingDuration).toBe(0);
    });

    it('should report recording status in stats', async () => {
      await manager.startRecording({ path: '/tmp/test.mp4' });
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = manager.getStats();
      expect(stats.isRecording).toBe(true);
      expect(stats.recordingDuration).toBeGreaterThan(0);

      await manager.stopRecording();
    });
  });
});

describe('Singleton', () => {
  beforeEach(() => {
    resetCaptureManager();
  });

  afterEach(() => {
    resetCaptureManager();
  });

  it('should return same instance', () => {
    const manager1 = getCaptureManager();
    const manager2 = getCaptureManager();

    expect(manager1).toBe(manager2);
  });

  it('should reset instance', () => {
    const manager1 = getCaptureManager();
    resetCaptureManager();
    const manager2 = getCaptureManager();

    expect(manager1).not.toBe(manager2);
  });
});
