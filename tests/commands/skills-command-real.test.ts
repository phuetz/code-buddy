import fs from 'fs/promises';
import { createServer, type Server } from 'http';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSkillsCommands } from '../../src/commands/skills-cli/index.js';
import { getSkillsHub, resetSkillsHub } from '../../src/skills/hub.js';

let tempHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerSkillsCommands(program);
  return program;
}

function skillContent(name: string, version: string, body: string): string {
  return [
    '---',
    `name: ${name}`,
    `version: ${version}`,
    `description: ${name} command test skill`,
    '---',
    '',
    `# ${name}`,
    '',
    body,
  ].join('\n');
}

function getLogOutput(): string {
  return consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
}

async function startSkillDiscoveryServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    if (pathname === '/repos/my-org/platform-skills/contents/internal/skills') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([
        { name: 'deploy-runbook', path: 'internal/skills/deploy-runbook', type: 'dir' },
        { name: '_draft', path: 'internal/skills/_draft', type: 'dir' },
        { name: 'README.md', path: 'internal/skills/README.md', type: 'file' },
      ]));
      return;
    }
    if (pathname === '/repos/my-org/platform-skills/contents/internal/skills/deploy-runbook/SKILL.md') {
      res.setHeader('content-type', 'text/markdown');
      res.end(skillContent('deploy-runbook', '1.2.3', 'Real tap discovery test skill.'));
      return;
    }
    if (pathname === '/.well-known/skills/index.json') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        skills: [
          {
            name: 'docs-helper',
            description: 'Help operate the docs site.',
            version: '0.4.0',
            tags: ['docs', 'well-known'],
            skillMdUrl: '/skills/docs-helper/SKILL.md',
          },
        ],
      }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind skill discovery server');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    }),
  };
}

