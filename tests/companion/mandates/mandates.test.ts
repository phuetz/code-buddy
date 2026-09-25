import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ActionRequest,
  type DecisionContext,
  type Mandate,
  decideAutonomousAction,
  defaultProtectedPaths,
  loadMandates,
  mandatesFilePath,
} from '../../../src/companion/mandates/mandates.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandboxHome(): string {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'mandats-home-')));
  dirs.push(home);
  mkdirSync(path.join(home, 'Téléchargements', 'rangé'), { recursive: true });
  mkdirSync(path.join(home, '.codebuddy', 'lisa'), { recursive: true });
  return home;
}

const RANGER: Mandate = {
  id: 'ranger-telechargements',
  description: 'Ranger le dossier des téléchargements',
  confiance: 'autonome',
  origines: ['initiative', 'voice'],
  outils: ['move_file'],
  effets: ['reversible'],
  chemins: ['~/Téléchargements'],
  interdits: ['rm -rf'],
  plafond_par_jour: 3,
  expire: '2026-12-31',
};

function context(home: string, mandates: Mandate[] = [RANGER], used = 0): DecisionContext {
  return {
    mandates,
    mandatesFile: path.join(home, '.codebuddy', 'lisa', 'mandats.toml'),
    now: new Date(2026, 8, 24, 21, 0),
    usedToday: () => used,
    protectedPaths: defaultProtectedPaths(home),
    home,
  };
}

function move(home: string, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    tool: 'move_file',
    effect: 'reversible',
    origin: 'initiative',
    identity: { role: 'owner', confidence: 'high' },
    targets: [path.join(home, 'Téléchargements', 'rangé', 'facture.pdf')],
    ...overrides,
  };
}

