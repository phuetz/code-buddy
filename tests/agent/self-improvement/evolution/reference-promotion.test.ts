import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Command } from 'commander';
import { scoreReferenceInWorktree } from '../../../../src/agent/self-improvement/evolution/worktree-scorer.js';
import { CodeVariantStore } from '../../../../src/agent/self-improvement/evolution/code-variant-store.js';
import { registerEvolveCommands } from '../../../../src/commands/cli/evolve-command.js';
let root: string;
let original: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
beforeEach(async () => {
  original = process.cwd();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-evolve-ref-'));
  git('init', '-b', 'integration');
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(root, 'value.txt'), 'base');
  git('add', 'value.txt'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'base');
});
afterEach(async () => { process.chdir(original); process.exitCode = 0; vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });

it('scores the pinned reference rather than the current dirty checkout', async () => {
  const sha = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(root, 'value.txt'), 'uncommitted');
  const result = await scoreReferenceInWorktree(sha, { basePath: root, linkNodeModules: false, components: [{
    name: 'fixture', weight: 1, deterministic: true,
    run: async ctx => ({ name: 'fixture', weight: 1, passed: true, score: (await fs.readFile(path.join(ctx.checkoutDir, 'value.txt'), 'utf8')) === 'base' ? 1 : 0, detail: '' }),
  }] });
  expect(result.report.score).toBe(1);
  expect(await fs.readFile(path.join(root, 'value.txt'), 'utf8')).toBe('uncommitted');
  expect(git('branch', '--list', 'codebuddy/evaluate/*')).toBe('');
});

describe('actual keep command', () => {
  async function candidate() {
    git('checkout', '-b', 'candidate');
    await fs.writeFile(path.join(root, 'candidate.txt'), 'evaluated');
    git('add', 'candidate.txt'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'candidate');
    const sha = git('rev-parse', 'HEAD');
    git('checkout', 'integration');
    process.chdir(root);
    return { id: 'test', branch: 'candidate', sha, score: 0.8, passedAll: true, regressions: [] as string[], createdAt: new Date().toISOString() };
  }
  async function keep() {
    const program = new Command();
    program.exitOverride(); registerEvolveCommands(program);
    await program.parseAsync(['node', 'buddy', 'evolve', 'keep', 'test', '--confirm']);
  }
  it('refuses a branch moved after evaluation', async () => {
    const record = await candidate(); new CodeVariantStore().record(record);
    git('checkout', 'candidate'); await fs.writeFile(path.join(root, 'extra.txt'), 'unreviewed');
    git('add', 'extra.txt'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'unreviewed'); git('checkout', 'integration');
    const before = git('rev-parse', 'HEAD'); await keep();
    expect(process.exitCode).toBe(1); expect(git('rev-parse', 'HEAD')).toBe(before);
  });
  it.each([false, true])('refuses failed or regressed variants (regressed=%s)', async regressed => {
    const record = await candidate();
    new CodeVariantStore().record({ ...record, passedAll: regressed, regressions: regressed ? ['tests'] : [] });
    const before = git('rev-parse', 'HEAD'); await keep();
    expect(process.exitCode).toBe(1); expect(git('rev-parse', 'HEAD')).toBe(before);
  });
  it('merges precisely the evaluated commit on an integration branch', async () => {
    const record = await candidate(); new CodeVariantStore().record(record);
    git('config', 'commit.gpgsign', 'false'); await keep();
    expect(git('rev-parse', 'HEAD^2')).toBe(record.sha);
    expect(await fs.readFile(path.join(root, 'candidate.txt'), 'utf8')).toBe('evaluated');
  });
});
