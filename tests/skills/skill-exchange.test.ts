import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firewallMock = vi.hoisted(() => vi.fn());
const processSpies = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));
vi.mock('../../src/security/skill-scanner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/security/skill-scanner.js')>();
  return { ...actual, scanSkillFirewall: firewallMock };
});
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, ...processSpies };
});

import { registerSkillsCommands } from '../../src/commands/skills-cli/index.js';
import {
  EXCHANGE_MANIFEST_FILE,
  exportSkill,
  installSkill,
  verifySkill,
  type ExchangeManifest,
} from '../../src/skills/skill-exchange.js';

let tempRoot: string;
let authorHome: string;
let installerHome: string;
let workspace: string;
let output: string;
let destination: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalCwd: string;

function allowFirewall(): void {
  firewallMock.mockReturnValue({
    schemaVersion: 1,
    capabilities: [],
    findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    findings: [],
    generatedAt: new Date(0).toISOString(),
    quarantineRequired: false,
    score: 100,
    summary: 'allow',
    target: workspace,
    verdict: 'allow',
  });
}

function useHome(home: string): void {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
}

function writeAuthoredSkill(name = 'authored-demo'): string {
  const dir = path.join(workspace, '.codebuddy', 'skills', name);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Demo exchange skill\nversion: 1.2.3\n---\n\n# Demo\nTreat scripts as inert package data.\n`,
    'utf-8',
  );
  fs.writeFileSync(path.join(dir, 'scripts', 'never-run.sh'), '#!/bin/sh\necho should-not-run\n', 'utf-8');
  return dir;
}

function exportDemo(): string {
  useHome(authorHome);
  writeAuthoredSkill();
  exportSkill('authored-demo', output);
  return path.join(output, 'authored-demo');
}

function readManifest(packageDir: string): ExchangeManifest {
  return JSON.parse(fs.readFileSync(path.join(packageDir, EXCHANGE_MANIFEST_FILE), 'utf-8')) as ExchangeManifest;
}

