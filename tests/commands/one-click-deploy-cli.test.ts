import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDeployCommands } from '../../src/commands/cli/deploy-command.js';
import type { OneClickReport } from '../../src/deploy/one-click-types.js';

function emptyReport(over: Partial<OneClickReport> = {}): OneClickReport {
  return {
    ok: true,
    dryRun: true,
    projectRoot: '/proj',
    durationMs: 12,
    steps: [],
    rollback: { supported: true, summary: 'rollback', commands: ['wrangler pages deployment list'] },
    ...over,
  };
}

describe('buddy deploy run CLI', () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  async function parse(argv: string[], runOneClick = vi.fn(async () => emptyReport())) {
    let out = '';
    let err = '';
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    registerDeployCommands(program, {
      write: (msg) => {
        out += `${msg}\n`;
      },
      writeErr: (msg) => {
        err += `${msg}\n`;
      },
      runOneClick,
    });
    await program.parseAsync(argv);
    return { out, err, runOneClick };
  }

  it('defaults to dry-run and does not pass apply', async () => {
    const { runOneClick, out } = await parse(['node', 'test', 'deploy', 'run', '/tmp/site']);
    expect(runOneClick).toHaveBeenCalledWith({
      projectRoot: '/tmp/site',
      apply: false,
      dryRun: true,
    });
    expect(out).toMatch(/simulation|One-click deploy/i);
  });

  it('--apply without --dry-run requests a live run', async () => {
    const { runOneClick } = await parse(['node', 'test', 'deploy', 'run', '--apply']);
    expect(runOneClick).toHaveBeenCalledWith({
      projectRoot: '.',
      apply: true,
      dryRun: false,
    });
  });

  it('--apply --dry-run keeps the simulation', async () => {
    const { runOneClick } = await parse(['node', 'test', 'deploy', 'run', '--apply', '--dry-run']);
    expect(runOneClick).toHaveBeenCalledWith({
      projectRoot: '.',
      apply: false,
      dryRun: true,
    });
  });

  it('sets exitCode 1 when the report is not ok', async () => {
    const runOneClick = vi.fn(async () => emptyReport({ ok: false, error: 'missing CLI' }));
    const { err } = await parse(['node', 'test', 'deploy', 'run'], runOneClick);
    expect(process.exitCode).toBe(1);
    expect(err).toMatch(/missing CLI/);
  });

  it('platforms lists cloudflare-pages and netlify', async () => {
    const { out } = await parse(['node', 'test', 'deploy', 'platforms']);
    expect(out).toMatch(/cloudflare-pages/);
    expect(out).toMatch(/netlify/);
    expect(out).toMatch(/dry-run|simulation|deploy run/i);
  });
});