describe('decideAutonomousAction — the charter, in order', () => {
  it('leaves an interactive session to its own flow', () => {
    const home = sandboxHome();
    expect(decideAutonomousAction(move(home, { origin: undefined }), context(home)).decision).toBe('defer');
  });

  it('never lets an unidentified voice act, even under a mandate', () => {
    const home = sandboxHome();
    for (const identity of [
      { role: 'guest' as const, confidence: 'none' as const },
      { role: 'present' as const, confidence: 'medium' as const },
      { role: 'owner' as const, confidence: 'medium' as const },
    ]) {
      expect(decideAutonomousAction(move(home, { origin: 'voice', identity }), context(home)).decision, identity.role).toBe('deny');
    }
    expect(decideAutonomousAction(move(home, { origin: 'voice' }), context(home)).decision).toBe('allow-with-checkpoint');
  });

  it('reading is free; an undeclared effect is asked', () => {
    const home = sandboxHome();
    expect(decideAutonomousAction(move(home, { tool: 'view_file', effect: 'read' }), context(home)).decision).toBe('allow');
    expect(decideAutonomousAction(move(home, { tool: 'mystery', effect: undefined }), context(home)).decision).toBe('ask');
  });

  it('an emission is always asked, whatever the mandates say', () => {
    const home = sandboxHome();
    const everything: Mandate = { ...RANGER, id: 'tout', outils: ['send_email'] };
    expect(decideAutonomousAction(
      move(home, { tool: 'send_email', effect: 'emission' }),
      context(home, [everything]),
    ).decision).toBe('ask');
  });

  it('a reversible action runs alone only under an autonomous mandate, with a restore point', () => {
    const home = sandboxHome();
    expect(decideAutonomousAction(move(home), context(home))).toEqual({
      decision: 'allow-with-checkpoint',
      reason: 'mandate ranger-telechargements: a verified restore point is required before execution',
      mandateId: 'ranger-telechargements',
      requiresCheckpoint: true,
    });
  });

  it('a supervised mandate still asks; no mandate asks', () => {
    const home = sandboxHome();
    const supervised = { ...RANGER, confiance: 'supervise' as const };
    expect(decideAutonomousAction(move(home), context(home, [supervised])).decision).toBe('ask');
    expect(decideAutonomousAction(move(home), context(home, [])).decision).toBe('ask');
  });

  it('asks outside the mandate: other path, other origin, other tool, expired, over the cap, forbidden word', () => {
    const home = sandboxHome();
    const cases: Array<[string, ActionRequest, DecisionContext]> = [
      ['path', move(home, { targets: [path.join(home, 'Documents', 'x.pdf')] }), context(home)],
      ['no target', move(home, { targets: [] }), context(home)],
      ['tool', move(home, { tool: 'delete_file' }), context(home)],
      ['origin', move(home, { origin: 'voice' }), context(home, [{ ...RANGER, origines: ['initiative'] }])],
      ['expired', move(home), context(home, [{ ...RANGER, expire: '2026-09-23' }])],
      ['cap', move(home), context(home, [RANGER], 3)],
      ['forbidden', move(home, { command: 'rm -rf ~/Téléchargements/rangé' }), context(home)],
    ];
    for (const [label, request, ctx] of cases) {
      expect(decideAutonomousAction(request, ctx).decision, label).toBe('ask');
    }
  });

  it('an invisible character or odd spacing cannot smuggle a forbidden word', () => {
    const home = sandboxHome();
    for (const command of ['rm\u200b -rf x', 'RM  -RF x', 'rm\u00a0-rf x']) {
      expect(decideAutonomousAction(move(home, { command }), context(home)).decision, JSON.stringify(command)).toBe('ask');
    }
  });

  it('a reversible action must name absolute targets', () => {
    const home = sandboxHome();
    expect(decideAutonomousAction(move(home, { targets: ['Téléchargements/rangé/x.pdf'] }), context(home)).decision).toBe('ask');
    expect(decideAutonomousAction(move(home, { targets: undefined }), context(home)).decision).toBe('ask');
  });

  it('the default guardrails hold even when the caller passes none', () => {
    const home = sandboxHome();
    const own = { ...RANGER, chemins: ['~'] };
    const request = move(home, { targets: [path.join(home, '.codebuddy', 'lisa', 'mandats.toml')] });
    expect(decideAutonomousAction(request, { ...context(home, [own]), protectedPaths: [] }).decision).toBe('deny');
  });

  it('Lisa never writes her own guardrails, even inside a mandated folder', () => {
    const home = sandboxHome();
    const own = { ...RANGER, chemins: ['~'] };
    const request = move(home, { targets: [path.join(home, '.codebuddy', 'lisa', 'mandats.toml')] });
    expect(decideAutonomousAction(request, context(home, [own])).decision).toBe('deny');
  });

  it('refuses access settings, keys, the charter and the rules code under a broad mandate', () => {
    const home = sandboxHome();
    const broad = { ...RANGER, chemins: ['~'] };
    const charterDir = path.join(home, 'charter');
    mkdirSync(charterDir);
    writeFileSync(path.join(charterDir, 'LIGNEE-HABITER-LE-ROBOT.md'), 'Owner rules');
    for (const target of [
      path.join(home, '.ssh', 'authorized_keys'),
      path.join(home, '.config', 'cloud', 'credentials.json'),
      path.join(home, 'Documents', '.env.production'),
      path.join(home, 'charter', 'LIGNEE-HABITER-LE-ROBOT.md'),
      charterDir,
      path.join(home, 'project', 'src', 'companion', 'mandates', 'mandates.ts'),
    ]) {
      expect(decideAutonomousAction(move(home, { targets: [target] }), context(home, [broad])).decision, target).toBe('deny');
    }
    expect(decideAutonomousAction(move(home, {
      tool: 'view_file', effect: 'read', targets: [path.join(home, '.ssh', 'authorized_keys')],
    }), context(home, [broad])).decision).toBe('deny');
  });

  it('protects the actual configurable mandate file', () => {
    const home = sandboxHome();
    const file = path.join(home, 'Documents', 'owner-rules.toml');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `version = 1
[[mandat]]
id = "broad"
description = "Broad folder"
confiance = "autonome"
origines = ["initiative"]
outils = ["move_file"]
effets = ["reversible"]
chemins = ["~"]
plafond_par_jour = 3
expire = "2026-12-31"
`);
    const configured = mandatesFilePath({ CODEBUDDY_LISA_MANDATES_FILE: file }, home);
    const loaded = loadMandates(configured);
    expect(loaded.problems).toEqual([]);
    expect(loaded.mandates).toHaveLength(1);
    const ctx = { ...context(home, loaded.mandates), mandatesFile: configured, protectedPaths: [] };
    expect(decideAutonomousAction(move(home, { targets: [file] }), ctx).decision).toBe('deny');
  });

  it.skipIf(process.platform === 'win32')('refuses a hard link that could change a guarded inode', () => {
    const home = sandboxHome();
    const guarded = path.join(home, '.codebuddy', 'lisa', 'mandats.toml');
    const alias = path.join(home, 'Téléchargements', 'rangé', 'anodin.toml');
    writeFileSync(guarded, 'version = 1\n');
    linkSync(guarded, alias);
    expect(decideAutonomousAction(move(home, { targets: [alias] }), context(home)).decision).toBe('deny');
  });

  it('a target that CONTAINS a guardrail is protected too', () => {
    const home = sandboxHome();
    const own = { ...RANGER, chemins: ['~'] };
    for (const target of [path.join(home, '.codebuddy'), home]) {
      expect(decideAutonomousAction(move(home, { targets: [target] }), context(home, [own])).decision, target).toBe('deny');
    }
  });

  it.skipIf(process.platform === 'win32')('a dangling symlink cannot hide where a write lands', () => {
    const home = sandboxHome();
    const trap = path.join(home, 'Téléchargements', 'pendant');
    symlinkSync(path.join(home, '.codebuddy', 'lisa', 'pas-encore', 'injecte.json'), trap);
    expect(decideAutonomousAction(move(home, { targets: [trap] }), context(home)).decision).toBe('deny');
  });

  it.skipIf(process.platform === 'win32')('a symlink planted in an allowed folder is judged by where it leads', () => {
    const home = sandboxHome();
    const trap = path.join(home, 'Téléchargements', 'piège');
    symlinkSync(path.join(home, '.codebuddy', 'lisa'), trap);
    const request = move(home, { targets: [path.join(trap, 'mandats.toml')] });
    expect(decideAutonomousAction(request, context(home)).decision).toBe('deny');
  });
});

