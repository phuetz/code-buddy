import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatOneClickReport,
  parseDeployOutput,
  runOneClickDeploy,
} from '../../src/deploy/one-click-engine.js';
import type { ExecFileResult, OneClickExecFile, OneClickFs } from '../../src/deploy/one-click-types.js';

async function fixture(opts: {
  target?: string;
  buildScript?: string;
  outputDir?: string;
  skipBuild?: boolean;
  siteId?: string;
  projectName?: string;
  withPkgBuild?: boolean;
  withDist?: boolean;
  withLocalWrangler?: boolean;
}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'one-click-deploy-'));
  await mkdir(path.join(root, '.codebuddy'), { recursive: true });
  if (opts.target !== undefined) {
    const body: Record<string, unknown> = { target: opts.target };
    if (opts.buildScript) body.buildScript = opts.buildScript;
    if (opts.outputDir) body.outputDir = opts.outputDir;
    if (opts.skipBuild) body.skipBuild = true;
    if (opts.siteId) body.siteId = opts.siteId;
    if (opts.projectName) body.projectName = opts.projectName;
    await writeFile(path.join(root, '.codebuddy', 'deploy.json'), JSON.stringify(body), 'utf8');
  }
  const pkg: { name: string; scripts?: Record<string, string> } = { name: 'demo-site' };
  if (opts.withPkgBuild !== false) pkg.scripts = { build: 'echo build' };
  await writeFile(path.join(root, 'package.json'), JSON.stringify(pkg), 'utf8');
  if (opts.withDist) {
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'dist', 'index.html'), '<h1>ok</h1>', 'utf8');
  }
  if (opts.withLocalWrangler) {
    const bin = path.join(root, 'node_modules', '.bin');
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, 'wrangler'), '#!/bin/sh\n', { mode: 0o755 });
  }
  return root;
}

function memWhich(map: Record<string, string | null>) {
  return async (command: string): Promise<string | null> => map[command] ?? null;
}

function trackingExec(handler: OneClickExecFile): { execFile: OneClickExecFile; calls: Array<{ file: string; args: readonly string[] }> } {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  return {
    calls,
    execFile: async (file, args, options) => {
      calls.push({ file, args });
      return handler(file, args, options);
    },
  };
}

const SECRET = 'cf-secret-token-value-never-log';

