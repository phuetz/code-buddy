import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import {
  buildFrameArgs,
  buildRecordArgs,
  isWaylandSession,
  ScreenRecorder,
  type SpawnLike,
} from '../../src/capture/screen-recorder.js';

describe('screen-recorder arg builders', () => {
  it('builds linux x11grab frame args with region offset', () => {
    const { cmd, args } = buildFrameArgs('out.png', { display: ':9', region: { width: 800, height: 600, x: 10, y: 20 } }, 'linux');
    expect(cmd).toBe('ffmpeg');
    expect(args).toEqual(['-y', '-f', 'x11grab', '-video_size', '800x600', '-i', ':9+10,20', '-frames:v', '1', 'out.png']);
  });

  it('builds linux full-screen frame args from screenSize (no offset)', () => {
    const { args } = buildFrameArgs('f.png', { display: ':0', screenSize: { width: 1920, height: 1080 } }, 'linux');
    expect(args).toContain('1920x1080');
    expect(args).toContain(':0'); // no +x,y suffix
    expect(args.join(' ')).not.toContain('+');
  });

  it('builds linux record args with fps + duration', () => {
    const { args } = buildRecordArgs('rec.mp4', { display: ':1', fps: 30, durationSec: 10, screenSize: { width: 1280, height: 720 } }, 'linux');
    expect(args).toEqual(
      expect.arrayContaining(['-f', 'x11grab', '-framerate', '30', '-video_size', '1280x720', '-i', ':1', '-t', '10', '-pix_fmt', 'yuv420p']),
    );
    expect(args[args.length - 1]).toBe('rec.mp4');
  });

  it('omits -t when no duration', () => {
    const { args } = buildRecordArgs('rec.mp4', { display: ':1', screenSize: { width: 100, height: 100 } }, 'linux');
    expect(args).not.toContain('-t');
  });

  it('uses avfoundation on darwin and gdigrab on win32', () => {
    expect(buildRecordArgs('o.mp4', {}, 'darwin').args).toContain('avfoundation');
    expect(buildRecordArgs('o.mp4', {}, 'win32').args).toContain('gdigrab');
  });

  it('builds h264_vaapi GPU-encode args', () => {
    const { args } = buildRecordArgs('o.mp4', { display: ':0', codec: 'h264_vaapi', screenSize: { width: 1920, height: 1080 } }, 'linux');
    expect(args).toEqual(expect.arrayContaining(['-vaapi_device', '/dev/dri/renderD128', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-qp', '24']));
    expect(args).not.toContain('libx264');
  });

  it('builds av1_vaapi args with default qp 30 and a scale filter', () => {
    const { args } = buildRecordArgs('o.mkv', { display: ':0', codec: 'av1_vaapi', scale: { width: 1280 }, screenSize: { width: 1920, height: 1080 } }, 'linux');
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toBe('scale=1280:-2,format=nv12,hwupload');
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'av1_vaapi', '-qp', '30']));
  });

  it('libx264 path stays software with a scale filter', () => {
    const { args } = buildRecordArgs('o.mp4', { display: ':0', scale: { width: 1280, height: 720 }, screenSize: { width: 1920, height: 1080 } }, 'linux');
    expect(args).toEqual(expect.arrayContaining(['-vf', 'scale=1280:720', '-c:v', 'libx264', '-preset', 'ultrafast']));
    expect(args).not.toContain('-vaapi_device');
  });

  it('detects a Wayland session', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'x11' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

function mockProc() {
  const ee = new EventEmitter() as EventEmitter & { stdin: { write: (s: string) => void; end: () => void }; kill: (s?: string) => void };
  ee.stdin = { write: () => {}, end: () => {} };
  ee.kill = () => {};
  return ee;
}

describe('ScreenRecorder', () => {
  it('start() spawns ffmpeg with the record args and tracks state', () => {
    let captured: { cmd: string; args: string[] } | null = null;
    const proc = mockProc();
    const spawnImpl: SpawnLike = (cmd, args) => {
      captured = { cmd, args };
      return proc as never;
    };
    const rec = new ScreenRecorder({ spawnImpl, platform: 'linux' });
    expect(rec.isRecording()).toBe(false);
    rec.start('/tmp/x/out.mp4', { display: ':5', fps: 20, screenSize: { width: 640, height: 480 } });
    expect(rec.isRecording()).toBe(true);
    expect(captured!.cmd).toBe('ffmpeg');
    expect(captured!.args).toEqual(expect.arrayContaining(['x11grab', '-framerate', '20', ':5', '640x480']));
  });

  it('stop() resolves and clears state', async () => {
    const proc = mockProc();
    const rec = new ScreenRecorder({ spawnImpl: () => proc as never });
    rec.start('/tmp/x/out.mp4', { display: ':5', screenSize: { width: 10, height: 10 } });
    const done = rec.stop();
    proc.emit('exit', 0); // ffmpeg finished
    await done;
    expect(rec.isRecording()).toBe(false);
  });

  it('captureFrame() resolves to the output path on exit 0', async () => {
    const proc = mockProc();
    const rec = new ScreenRecorder({ spawnImpl: () => proc as never });
    const p = rec.captureFrame('/tmp/x/f.png', { display: ':5', screenSize: { width: 10, height: 10 } });
    proc.emit('exit', 0);
    await expect(p).resolves.toBe('/tmp/x/f.png');
  });
});