describe('loadMandates — fails closed', () => {
  function write(body: string, mode = 0o600): string {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'mandats-file-')));
    dirs.push(dir);
    const file = path.join(dir, 'mandats.toml');
    writeFileSync(file, body);
    chmodSync(file, mode);
    return file;
  }
  const VALID = `version = 1

[[mandat]]
id = "ranger-telechargements"
description = "Ranger le dossier des téléchargements"
confiance = "autonome"
origines = ["initiative"]
outils = ["move_file"]
effets = ["reversible"]
chemins = ["~/Téléchargements"]
plafond_par_jour = 3
expire = "2026-12-31"
`;

  it('loads a valid owner-only file', () => {
    expect(loadMandates(write(VALID))).toEqual({ mandates: [expect.objectContaining({ id: 'ranger-telechargements' })], problems: [] });
  });

  it('no file is simply no mandate', () => {
    expect(loadMandates(path.join(tmpdir(), 'nope-mandats.toml'))).toEqual({ mandates: [], problems: [] });
  });

  it('an emission effect, an unknown key or a duplicate id rejects the whole file', () => {
    for (const body of [
      VALID.replace('effets = ["reversible"]', 'effets = ["emission"]'),
      VALID.replace('plafond_par_jour = 3', 'plafond_par_jour = 3\ncontourner = true'),
      VALID + VALID.slice(VALID.indexOf('[[mandat]]')),
    ]) {
      const loaded = loadMandates(write(body));
      expect(loaded.mandates).toEqual([]);
      expect(loaded.problems).toHaveLength(1);
    }
  });

  it('a mandate without roots is rejected', () => {
    const loaded = loadMandates(write(VALID.replace('chemins = ["~/Téléchargements"]\n', '')));
    expect(loaded.mandates).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('refuses a file reached through a symlinked directory', () => {
    const real = write(VALID);
    const aliasDir = path.join(path.dirname(path.dirname(real)), `alias-${path.basename(path.dirname(real))}`);
    symlinkSync(path.dirname(real), aliasDir);
    dirs.push(aliasDir);
    expect(loadMandates(path.join(aliasDir, 'mandats.toml')).mandates).toEqual([]);
    expect(loadMandates(real).mandates).toHaveLength(1);
  });

  it.skipIf(process.platform === 'win32')('refuses a file whose directory others can write', () => {
    const file = write(VALID);
    chmodSync(path.dirname(file), 0o777);
    expect(loadMandates(file).mandates).toEqual([]);
    chmodSync(path.dirname(file), 0o700);
    expect(loadMandates(file).mandates).toHaveLength(1);
  });

  it.skipIf(process.platform === 'win32')('refuses a symlinked or group-writable file', () => {
    const real = write(VALID);
    const link = path.join(path.dirname(real), 'lien.toml');
    symlinkSync(real, link);
    expect(loadMandates(link).mandates).toEqual([]);
    expect(loadMandates(write(VALID, 0o664)).mandates).toEqual([]);
  });
});
