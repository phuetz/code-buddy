import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createChangelogCommand, type ChangelogGitRunner } from '../../src/commands/changelog.js';
import type { ChangelogCommit } from '../../src/git/changelog.js';

const temporaryDirectories: string[] = [];
const TO_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SINCE_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function gitLog(commits: readonly ChangelogCommit[]): string {
  return `${commits.map((commit) => `${commit.hash}\0${commit.subject}\0${commit.body}`).join('\0')}\0`;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('buddy changelog command', () => {
  it('documents the Git checkout requirement for npm-pack installations', () => {
    const gettingStarted = readFileSync(
      path.join(process.cwd(), 'docs/getting-started.md'),
      'utf8',
    );

    expect(gettingStarted).toContain('installation npm pack');
    expect(gettingStarted).toContain('Git checkout');
    expect(gettingStarted).toContain('buddy changelog');
  });

  it('uses the last reachable tag by default and prints Markdown to stdout', async () => {
    const calls: string[][] = [];
    const runGit: ChangelogGitRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return '.git\n';
      if (args[0] === 'rev-parse' && args.at(-1) === 'HEAD^{commit}') return `${TO_HASH}\n`;
      if (args[0] === 'describe') return 'v1.2.0\n';
      if (args[0] === 'rev-parse' && args.at(-1) === 'v1.2.0^{commit}') {
        return `${SINCE_HASH}\n`;
      }
      if (args[0] === 'log') {
        return gitLog([
          {
            hash: '1234567890abcdef1234567890abcdef12345678',
            subject: 'feat(cli): ajoute changelog',
            body: '',
          },
        ]);
      }
      throw new Error(`Commande Git inattendue : ${args.join(' ')}`);
    };
    const stdout: string[] = [];

    await createChangelogCommand({
      cwd: '/repo',
      runGit,
      stdout: (value) => stdout.push(value),
    }).parseAsync(['node', 'changelog']);

    expect(calls).toContainEqual([
      'log',
      '-z',
      '--no-color',
      '--format=%H%x00%s%x00%b',
      `${SINCE_HASH}..${TO_HASH}`,
      '--',
    ]);
    expect(stdout.join('')).toContain('## Features');
    expect(stdout.join('')).toContain('**cli:** ajoute changelog (1234567)');
  });

  it('falls back to the full history when no tag is reachable', async () => {
    const calls: string[][] = [];
    const runGit: ChangelogGitRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return '.git\n';
      if (args[0] === 'rev-parse') return `${TO_HASH}\n`;
      if (args[0] === 'describe') throw new Error('No names found');
      if (args[0] === 'log') {
        return gitLog([
          {
            hash: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
            subject: 'Initial import',
            body: '',
          },
        ]);
      }
      throw new Error(`Commande Git inattendue : ${args.join(' ')}`);
    };
    const stdout: string[] = [];

    await createChangelogCommand({
      cwd: '/repo',
      runGit,
      stdout: (value) => stdout.push(value),
    }).parseAsync(['node', 'changelog']);

    expect(calls).toContainEqual([
      'log',
      '-z',
      '--no-color',
      '--format=%H%x00%s%x00%b',
      TO_HASH,
      '--',
    ]);
    expect(stdout.join('')).toContain('## Autres');
    expect(stdout.join('')).toContain('Initial import (abcdefa)');
  });

  it('emits valid grouped JSON and a clear message for an empty date range', async () => {
    const runGit: ChangelogGitRunner = async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return '.git\n';
      if (args[0] === 'rev-parse') return `${TO_HASH}\n`;
      if (args[0] === 'log') return '';
      throw new Error(`Commande Git inattendue : ${args.join(' ')}`);
    };
    const stdout: string[] = [];

    await createChangelogCommand({
      cwd: '/repo',
      runGit,
      stdout: (value) => stdout.push(value),
    }).parseAsync(['node', 'changelog', '--since', '2026-08-16', '--json']);

    const result = JSON.parse(stdout.join('')) as {
      totalCommits: number;
      message: string;
      range: { mode: string; since: string };
      sections: Array<{ title: string }>;
    };
    expect(result.totalCommits).toBe(0);
    expect(result.message).toContain('Aucun commit trouvé sur la plage');
    expect(result.range).toMatchObject({ mode: 'date', since: '2026-08-16' });
    expect(result.sections.map((section) => section.title)).toEqual([
      '⚠ Breaking Changes',
      'Features',
      'Bug Fixes',
      'Performance',
      'Docs',
      'Autres',
    ]);
  });

  it('prepends Markdown to --out while preserving the existing file', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'buddy-changelog-test-'));
    temporaryDirectories.push(cwd);
    const outputPath = path.join(cwd, 'CHANGELOG.md');
    await fs.writeFile(outputPath, '# Changelog\n\nAncien contenu.\n', 'utf8');

    const runGit: ChangelogGitRunner = async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return '.git\n';
      if (args[0] === 'rev-parse' && args.at(-1) === 'HEAD^{commit}') return `${TO_HASH}\n`;
      if (args[0] === 'rev-parse' && args.at(-1) === 'v1.0.0^{commit}') {
        return `${SINCE_HASH}\n`;
      }
      if (args[0] === 'log') {
        return gitLog([
          {
            hash: '76543210abcdef76543210abcdef76543210abcd',
            subject: 'fix(output): conserve le contenu',
            body: '',
          },
        ]);
      }
      throw new Error(`Commande Git inattendue : ${args.join(' ')}`);
    };

    await createChangelogCommand({ cwd, runGit }).parseAsync([
      'node',
      'changelog',
      '--since',
      'v1.0.0',
      '--out',
      'CHANGELOG.md',
    ]);

    const written = await fs.readFile(outputPath, 'utf8');
    expect(written).toMatch(/^# Release notes/);
    expect(written).toContain('- **output:** conserve le contenu (7654321)');
    expect(written.indexOf('# Release notes')).toBeLessThan(written.indexOf('# Changelog'));
    expect(written).toContain('Ancien contenu.');
  });

  it('fails explicitly outside a Git repository', async () => {
    const runGit: ChangelogGitRunner = async () => {
      throw new Error('fatal: not a git repository');
    };
    const stderr: string[] = [];
    const command = createChangelogCommand({ cwd: '/pas-un-repo', runGit });
    command.exitOverride();
    command.configureOutput({ writeErr: (value) => stderr.push(value) });

    await expect(command.parseAsync(['node', 'changelog'])).rejects.toMatchObject({
      code: 'buddy.changelog',
      exitCode: 1,
    });
    expect(stderr.join('')).toContain(`Ce dossier n’est pas un dépôt Git : ${path.resolve('/pas-un-repo')}`);
  });
});