function writeManifest(packageDir: string, manifest: ExchangeManifest): void {
  fs.writeFileSync(path.join(packageDir, EXCHANGE_MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8');
}

beforeEach(() => {
  vi.clearAllMocks();
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  originalCwd = process.cwd();
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-skill-exchange-'));
  authorHome = path.join(tempRoot, 'author-home');
  installerHome = path.join(tempRoot, 'installer-home');
  workspace = path.join(tempRoot, 'workspace');
  output = path.join(tempRoot, 'registry');
  destination = path.join(tempRoot, 'installed');
  fs.mkdirSync(authorHome, { recursive: true });
  fs.mkdirSync(installerHome, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  process.chdir(workspace);
  process.env.CODEBUDDY_SKILL_EXCHANGE = 'true';
  allowFirewall();
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  delete process.env.CODEBUDDY_SKILL_EXCHANGE;
  firewallMock.mockReset();
  vi.restoreAllMocks();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('skill exchange export', () => {
  it('writes a complete signed manifest with correct hashes', () => {
    const packageDir = exportDemo();
    const manifest = readManifest(packageDir);

    expect(manifest).toMatchObject({
      name: 'authored-demo',
      version: '1.2.3',
      author: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
      publicKey: expect.stringContaining('BEGIN PUBLIC KEY'),
      signature: expect.any(String),
    });
    expect(manifest.files.map((file) => file.path)).toEqual(['SKILL.md', 'scripts/never-run.sh']);
    for (const file of manifest.files) {
      const actual = fs.readFileSync(path.join(packageDir, file.path));
      expect(file.sha256).toBe(createHash('sha256').update(actual).digest('hex'));
    }
  });

  it('returns a clean error for a missing skill', () => {
    useHome(authorHome);
    expect(() => exportSkill('authored-missing', output)).toThrow('Skill not found: authored-missing');
  });

  it('refuses an authored skill directory that escapes through a symlink', () => {
    useHome(authorHome);
    const outside = path.join(tempRoot, 'outside-skill');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(
      path.join(outside, 'SKILL.md'),
      '---\nname: authored-linked\ndescription: linked\n---\n\nlinked\n',
      'utf-8',
    );
    const skillsRoot = path.join(workspace, '.codebuddy', 'skills');
    fs.mkdirSync(skillsRoot, { recursive: true });
    fs.symlinkSync(outside, path.join(skillsRoot, 'authored-linked'), 'dir');

    expect(() => exportSkill('authored-linked', output)).toThrow('Skill not found: authored-linked');
  });

  it('is inert while the opt-in environment variable is disabled', () => {
    useHome(authorHome);
    writeAuthoredSkill();
    delete process.env.CODEBUDDY_SKILL_EXCHANGE;

    expect(() => exportSkill('authored-demo', output)).toThrow(/disabled/i);
    expect(fs.existsSync(path.join(authorHome, '.codebuddy'))).toBe(false);
  });
});

describe('skill exchange fail-closed install', () => {
  it('refuses an invalid signature before installation', () => {
    const packageDir = exportDemo();
    const manifest = readManifest(packageDir);
    const first = manifest.signature[0] === 'A' ? 'B' : 'A';
    writeManifest(packageDir, { ...manifest, signature: `${first}${manifest.signature.slice(1)}` });
    useHome(installerHome);

    expect(() => installSkill(packageDir, { trust: true, destRoot: destination })).toThrow(/signature/i);
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('refuses a file altered after signing', () => {
    const packageDir = exportDemo();
    fs.appendFileSync(path.join(packageDir, 'SKILL.md'), 'tampered', 'utf-8');
    useHome(installerHome);

    expect(() => installSkill(packageDir, { trust: true, destRoot: destination })).toThrow(/SHA-256 mismatch/i);
  });

  it('refuses an unsigned extra file', () => {
    const packageDir = exportDemo();
    fs.writeFileSync(path.join(packageDir, 'unsigned.txt'), 'not covered by the signature', 'utf-8');
    useHome(installerHome);

    expect(() => installSkill(packageDir, { trust: true, destRoot: destination })).toThrow(/unsigned files/i);
  });

  it('refuses a firewall quarantine verdict', () => {
    const packageDir = exportDemo();
    firewallMock.mockReturnValue({
      quarantineRequired: true,
      summary: 'dangerous script',
      verdict: 'quarantine',
    });
    useHome(installerHome);

    expect(() => installSkill(packageDir, { trust: true, destRoot: destination })).toThrow(/firewall refused/i);
  });

  it('requires explicit TOFU, stores the key with --trust, then accepts the same author', () => {
    const packageDir = exportDemo();
    useHome(installerHome);

    expect(() => installSkill(packageDir, { destRoot: destination })).toThrow(/Unknown exchange author/);
    const first = installSkill(packageDir, { trust: true, destRoot: destination });
    expect(first.trustedOnFirstUse).toBe(true);
    const store = JSON.parse(
      fs.readFileSync(path.join(installerHome, '.codebuddy', 'skill-signing', 'trusted-keys.json'), 'utf-8'),
    ) as { keys: Array<{ id: string }> };
    expect(store.keys.map((key) => key.id)).toContain(first.author);

    const second = installSkill(packageDir, { destRoot: destination });
    expect(second.trustedOnFirstUse).toBe(false);
    const installed = fs.readFileSync(path.join(destination, 'imported-authored-demo', 'SKILL.md'), 'utf-8');
    expect(installed).toContain('exchange: true');
    expect(installed).toContain(`author: ${first.author}`);
  });

  it('refuses to overwrite a non-exchange skill collision', () => {
    const packageDir = exportDemo();
    const collision = path.join(destination, 'imported-authored-demo');
    fs.mkdirSync(collision, { recursive: true });
    fs.writeFileSync(collision + '/SKILL.md', '---\nname: imported-authored-demo\ndescription: local\n---\n\nlocal\n');
    useHome(installerHome);

    expect(() => installSkill(packageDir, { trust: true, destRoot: destination })).toThrow(/non-exchange skill/i);
  });

  it('records verify, refusal, and install events in the local JSONL audit trail', () => {
    const packageDir = exportDemo();
    useHome(installerHome);

    verifySkill(packageDir);
    expect(() => installSkill(packageDir, { destRoot: destination })).toThrow(/Unknown exchange author/);
    installSkill(packageDir, { trust: true, destRoot: destination });

    const entries = fs.readFileSync(
      path.join(installerHome, '.codebuddy', 'skill-exchange-log.jsonl'),
      'utf-8',
    ).trim().split('\n').map((line) => JSON.parse(line) as { action: string; reason?: string });
    expect(entries.map((entry) => entry.action)).toEqual(['verify', 'refus', 'install']);
    expect(entries[1]?.reason).toMatch(/Unknown exchange author/);
  });
});

describe('skill exchange never executes package scripts', () => {
  it('does not spawn a process during export, verify, or install', () => {
    const packageDir = exportDemo();
    useHome(installerHome);

    verifySkill(packageDir);
    installSkill(packageDir, { trust: true, destRoot: destination });

    expect(processSpies.spawn).not.toHaveBeenCalled();
    expect(processSpies.spawnSync).not.toHaveBeenCalled();
    expect(processSpies.execFile).not.toHaveBeenCalled();
    expect(processSpies.execFileSync).not.toHaveBeenCalled();
  });
});

describe('buddy skills exchange CLI', () => {
  it('uses the existing Commander command pattern for dry verification', async () => {
    const packageDir = exportDemo();
    useHome(installerHome);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerSkillsCommands(program);

    await program.parseAsync(['node', 'buddy', 'skills', 'exchange', 'verify', packageDir, '--json']);

    const outputText = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(JSON.parse(outputText)).toMatchObject({ name: 'authored-demo', trusted: false });
    expect(fs.existsSync(destination)).toBe(false);
  });
});