describe('buddy skills command with real SkillsHub state', () => {
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-skills-command-'));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    resetSkillsHub();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    resetSkillsHub();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('doctor reports missing and tampered SKILL.md packages without mutating the lockfile', async () => {
    const hub = getSkillsHub({
      cacheDir: path.join(tempHome, 'cache'),
      lockfilePath: path.join(tempHome, 'lock.json'),
      skillsDir: path.join(tempHome, 'skills'),
    });
    await hub.installFromContent(
      'healthy-helper',
      skillContent('healthy-helper', '1.0.0', 'Healthy package.'),
    );
    const missing = await hub.installFromContent(
      'missing-helper',
      skillContent('missing-helper', '1.0.0', 'Will be removed from disk.'),
    );
    const tampered = await hub.installFromContent(
      'tampered-helper',
      skillContent('tampered-helper', '1.0.0', 'Will be edited on disk.'),
    );
    await fs.rm(missing.path, { force: true });
    await fs.writeFile(tampered.path, 'manual edit', 'utf-8');

    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'skills', 'doctor', '--json']);

    const result = JSON.parse(getLogOutput()) as {
      healthyCount: number;
      issueCount: number;
      issues: Array<{ commands: string[]; issue: string; name: string }>;
      ok: boolean;
      total: number;
    };

    expect(result).toMatchObject({
      healthyCount: 1,
      issueCount: 2,
      ok: false,
      total: 3,
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        commands: ['skill_manage action=delete name=missing-helper approved_by=<reviewer>'],
        issue: 'missing-file',
        name: 'missing-helper',
      }),
      expect.objectContaining({
        commands: [
          'skill_manage action=history name=tampered-helper',
          'skill_manage action=rollback name=tampered-helper approved_by=<reviewer>',
        ],
        issue: 'integrity-mismatch',
        name: 'tampered-helper',
      }),
    ]));
    expect(getSkillsHub().list()).toHaveLength(3);
  });

  it('manages skill taps with a real persisted taps file', async () => {
    const hub = getSkillsHub({
      cacheDir: path.join(tempHome, 'cache'),
      lockfilePath: path.join(tempHome, 'lock.json'),
      skillsDir: path.join(tempHome, 'skills'),
      tapsPath: path.join(tempHome, 'taps.json'),
    });
    const program = createProgram();

    await program.parseAsync([
      'node',
      'buddy',
      'skills',
      'tap',
      'add',
      'my-org/platform-skills',
      '--path',
      'internal/skills',
      '--approved-by',
      'Patrice',
      '--json',
    ]);

    let result = JSON.parse(getLogOutput()) as {
      tap: { addedBy?: string; path: string; repo: string; trust: string };
    };
    expect(result.tap).toMatchObject({
      addedBy: 'Patrice',
      path: 'internal/skills/',
      repo: 'my-org/platform-skills',
      trust: 'community',
    });
    expect(hub.listTaps()).toHaveLength(1);

    consoleLogSpy.mockClear();
    await program.parseAsync([
      'node',
      'buddy',
      'skills',
      'tap',
      'trust',
      'my-org/platform-skills',
      'trusted',
      '--approved-by',
      'Patrice',
      '--json',
    ]);
    result = JSON.parse(getLogOutput()) as {
      tap: { addedBy?: string; path: string; repo: string; trust: string };
    };
    expect(result.tap.trust).toBe('trusted');

    consoleLogSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'skills', 'tap', 'list', '--json']);
    const list = JSON.parse(getLogOutput()) as {
      count: number;
      taps: Array<{ repo: string; trust: string }>;
      tapsPath: string;
    };
    expect(list).toMatchObject({
      count: 1,
      tapsPath: path.join(tempHome, 'taps.json'),
    });
    expect(list.taps[0]).toMatchObject({
      repo: 'my-org/platform-skills',
      trust: 'trusted',
    });

    consoleLogSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'skills', 'tap', 'remove', 'my-org/platform-skills', '--json']);
    const removed = JSON.parse(getLogOutput()) as { removed: boolean; repo: string };
    expect(removed).toEqual({
      removed: true,
      repo: 'my-org/platform-skills',
    });
    expect(hub.listTaps()).toEqual([]);
  });

  it('refreshes GitHub-style tap discovery and well-known indexes through real HTTP paths', async () => {
    const server = await startSkillDiscoveryServer();
    try {
      const hub = getSkillsHub({
        cacheDir: path.join(tempHome, 'cache'),
        githubApiBaseUrl: server.baseUrl,
        githubRawBaseUrl: `${server.baseUrl}/raw`,
        lockfilePath: path.join(tempHome, 'lock.json'),
        registryUrl: `${server.baseUrl}/api/v1`,
        skillsDir: path.join(tempHome, 'skills'),
        tapsPath: path.join(tempHome, 'taps.json'),
      });
      hub.addTap('my-org/platform-skills', {
        actor: 'Patrice',
        path: 'internal/skills',
      });
      const program = createProgram();

      await program.parseAsync([
        'node',
        'buddy',
        'skills',
        'tap',
        'refresh',
        'my-org/platform-skills',
        '--json',
      ]);
      const tapOutput = JSON.parse(getLogOutput()) as {
        errors: Array<{ repo: string; error: string }>;
        skillCount: number;
        skills: Array<{ identifier: string; name: string; source: string; trust: string }>;
      };
      expect(tapOutput.errors).toEqual([]);
      expect(tapOutput.skillCount).toBe(1);
      expect(tapOutput.skills[0]).toMatchObject({
        identifier: 'my-org/platform-skills/deploy-runbook',
        name: 'deploy-runbook',
        source: 'github-tap',
        trust: 'community',
      });

      consoleLogSpy.mockClear();
      await program.parseAsync([
        'node',
        'buddy',
        'skills',
        'well-known',
        server.baseUrl,
        '--json',
      ]);
      const wellKnownOutput = JSON.parse(getLogOutput()) as {
        indexUrl: string;
        skillCount: number;
        skills: Array<{ contentUrl: string; identifier: string; name: string; source: string }>;
      };
      expect(wellKnownOutput.indexUrl).toBe(`${server.baseUrl}/.well-known/skills/index.json`);
      expect(wellKnownOutput.skillCount).toBe(1);
      expect(wellKnownOutput.skills[0]).toMatchObject({
        contentUrl: `${server.baseUrl}/skills/docs-helper/SKILL.md`,
        identifier: `well-known:${server.baseUrl}/skills/docs-helper`,
        name: 'docs-helper',
        source: 'well-known',
      });

      const cachedSearch = await hub.search('docs');
      expect(cachedSearch.skills.map((skill) => skill.name)).toContain('docs-helper');
      const tapSearch = await hub.search('deploy');
      expect(tapSearch.skills.map((skill) => skill.name)).toContain('deploy-runbook');

      consoleLogSpy.mockClear();
      await program.parseAsync([
        'node',
        'buddy',
        'skills',
        'tap',
        'refresh',
        'my-org/platform-skills',
        '--json',
      ]);
      const preservedSearch = await hub.search('docs');
      expect(preservedSearch.skills.map((skill) => skill.name)).toContain('docs-helper');
    } finally {
      await server.close();
    }
  });
});
