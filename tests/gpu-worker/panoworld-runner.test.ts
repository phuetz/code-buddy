import { execFile, spawn } from 'child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const RUNNER = resolve('scripts/gpu-runners/codebuddy_runner.py');
const TEST_COMMIT = 'a'.repeat(40);
const created: string[] = [];

async function fixture(width = 2048, height = 1024): Promise<{
  root: string;
  request: string;
  result: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'codebuddy-panoworld-runner-'));
  created.push(root);
  const modelRoot = join(root, 'PanoWorld');
  const input = join(root, 'input.ppm');
  const output = join(root, 'output');
  const checkpoint = join(modelRoot, 'checkpoints', 'ckpt_panoworld_lrm_2048_1024.ckpt');
  const request = join(root, 'request.json');
  const result = join(root, 'result.json');
  await mkdir(join(modelRoot, 'configs'), { recursive: true });
  await mkdir(join(modelRoot, 'checkpoints'), { recursive: true });
  await mkdir(output);
  await writeFile(input, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.alloc(width * height * 3, 128)]));
  await writeFile(checkpoint, 'verified-test-checkpoint');
  await writeFile(join(modelRoot, 'configs', 'inference_2048_1024.yaml'), 'test: true\n');
  await writeFile(join(modelRoot, 'configs', 'inference_1024_512.yaml'), 'test: true\n');
  await writeFile(
    join(modelRoot, 'inference.py'),
    [
      'import os, pathlib, signal, sys, time',
      'if os.environ.get("CODEBUDDY_TEST_INFERENCE_DELAY"):',
      '    if os.environ.get("CODEBUDDY_TEST_IGNORE_TERM"):',
      '        signal.signal(signal.SIGTERM, signal.SIG_IGN)',
      '    print("fixture inference ready", flush=True)',
      '    time.sleep(30)',
      'arg = next(value for value in sys.argv if value.startswith("inference.out_dir="))',
      'out = pathlib.Path(arg.split("=", 1)[1]) / "scene" / "views" / "output_ply"',
      '(out / "point_cloud" / "iteration_0").mkdir(parents=True, exist_ok=True)',
      '(out / "point_cloud" / "iteration_0" / "point_cloud.ply").write_text("ply")',
      '(out / "cameras.json").write_text("[]")',
      '(out / "render.png").write_bytes(b"png")',
      '(out / "depth.png").write_bytes(b"depth")',
    ].join('\n')
  );
  await writeFile(
    request,
    JSON.stringify({
      id: 'gpu-test',
      kind: 'panoworld_reconstruct',
      payload: {
        sceneId: 'kitchen',
        profile: 'single-2048',
        panoramas: [{ imagePath: input, roomId: 'kitchen' }],
        outputDir: output,
      },
    })
  );
  return { root, request, result };
}

function runnerEnv(
  item: { root: string; result: string },
  extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CODEBUDDY_GPU_JOB_RESULT: item.result,
    CODEBUDDY_GPU_ALLOWED_ROOTS_JSON: JSON.stringify([item.root]),
    CODEBUDDY_PANOWORLD_ROOT: join(item.root, 'PanoWorld'),
    CODEBUDDY_PANOWORLD_COMMIT: TEST_COMMIT,
    ...extra,
  };
}

