/**
 * BlenderProc render wrapper — the "simulate" leg of the simulate→perceive loop.
 *
 * Drives BlenderProc2 (DLR, GPL-3.0) headless in a subprocess to render a batch
 * of domain-randomized scenes AND their exact ground truth (a COCO
 * `coco_annotations.json`, bbox projected from the KNOWN 3D geometry — a
 * mathematical fact, not a prompt we hoped an image generator honored). That
 * COCO file feeds `coco-to-labels.ts` → `buddy vision-train --coco`, scoring the
 * robot's REAL perception (YOLO) and surfacing where it is weak.
 *
 * MCP Blender (ahujasid / the official Blender×Anthropic server) is deliberately
 * NOT used here: both need a GUI session open and run arbitrary Python unguarded
 * — that's interactive co-piloting, not an automated batch pipeline. BlenderProc
 * `run <script>` is the headless, ground-truth-emitting tool built for this.
 *
 * The companion Python scene script lives at `scripts/blenderproc/scene.py`; it
 * tries GPU (CUDA→HIP) then falls back to CPU automatically, so this works on the
 * AMD box too (slower) and on DARKSTAR's CUDA (fast). Every OS-touching bit is
 * injectable and any hard failure returns `{ ok:false, error }` — never throws.
 *
 * @module tools/vision/blender-render
 */

import { spawn as realSpawn, type SpawnOptions } from 'child_process';
import { mkdir, access } from 'fs/promises';
import { join } from 'path';
import { logger } from '../../utils/logger.js';

export interface BlenderRenderOptions {
  /** Path to the BlenderProc python scene script (see scripts/blenderproc/scene.py). */
  script: string;
  /** Directory of downloaded 3D assets (glb/blend/hdri) the script populates scenes from. */
  assetsDir: string;
  /** Output directory — `images/` + `coco_annotations.json` are written here. */
  outDir: string;
  /** How many scenes to render (clamped ≥1). */
  count: number;
  /** Deterministic seed for domain randomization (reproducible batches). */
  seed?: number;
  /** Render width in px (default 640, YOLO-friendly). */
  width?: number;
  /** Render height in px (default 480). */
  height?: number;
  /**
   * GPU device types the script should try, in order, before falling back to
   * CPU (default `['CUDA','HIP']`). Passed through as a hint; the script owns
   * the actual `RendererUtility.set_render_devices` cascade.
   */
  devices?: string[];
}

export interface BlenderRenderDeps {
  /** Injectable spawn (tests). */
  spawn?: typeof realSpawn;
  /** BlenderProc CLI (default `blenderproc`; on DARKSTAR/Windows may be `blenderproc.exe`). */
  blenderprocBin?: string;
  /** Injectable "does this path exist" (default fs.access). */
  exists?: (p: string) => Promise<boolean>;
  /** Injectable directory creation (default fs.mkdir recursive). */
  mkdir?: (dir: string) => Promise<void>;
  /** Timeout for the whole batch (ms, default 30 min). */
  timeoutMs?: number;
}

export interface BlenderRenderResult {
  ok: boolean;
  /** Directory the rendered images landed in (`<outDir>/images`). */
  imagesDir: string;
  /** The COCO ground-truth file (`<outDir>/coco_annotations.json`). */
  cocoPath: string;
  error?: string;
}

/**
 * Build the `blenderproc run …` argv. Pure + deterministic so it's unit-testable
 * without BlenderProc installed. The scene script receives its params after `--`.
 */
export function buildBlenderProcArgs(o: BlenderRenderOptions): string[] {
  const args = [
    'run',
    o.script,
    '--',
    '--assets',
    o.assetsDir,
    '--out',
    o.outDir,
    '--count',
    String(Math.max(1, Math.round(o.count))),
  ];
  if (o.seed !== undefined) args.push('--seed', String(o.seed));
  if (o.width) args.push('--width', String(o.width));
  if (o.height) args.push('--height', String(o.height));
  if (o.devices?.length) args.push('--devices', o.devices.join(','));
  return args;
}

async function defaultExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Run a subprocess to completion, resolving its exit code (null → treated as failure upstream). */
function runProc(
  spawn: typeof realSpawn,
  bin: string,
  args: string[],
  opts: SpawnOptions,
  timeoutMs: number,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, stderr: `${stderr}\n[blender-render] timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on('data', (c: Buffer) => {
      const line = c.toString().trim();
      if (line) logger.debug(`blenderproc: ${line}`);
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stderr: `${stderr}\n${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

/**
 * Render a batch of scenes with BlenderProc and confirm the COCO ground truth
 * was produced. Fail-open: any error (BlenderProc missing, script crash, no
 * output) returns `{ ok:false, error }` — the caller decides, nothing throws.
 */
export async function renderScenes(
  o: BlenderRenderOptions,
  deps: BlenderRenderDeps = {},
): Promise<BlenderRenderResult> {
  const spawn = deps.spawn ?? realSpawn;
  const bin = deps.blenderprocBin ?? 'blenderproc';
  const exists = deps.exists ?? defaultExists;
  const mkdirFn = deps.mkdir ?? (async (dir: string) => {
    await mkdir(dir, { recursive: true });
  });
  const timeoutMs = deps.timeoutMs ?? 30 * 60 * 1000;
  const imagesDir = join(o.outDir, 'images');
  const cocoPath = join(o.outDir, 'coco_annotations.json');

  try {
    await mkdirFn(o.outDir);
    const args = buildBlenderProcArgs(o);
    logger.info(`blender-render: ${bin} ${args.join(' ')}`);
    const { code, stderr } = await runProc(spawn, bin, args, { cwd: o.outDir }, timeoutMs);
    if (code !== 0) {
      return { ok: false, imagesDir, cocoPath, error: `blenderproc exited ${code}: ${stderr.trim().slice(-500)}` };
    }
    if (!(await exists(cocoPath))) {
      return { ok: false, imagesDir, cocoPath, error: `no coco_annotations.json at ${cocoPath}` };
    }
    return { ok: true, imagesDir, cocoPath };
  } catch (err) {
    return { ok: false, imagesDir, cocoPath, error: err instanceof Error ? err.message : String(err) };
  }
}
