/**
 * blender-render — real tests (no mocks) for the pure argv builder and the
 * fail-open renderScenes wrapper (spawn + fs injected, no BlenderProc needed).
 */
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import {
  buildBlenderProcArgs,
  renderScenes,
  type BlenderRenderOptions,
} from '../../../src/tools/vision/blender-render.js';

const BASE: BlenderRenderOptions = {
  script: '/x/scene.py',
  assetsDir: '/x/assets',
  outDir: '/x/out',
  count: 8,
};

/** Minimal fake spawn that emits an exit `code` on next tick (deferred, not sync). */
function fakeSpawn(code: number | null, opts: { error?: string } = {}) {
  return ((_bin: string, _args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (opts.error) child.emit('error', new Error(opts.error));
      else child.emit('close', code);
    });
    return child;
  }) as never;
}

describe('buildBlenderProcArgs', () => {
  it('builds the run argv with script params after `--`', () => {
    expect(buildBlenderProcArgs(BASE)).toEqual([
      'run',
      '/x/scene.py',
      '--',
      '--assets',
      '/x/assets',
      '--out',
      '/x/out',
      '--count',
      '8',
    ]);
  });

  it('clamps count to at least 1 and rounds it', () => {
    expect(buildBlenderProcArgs({ ...BASE, count: 0 })).toContain('1');
    const a = buildBlenderProcArgs({ ...BASE, count: 3.7 });
    expect(a[a.indexOf('--count') + 1]).toBe('4');
  });

  it('appends optional seed / resolution / devices', () => {
    const a = buildBlenderProcArgs({ ...BASE, seed: 42, width: 640, height: 480, devices: ['CUDA', 'HIP'] });
    expect(a).toEqual(expect.arrayContaining(['--seed', '42', '--width', '640', '--height', '480', '--devices', 'CUDA,HIP']));
  });
});

describe('renderScenes (fail-open)', () => {
  it('returns ok when blenderproc exits 0 and COCO exists', async () => {
    const res = await renderScenes(BASE, {
      spawn: fakeSpawn(0),
      exists: async () => true,
      mkdir: async () => {},
    });
    expect(res.ok).toBe(true);
    expect(res.cocoPath).toBe('/x/out/coco_annotations.json');
    expect(res.imagesDir).toBe('/x/out/images');
  });

  it('fails (never throws) when blenderproc exits non-zero', async () => {
    const res = await renderScenes(BASE, { spawn: fakeSpawn(1), exists: async () => true, mkdir: async () => {} });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/exited 1/);
  });

  it('fails when no COCO file is produced despite a clean exit', async () => {
    const res = await renderScenes(BASE, { spawn: fakeSpawn(0), exists: async () => false, mkdir: async () => {} });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no coco_annotations\.json/);
  });

  it('fails gracefully when blenderproc cannot be spawned', async () => {
    const res = await renderScenes(BASE, { spawn: fakeSpawn(null, { error: 'ENOENT' }), exists: async () => false, mkdir: async () => {} });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
