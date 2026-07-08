/**
 * video_stitch adapter — proves the ITool wiring + input parsing on top of
 * assembleFilm: the tool is registered under its name, its schema/metadata are
 * sane, per-boundary transitions reach ffmpeg, and a real ffmpeg run welds
 * clips end-to-end through the adapter (gated on ffmpeg presence).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { spawn, spawnSync } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  VideoStitchTool,
  createMultimodalTools,
} from '../../src/tools/registry/multimodal-tools.js';
import { MULTIMODAL_TOOLS } from '../../src/codebuddy/tool-definitions/multimodal-tools.js';
import type { ClipProbe } from '../../src/tools/video/film-assemble.js';

const PROBE_JSON = {
  format: { duration: '9' },
  streams: [
    { codec_type: 'video', width: 1280, height: 720, r_frame_rate: '30/1', pix_fmt: 'yuv420p' },
    { codec_type: 'audio' },
  ],
};

function makeFakeSpawn(seen: string[][]): typeof spawn {
  return ((cmd: string, args: string[]) => {
    seen.push([cmd, ...args]);
    const child = new EventEmitter() as unknown as ReturnType<typeof spawn> & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => {
      if (cmd.includes('ffprobe')) {
        child.stdout.emit('data', Buffer.from(JSON.stringify(PROBE_JSON)));
        child.emit('close', 0);
      } else {
        child.emit('close', 0);
      }
    });
    return child;
  }) as unknown as typeof spawn;
}

function fakeProbe(paths: string[]): Promise<ClipProbe[]> {
  return Promise.resolve(
    paths.map((p) => ({
      path: p,
      duration: 3,
      width: 1280,
      height: 720,
      fps: 30,
      hasAudio: true,
      sar: '1:1',
      pixFmt: 'yuv420p',
    }))
  );
}

describe('video_stitch — registration + schema', () => {
  it('is registered in the multimodal tool instances under its name', () => {
    const tool = createMultimodalTools().find((t) => t.name === 'video_stitch');
    expect(tool).toBeDefined();
    expect(tool!.getMetadata().category).toBe('media');
    expect(tool!.getMetadata().keywords).toEqual(expect.arrayContaining(['montage', 'transition']));
    expect(tool!.getSchema().parameters.required).toEqual(['clips']);
  });

  it('exposes an OpenAI function definition in MULTIMODAL_TOOLS', () => {
    const def = MULTIMODAL_TOOLS.find((d) => d.function.name === 'video_stitch');
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toEqual(['clips']);
  });

  it('validates that clips is a non-empty array', () => {
    const tool = new VideoStitchTool();
    expect(tool.validate({}).valid).toBe(false);
    expect(tool.validate({ clips: [] }).valid).toBe(false);
    expect(tool.validate({ clips: ['/a.mp4'] }).valid).toBe(true);
  });
});

describe('video_stitch — input parsing (injected)', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'buddy-stitch-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('forwards per-boundary transitions to ffmpeg', async () => {
    const seen: string[][] = [];
    const tool = new VideoStitchTool({
      rootDir: root,
      deps: { spawn: makeFakeSpawn(seen), probeClips: fakeProbe },
    });
    const res = await tool.execute({
      clips: ['/a.mp4', '/b.mp4', '/c.mp4'],
      transitions: [
        { type: 'wipeleft', duration: 0.5 },
        { type: 'circleopen', duration: 0.7 },
      ],
    });
    expect(res.success).toBe(true);
    const render = seen.find((a) => a.includes('-filter_complex'));
    const graph = render?.join(' ') ?? '';
    expect(graph).toContain('transition=wipeleft');
    expect(graph).toContain('transition=circleopen');
  });

  it('returns success:false with the error surfaced when no clips are given', async () => {
    const tool = new VideoStitchTool({ deps: { spawn: makeFakeSpawn([]), probeClips: fakeProbe } });
    const res = await tool.execute({ clips: [] });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/at least one clip/i);
  });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.runIf(hasFfmpeg)('video_stitch — real ffmpeg through the adapter', () => {
  let root: string;
  const clips: string[] = [];
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'buddy-stitch-real-'));
    for (let i = 0; i < 2; i++) {
      const out = join(root, `c${i}.mp4`);
      const r = spawnSync('ffmpeg', [
        '-y',
        '-hide_banner',
        '-f',
        'lavfi',
        '-i',
        `color=c=${i ? 'blue' : 'red'}:size=320x240:rate=30:duration=2`,
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        out,
      ]);
      expect(r.status).toBe(0);
      clips.push(out);
    }
  }, 60_000);
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('welds two clips into a film via the tool', async () => {
    const tool = new VideoStitchTool({ rootDir: root });
    const res = await tool.execute({
      clips,
      transition: 'fade',
      transition_duration: 0.5,
      resolution: '320x240',
      name: 'adapter-real',
    });
    expect(res.success, res.error).toBe(true);
    const data = res.data as { outputPath?: string; estimatedDuration?: number };
    expect(data.outputPath).toMatch(/\.mp4$/);
    expect(data.estimatedDuration).toBe(3.5); // 4s − 0.5s
  }, 120_000);
});