describe('runOneClickDeploy', () => {
  const envSnapshot = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key];
    }
    Object.assign(process.env, envSnapshot);
  });

  it('full simulation: plans build + upload and never invokes the host CLI', async () => {
    const root = await fixture({ target: 'cloudflare-pages', projectName: 'demo', withDist: true });
    const { execFile, calls } = trackingExec(async () => {
      throw new Error('execFile must not run in dry-run');
    });
    const report = await runOneClickDeploy(
      { projectRoot: root, dryRun: true },
      {
        execFile,
        which: memWhich({ wrangler: '/usr/bin/wrangler' }),
        resolveToken: async () => ({ name: 'CLOUDFLARE_API_TOKEN', value: SECRET, source: 'env' }),
        now: (() => {
          let t = 1_000;
          return () => (t += 25);
        })(),
      },
    );
    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.target).toBe('cloudflare-pages');
    expect(report.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'config:ok',
      'tool:ok',
      'token:ok',
      'build:planned',
      'output:planned',
      'upload:planned',
    ]);
    const upload = report.steps.find((s) => s.id === 'upload');
    expect(upload?.command).toMatch(/pages deploy dist --project-name demo/);
    expect(upload?.detail).toMatch(/dry-run/);
    expect(calls).toEqual([]);
    const text = formatOneClickReport(report);
    expect(text).toMatch(/simulation/);
    expect(text).not.toContain(SECRET);
    expect(JSON.stringify(report)).not.toContain(SECRET);
    expect(report.durationMs).toBeGreaterThan(0);
    expect(report.rollback.commands.length).toBeGreaterThan(0);
    expect(report.rollback.summary).toMatch(/Cloudflare Pages/);
  });

  it('missing official CLI explains what to install and does not download', async () => {
    const root = await fixture({ target: 'netlify', siteId: 'site-1' });
    const report = await runOneClickDeploy(
      { projectRoot: root, dryRun: true },
      {
        which: memWhich({}),
        resolveToken: async () => ({ name: 'NETLIFY_AUTH_TOKEN', value: SECRET, source: 'env' }),
        execFile: async () => ({ stdout: '', stderr: '', code: 0 }),
      },
    );
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/netlify CLI is not installed/i);
    expect(report.error).toMatch(/will not download/i);
    expect(report.steps.some((s) => s.id === 'upload')).toBe(false);
  });

  it('missing token names the env var and never logs a value', async () => {
    const root = await fixture({ target: 'cloudflare-pages' });
    const report = await runOneClickDeploy(
      { projectRoot: root, dryRun: true },
      {
        env: {},
        which: memWhich({ wrangler: '/usr/bin/wrangler' }),
        resolveToken: async () => null,
        execFile: async () => ({ stdout: '', stderr: '', code: 0 }),
      },
    );
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/CLOUDFLARE_API_TOKEN/);
    expect(report.token?.present).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/cf-secret/);
  });

  it('failed build stops before upload', async () => {
    const root = await fixture({ target: 'cloudflare-pages' });
    const { execFile, calls } = trackingExec(async (file, args) => {
      if (String(file).includes('npm') && args.includes('build')) {
        return { stdout: '', stderr: 'vite failed', code: 2 } satisfies ExecFileResult;
      }
      return { stdout: 'SHOULD NOT UPLOAD', stderr: '', code: 0 };
    });
    const report = await runOneClickDeploy(
      { projectRoot: root, apply: true, dryRun: false },
      {
        execFile,
        which: memWhich({ wrangler: '/usr/bin/wrangler' }),
        resolveToken: async () => ({ name: 'CLOUDFLARE_API_TOKEN', value: SECRET, source: 'vault' }),
      },
    );
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/Build failed/);
    expect(calls.some((c) => String(c.file).includes('wrangler'))).toBe(false);
    expect(report.steps.find((s) => s.id === 'upload')).toBeUndefined();
  });

  it('missing output directory after a successful build fails closed', async () => {
    const root = await fixture({ target: 'netlify', siteId: 'abc', skipBuild: true, withDist: false });
    const report = await runOneClickDeploy(
      { projectRoot: root, apply: true, dryRun: false },
      {
        which: memWhich({ netlify: '/usr/bin/netlify' }),
        resolveToken: async () => ({ name: 'NETLIFY_AUTH_TOKEN', value: SECRET, source: 'env' }),
        execFile: async () => ({ stdout: '', stderr: '', code: 0 }),
      },
    );
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/does not exist/);
    expect(report.steps.find((s) => s.id === 'output')?.status).toBe('error');
  });

  it('unknown target is rejected before any send', async () => {
    const root = await fixture({ target: 'vercel' });
    const report = await runOneClickDeploy(
      { projectRoot: root, apply: true, dryRun: false },
      {
        which: memWhich({ wrangler: '/usr/bin/wrangler', vercel: '/usr/bin/vercel' }),
        resolveToken: async () => ({ name: 'VERCEL_TOKEN', value: SECRET, source: 'env' }),
        execFile: async () => {
          throw new Error('network');
        },
      },
    );
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/Unknown deploy target "vercel"/);
    expect(report.dryRun).toBe(false);
  });

  it('absent config refuses to send', async () => {
    const root = await fixture({ withPkgBuild: true });
    const report = await runOneClickDeploy({ projectRoot: root, apply: true, dryRun: false });
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/No deploy target configured/);
  });

  it('apply path parses URL and id from CLI output and redacts the token', async () => {
    const root = await fixture({
      target: 'netlify',
      siteId: 'site-xyz',
      skipBuild: true,
      withDist: true,
    });
    const report = await runOneClickDeploy(
      { projectRoot: root, apply: true, dryRun: false },
      {
        which: memWhich({ netlify: '/usr/bin/netlify' }),
        resolveToken: async () => ({ name: 'NETLIFY_AUTH_TOKEN', value: SECRET, source: 'env' }),
        execFile: async (_file, args, options) => {
          expect(args).toEqual(['deploy', '--dir', 'dist', '--prod', '--json']);
          expect(options?.env?.NETLIFY_AUTH_TOKEN).toBe(SECRET);
          return {
            stdout: JSON.stringify({
              deploy_id: 'dep-123',
              ssl_url: 'https://demo.netlify.app',
              leak: SECRET,
            }),
            stderr: '',
            code: 0,
          };
        },
      },
    );
    expect(report.ok).toBe(true);
    expect(report.url).toBe('https://demo.netlify.app');
    expect(report.deployId).toBe('dep-123');
    expect(report.log).not.toContain(SECRET);
    expect(report.log).toContain('***');
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it('dry-run wins when both --apply and --dry-run are set', async () => {
    const root = await fixture({ target: 'cloudflare-pages' });
    let spawned = false;
    const report = await runOneClickDeploy(
      { projectRoot: root, apply: true, dryRun: true },
      {
        which: memWhich({ wrangler: '/opt/wrangler' }),
        resolveToken: async () => ({ name: 'CLOUDFLARE_API_TOKEN', value: SECRET, source: 'env' }),
        execFile: async () => {
          spawned = true;
          return { stdout: '', stderr: '', code: 0 };
        },
      },
    );
    expect(report.dryRun).toBe(true);
    expect(spawned).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('uses a local node_modules/.bin binary without PATH', async () => {
    const root = await fixture({ target: 'cloudflare-pages', withLocalWrangler: true });
    const report = await runOneClickDeploy(
      { projectRoot: root, dryRun: true },
      {
        which: memWhich({}),
        resolveToken: async () => ({ name: 'CLOUDFLARE_API_TOKEN', value: SECRET, source: 'env' }),
        execFile: async () => ({ stdout: '', stderr: '', code: 0 }),
      },
    );
    expect(report.ok).toBe(true);
    expect(report.steps.find((s) => s.id === 'tool')?.detail).toContain(path.join('node_modules', '.bin', 'wrangler'));
  });
});

describe('parseDeployOutput', () => {
  it('reads wrangler pages prose', () => {
    const parsed = parseDeployOutput(
      'cloudflare-pages',
      'Deployment complete! Take a peek over at https://abc.pages.dev\nDeployment ID: 9f3a',
    );
    expect(parsed.url).toBe('https://abc.pages.dev');
    expect(parsed.deployId).toBe('9f3a');
  });
});

describe('in-memory fs isolation', () => {
  it('does not touch the real filesystem when fs is injected', async () => {
    const files = new Map<string, string>([
      [
        path.join('/proj', '.codebuddy', 'deploy.json'),
        JSON.stringify({ target: 'cloudflare-pages', skipBuild: true, outputDir: 'dist' }),
      ],
      [path.join('/proj', 'package.json'), JSON.stringify({ name: 'x' })],
    ]);
    const fsImpl: OneClickFs = {
      async readFile(filePath) {
        const data = files.get(filePath);
        if (data === undefined) {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return data;
      },
      async stat() {
        return { isDirectory: () => true, isFile: () => true };
      },
      async mkdir() {},
      async appendFile() {},
    };
    const report = await runOneClickDeploy(
      { projectRoot: '/proj', dryRun: true },
      {
        fs: fsImpl,
        which: memWhich({ wrangler: '/bin/wrangler' }),
        resolveToken: async () => ({ name: 'CLOUDFLARE_API_TOKEN', value: 'tok', source: 'env' }),
        execFile: async () => ({ stdout: '', stderr: '', code: 0 }),
      },
    );
    expect(report.ok).toBe(true);
  });
});

it('refuse un dossier de sortie qui sort du projet par un lien symbolique', async () => {
  const { mkdtemp, mkdir, writeFile, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const pathMod = await import('node:path');
  const racine = await mkdtemp(pathMod.join(tmpdir(), 'deploy-symlink-'));
  const projet = pathMod.join(racine, 'projet');
  const dehors = pathMod.join(racine, 'dehors');
  await mkdir(projet);
  await mkdir(dehors);
  await writeFile(pathMod.join(dehors, 'secret.txt'), 'contenu confidentiel');
  await mkdir(pathMod.join(projet, '.codebuddy'));
  await writeFile(pathMod.join(projet, '.codebuddy', 'deploy.json'), JSON.stringify({ target: 'netlify', outputDir: 'dist' }));
  // `dist` pointe hors du projet : envoyer ce dossier publierait le secret.
  await symlink(dehors, pathMod.join(projet, 'dist'));
  try {
    const report = await runOneClickDeploy(
      { projectRoot: projet, dryRun: true },
      {
        which: memWhich({ netlify: '/usr/bin/netlify' }),
        resolveToken: async () => ({ name: 'NETLIFY_AUTH_TOKEN', value: SECRET, source: 'env' as const }),
        execFile: async () => ({ stdout: '', stderr: '', code: 0 }),
      },
    );
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).toMatch(/escapes project root/i);
  } finally {
    await rm(racine, { recursive: true, force: true });
  }
});