afterEach(async () => {
  const { rm } = await import('fs/promises');
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

// This suite spawns the real Python GPU runner (scripts/gpu-runners/codebuddy_runner.py),
// which needs a Python environment with the RealSee3D/PanoWorld GPU dependencies. GitHub's
// hosted runners have python3 but not those deps (nor a GPU), so `python3 <runner>` exits
// non-zero there. Skip on CI (the runner is validated on the author's GPU box); the pure
// argv/manifest logic is covered by the other gpu-worker tests that don't spawn Python.
describe.skipIf(process.env.CI)('PanoWorld GPU runner', () => {
  it('prepares RealSee3D input and writes a verified manifest', async () => {
    const item = await fixture();
    const { stdout } = await execFileAsync('python3', [RUNNER, item.request], {
      env: runnerEnv(item),
    });

    const manifest = JSON.parse(await readFile(item.result, 'utf8')) as Record<string, unknown>;
    expect(stdout).toContain('CODEBUDDY_PROGRESS 1.00');
    expect(manifest).toMatchObject({
      sceneId: 'kitchen',
      profile: 'single-2048',
      viewCount: 1,
      status: 'succeeded',
      panoWorldCommit: TEST_COMMIT,
    });
    expect(String(manifest.plyPath)).toContain('point_cloud.ply');
    expect(manifest.checkpointSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.checkpointHashSource).toBe('computed');
    const staging = join(item.root, 'panoworld-staging', 'data', 'codebuddy_scene');
    expect(JSON.parse(await readFile(join(staging, 'map.json'), 'utf8'))).toEqual({
      view_000: [],
    });
    expect(await readFile(join(staging, 'viewpoints', 'view_000', 'extrinsics.txt'), 'utf8')).toContain(
      '1 0 0 0'
    );
    await expect(
      readFile(join(item.root, 'panoworld-staging', 'python-compat', 'sitecustomize.py'), 'utf8')
    ).resolves.toContain("hasattr(nn, 'RMSNorm')");

    const request = JSON.parse(await readFile(item.request, 'utf8')) as { id: string };
    request.id = 'gpu-test-cached';
    await writeFile(item.request, JSON.stringify(request));
    await execFileAsync('python3', [RUNNER, item.request], {
      env: runnerEnv(item),
    });
    const cachedManifest = JSON.parse(await readFile(item.result, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(cachedManifest.checkpointHashSource).toBe('stat-cache');
  });

  it('rejects multi-view input without measured camera poses', async () => {
    const item = await fixture(1024, 512);
    const raw = JSON.parse(await readFile(item.request, 'utf8')) as {
      payload: Record<string, unknown>;
    };
    raw.payload.profile = 'multi-1024';
    await writeFile(item.request, JSON.stringify(raw));

    await expect(
      execFileAsync('python3', [RUNNER, item.request], {
        env: runnerEnv(item, {
          CODEBUDDY_PANOWORLD_1024_CHECKPOINT: join(
            item.root,
            'PanoWorld',
            'checkpoints',
            'ckpt_panoworld_lrm_2048_1024.ckpt'
          ),
        }),
      })
    ).rejects.toMatchObject({ stderr: expect.stringContaining('requires a cameraToWorld matrix') });
  });

  it('rejects panoramas that are not exactly 2:1', async () => {
    const item = await fixture(2, 2);
    await expect(
      execFileAsync('python3', [RUNNER, item.request], {
        env: runnerEnv(item),
      })
    ).rejects.toMatchObject({ stderr: expect.stringContaining('exact 2:1 ratio') });
  });

  it('enforces the exact single-2048 dimensions after the 2:1 ratio check', async () => {
    const item = await fixture(4, 2);
    await expect(
      execFileAsync('python3', [RUNNER, item.request], { env: runnerEnv(item) })
    ).rejects.toMatchObject({ stderr: expect.stringContaining('requires a 2048x1024 panorama') });
  });

  it('fails closed when an input resolves outside the configured roots', async () => {
    const item = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'codebuddy-panoworld-outside-'));
    created.push(outside);
    const outsideImage = join(outside, 'outside.ppm');
    await writeFile(
      outsideImage,
      Buffer.concat([Buffer.from('P6\n2048 1024\n255\n'), Buffer.alloc(2048 * 1024 * 3, 128)])
    );
    const raw = JSON.parse(await readFile(item.request, 'utf8')) as {
      payload: { panoramas: Array<{ imagePath: string }> };
    };
    raw.payload.panoramas[0]!.imagePath = outsideImage;
    await writeFile(item.request, JSON.stringify(raw));

    await expect(
      execFileAsync('python3', [RUNNER, item.request], { env: runnerEnv(item) })
    ).rejects.toMatchObject({ stderr: expect.stringContaining('outside configured roots') });
  });

  it('terminates inference and atomically records cancellation', async () => {
    const item = await fixture();
    const child = spawn('python3', [RUNNER, item.request], {
      env: runnerEnv(item, {
        CODEBUDDY_TEST_INFERENCE_DELAY: '1',
        CODEBUDDY_TEST_IGNORE_TERM: '1',
        CODEBUDDY_PANOWORLD_CANCEL_GRACE_SECONDS: '0.1',
      }),
    });
    let stdout = '';
    const ready = new Promise<void>((resolvePromise, reject) => {
      child.once('error', reject);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.includes('fixture inference ready')) resolvePromise();
      });
    });
    await ready;
    child.kill('SIGTERM');
    const exitCode = await new Promise<number | null>((resolvePromise) =>
      child.once('close', resolvePromise)
    );

    expect(exitCode).toBe(130);
    await expect(readFile(`${item.result}.tmp`, 'utf8')).rejects.toThrow();
    const manifest = JSON.parse(await readFile(item.result, 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      status: 'cancelled',
      signal: 'SIGTERM',
      profile: 'single-2048',
      panoWorldCommit: TEST_COMMIT,
    });
    expect(manifest.checkpointSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
