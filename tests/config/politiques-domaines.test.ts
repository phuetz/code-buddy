/**
 * Politiques par domaine et assistant de sections.
 * HOME, CODEBUDDY_HOME et CODEBUDDY_CONFIG restent des répertoires temporaires.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { registerConfigCommand } from '../../src/commands/cli/config-command.js';
import { registerPolicyCommand } from '../../src/commands/cli/policy-command.js';
import { parseAnswersText, runConfigAssistant } from '../../src/config/config-assistant.js';
import { configBackupPath, configLastGoodPath } from '../../src/config/config-backup.js';
import {
  applyDomainPolicy,
  emptyPosture,
  parseDomainPolicy,
  postureFromDocument,
} from '../../src/config/domain-policy.js';
import { ManagedPoliciesManager, resetManagedPolicies } from '../../src/config/managed-policies.js';
import { assessPolicy, repairPolicy } from '../../src/config/policy-cycle.js';
import { parseTOML, resetConfigManager } from '../../src/config/toml-config.js';
import { checkDomainPolicy } from '../../src/doctor/domain-policy-check.js';
import { runDoctorChecks } from '../../src/doctor/index.js';

const previousHome = process.env.HOME;
const previousCodebuddyHome = process.env.CODEBUDDY_HOME;
const previousConfig = process.env.CODEBUDDY_CONFIG;
const previousCwd = process.cwd();
const previousExit = process.exitCode;
const homes: string[] = [];

afterEach(() => {
  resetManagedPolicies();
  resetConfigManager();
  process.exitCode = previousExit;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousCodebuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = previousCodebuddyHome;
  if (previousConfig === undefined) delete process.env.CODEBUDDY_CONFIG;
  else process.env.CODEBUDDY_CONFIG = previousConfig;
  process.chdir(previousCwd);
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

function isolate(configText = ''): { home: string; configFile: string; policyFile: string; missing: string } {
  const home = mkdtempSync(path.join(tmpdir(), 'cb-politique-'));
  homes.push(home);
  const directory = path.join(home, '.codebuddy');
  mkdirSync(directory, { recursive: true });
  const configFile = path.join(directory, 'config.toml');
  const policyFile = path.join(directory, 'managed-settings.json');
  if (configText) writeFileSync(configFile, configText.endsWith('\n') ? configText : `${configText}\n`);
  process.env.HOME = home;
  process.env.CODEBUDDY_HOME = home;
  process.env.CODEBUDDY_CONFIG = configFile;
  process.chdir(home);
  resetConfigManager();
  resetManagedPolicies();
  return { home, configFile, policyFile, missing: path.join(home, 'absent.json') };
}

function policyText(domains: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...extra, domains });
}

describe('application restrictive', () => {
  it('élève le bac à sable et prépare une réparation', () => {
    const posture = postureFromDocument({ sandbox: { mode: 'off' } });
    const result = applyDomainPolicy(posture, { sandbox: { mode: 'all' } });
    expect(result.effective.sandbox.mode).toBe('all');
    expect(result.findings.map((finding) => finding.id)).toContain('sandbox.mode');
    expect(result.findings.find((finding) => finding.id === 'sandbox.mode')?.kind).toBe('config-exceeds-policy');
    expect(result.findings.find((finding) => finding.id === 'sandbox.mode')?.repair).toEqual({
      key: 'sandbox.mode',
      value: 'all',
    });
  });

  it('ignore une politique de bac à sable plus ouverte', () => {
    const posture = postureFromDocument({ sandbox: { mode: 'all' } });
    const result = applyDomainPolicy(posture, { sandbox: { mode: 'off' } });
    expect(result.effective.sandbox.mode).toBe('all');
    expect(result.findings.find((finding) => finding.id === 'sandbox.mode')?.kind).toBe('policy-widens');
    expect(result.findings.find((finding) => finding.id === 'sandbox.mode')?.repair).toBeUndefined();
  });

  it('retire un canal non autorisé et n\'active pas un canal seulement cité', () => {
    const posture = postureFromDocument({
      channels: { telegram: { enabled: true, group_policy: 'open', dm_policy: 'open' } },
    });
    const result = applyDomainPolicy(posture, { channels: { enabled: ['slack'] } });
    expect(result.effective.channels.telegram?.enabled).toBe(false);
    expect(result.effective.channels.slack).toBeUndefined();
    expect(result.findings.some((finding) => finding.id === 'channels.slack.enabled.widens')).toBe(true);
    expect(result.findings.find((finding) => finding.id === 'channels.telegram.enabled.exceeds')?.repair?.value).toBe(false);
  });

  it('ferme les groupes et ne les rouvre pas', () => {
    const open = applyDomainPolicy(
      postureFromDocument({ channels: { telegram: { enabled: true, group_policy: 'open', dm_policy: 'open' } } }),
      { channels: { group_policy: 'allowlist', dm_policy: 'disabled' } },
    );
    expect(open.effective.channels.telegram?.group_policy).toBe('allowlist');
    expect(open.effective.channels.telegram?.dm_policy).toBe('disabled');
    const closed = applyDomainPolicy(
      postureFromDocument({ channels: { telegram: { enabled: true, group_policy: 'allowlist', dm_policy: 'disabled' } } }),
      { channels: { group_policy: 'open', dm_policy: 'open' } },
    );
    expect(closed.effective.channels.telegram?.group_policy).toBe('allowlist');
    expect(closed.effective.channels.telegram?.dm_policy).toBe('disabled');
    expect(closed.findings.every((finding) => finding.kind === 'policy-widens' || finding.repair === undefined)).toBe(true);
  });

  it('retire l\'écriture MCP et ne la rend pas', () => {
    const tightened = applyDomainPolicy(postureFromDocument({ mcp: { allow_write: true, enabled_servers: ['docs'] } }), {
      mcp: { allow_write: false, enabled_servers: ['docs'] },
    });
    expect(tightened.effective.mcp.allow_write).toBe(false);
    expect(tightened.findings.some((finding) => finding.id === 'mcp.allow_write.exceeds')).toBe(true);
    const kept = applyDomainPolicy(postureFromDocument({ mcp: { allow_write: false, enabled_servers: [] } }), {
      mcp: { allow_write: true },
    });
    expect(kept.effective.mcp.allow_write).toBe(false);
    expect(kept.findings.find((finding) => finding.id === 'mcp.allow_write.widens')?.repair).toBeUndefined();
  });

  it('intersecte les serveurs MCP au lieu de les additionner', () => {
    const result = applyDomainPolicy(
      postureFromDocument({ mcp: { allow_write: false, enabled_servers: ['docs', 'git'] } }),
      { mcp: { enabled_servers: ['docs', 'extra'] } },
    );
    expect(result.effective.mcp.enabled_servers).toEqual(['docs']);
    expect(result.findings.some((finding) => finding.id === 'mcp.enabled_servers.widens.extra')).toBe(true);
    expect(result.findings.find((finding) => finding.id === 'mcp.enabled_servers.exceeds')?.repair?.value).toEqual(['docs']);
  });

  it('durcit les approbations et n\'accepte pas de les relâcher', () => {
    const stricter = applyDomainPolicy(emptyPosture(), { exec: { approvals: 'always' } });
    expect(stricter.effective.exec.approvals).toBe('always');
    const looser = applyDomainPolicy(
      postureFromDocument({ exec: { approvals: 'always', allow_commands: [], deny_commands: [] } }),
      { exec: { approvals: 'off' } },
    );
    expect(looser.effective.exec.approvals).toBe('always');
    expect(looser.findings.find((finding) => finding.id === 'exec.approvals')?.kind).toBe('policy-widens');
  });

  it('n\'ajoute pas une commande permise et ajoute un refus', () => {
    const result = applyDomainPolicy(
      postureFromDocument({ exec: { approvals: 'ask', allow_commands: ['curl', 'wget'], deny_commands: [] } }),
      { exec: { allow_commands: ['curl', 'nc'], deny_commands: ['sudo'] } },
    );
    expect(result.effective.exec.allow_commands).toEqual(['curl']);
    expect(result.effective.exec.deny_commands).toEqual(['sudo']);
    expect(result.findings.some((finding) => finding.id === 'exec.allow_commands.widens.nc')).toBe(true);
    expect(result.findings.find((finding) => finding.id === 'exec.deny_commands.exceeds')?.repair?.value).toEqual(['sudo']);
  });

  it('une autorisation de politique ne couvre pas un refus', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'cb-politique-cmd-')), 'managed.json');
    homes.push(path.dirname(file));
    writeFileSync(file, policyText(
      { exec: { allow_commands: ['sudo'] } },
      { disallowedCommands: ['sudo'] },
    ));
    const manager = new ManagedPoliciesManager(path.join(path.dirname(file), 'absent.json'), file);
    expect(manager.isCommandAllowed('sudo apt')).toBe(false);
    expect(manager.isCommandAllowed('ls')).toBe(true);
    const assessed = manager.assessDomain(emptyPosture());
    expect(assessed.effective.exec.allow_commands).not.toContain('sudo');
  });

  it('ferme la passerelle et ne l\'ouvre pas', () => {
    const tighter = applyDomainPolicy(
      postureFromDocument({ gateway: { bind: 'lan', auth_mode: 'none' } }),
      { gateway: { bind: 'loopback', auth_mode: 'token' } },
    );
    expect(tighter.effective.gateway).toEqual({ bind: 'loopback', auth_mode: 'token' });
    const wider = applyDomainPolicy(emptyPosture(), { gateway: { bind: 'lan', auth_mode: 'none' } });
    expect(wider.effective.gateway).toEqual({ bind: 'loopback', auth_mode: 'token' });
    expect(wider.findings.filter((finding) => finding.domain === 'gateway').every((finding) => finding.kind === 'policy-widens')).toBe(true);
  });

  it('retire un moteur interdit sans en écrire un autre', () => {
    const result = applyDomainPolicy(
      postureFromDocument({ sandbox: { mode: 'all', backend: 'docker' } }),
      { sandbox: { allowed_backends: ['bwrap'] } },
    );
    expect(result.effective.sandbox.backend).toBeUndefined();
    expect(result.findings.find((finding) => finding.id === 'sandbox.backend.exceeds')?.repair).toEqual({
      key: 'sandbox.backend',
      value: null,
    });
    const absent = applyDomainPolicy(emptyPosture(), { sandbox: { allowed_backends: ['bwrap'] } });
    expect(absent.findings.some((finding) => finding.id.startsWith('sandbox.backend'))).toBe(false);
    expect(absent.effective.sandbox.backend).toBeUndefined();
  });

  it('ignore un domaine ou une valeur inconnue', () => {
    const parsed = parseDomainPolicy({
      sandbox: { mode: 'partout' },
      autre: { ouvert: true },
    });
    expect(parsed.findings.some((finding) => finding.kind === 'policy-invalid')).toBe(true);
    expect(parsed.policy?.sandbox?.mode).toBeUndefined();
    const result = applyDomainPolicy(postureFromDocument({ sandbox: { mode: 'all' } }), parsed.policy);
    expect(result.effective.sandbox.mode).toBe('all');
  });
});

describe('cycle constats puis réparation', () => {
  it('écrit la restriction, garde une sauvegarde, et ne retouche pas la politique', async () => {
    const isolated = isolate('[sandbox]\nmode = "off"\n');
    const beforePolicy = policyText({ sandbox: { mode: 'all' } });
    writeFileSync(isolated.policyFile, beforePolicy);
    const first = await repairPolicy({
      systemPath: isolated.missing,
      userPath: isolated.policyFile,
      userConfig: parseTOML(readFileSync(isolated.configFile, 'utf8')),
    });
    expect(first.errors, first.errors.join('\n')).toEqual([]);
    expect(readFileSync(isolated.configFile, 'utf8')).toContain('mode = "all"');
    expect(readFileSync(configBackupPath(isolated.configFile, 0), 'utf8')).toContain('mode = "off"');
    expect(readFileSync(configLastGoodPath(isolated.configFile), 'utf8')).toBe(readFileSync(isolated.configFile, 'utf8'));
    expect(readFileSync(isolated.policyFile, 'utf8')).toBe(beforePolicy);
    const second = assessPolicy({
      systemPath: isolated.missing,
      userPath: isolated.policyFile,
      userConfig: parseTOML(readFileSync(isolated.configFile, 'utf8')),
    });
    expect(second.findings.some((finding) => finding.kind === 'config-exceeds-policy')).toBe(false);
  });

  it('le contrôle à blanc n\'écrit pas', async () => {
    const isolated = isolate('[sandbox]\nmode = "off"\n');
    writeFileSync(isolated.policyFile, policyText({ sandbox: { mode: 'all' } }));
    const before = readFileSync(isolated.configFile, 'utf8');
    const report = await repairPolicy({
      systemPath: isolated.missing,
      userPath: isolated.policyFile,
      userConfig: parseTOML(before),
      dryRun: true,
    });
    expect(report.repairs.length).toBeGreaterThan(0);
    expect(readFileSync(isolated.configFile, 'utf8')).toBe(before);
    expect(existsSync(configBackupPath(isolated.configFile, 0))).toBe(false);
  });

  it('doctor signale l\'écart et la réparation restreint', async () => {
    const isolated = isolate('[gateway]\nbind = "lan"\n');
    writeFileSync(isolated.policyFile, policyText({ gateway: { bind: 'loopback' } }));
    const check = checkDomainPolicy({
      systemPath: isolated.missing,
      userPath: isolated.policyFile,
      configFile: isolated.configFile,
    });
    expect(check.status).toBe('warn');
    expect(check.fixable).toBe(true);
    expect(check.message).toContain('gateway.bind');
    const fixed = await check.fix?.();
    expect(fixed?.success).toBe(true);
    expect(fixed?.action).toBe('restrict-domain-policy');
    expect(readFileSync(isolated.configFile, 'utf8')).toContain('bind = "loopback"');
  });

  it('sans politique, doctor reste sain et n\'écrit rien', async () => {
    const isolated = isolate();
    const check = checkDomainPolicy({
      systemPath: isolated.missing,
      userPath: isolated.policyFile,
      configFile: isolated.configFile,
    });
    expect(check.status).toBe('ok');
    expect(check.fixable).toBeUndefined();
    const checks = await runDoctorChecks(isolated.home, { offline: true, noSubprocess: true });
    const named = checks.find((item) => item.name === 'Domain policy');
    expect(named?.status).toBe('ok');
    expect(existsSync(isolated.configFile)).toBe(false);
  });

  it('la commande check rend le constat en JSON', async () => {
    const isolated = isolate('[exec]\napprovals = "ask"\n');
    writeFileSync(isolated.policyFile, policyText({ exec: { approvals: 'always' } }));
    const program = new Command();
    program.exitOverride();
    registerPolicyCommand(program);
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await program.parseAsync(['node', 'buddy', 'policy', 'check', '--json']);
    } finally {
      process.stdout.write = write;
    }
    const report = JSON.parse(chunks.join('')) as { ok: boolean; findings: Array<{ id: string }> };
    expect(report.ok).toBe(false);
    expect(report.findings.some((finding) => finding.id === 'exec.approvals')).toBe(true);
    expect(process.exitCode).toBe(1);
  });
});

describe('assistant par sections', () => {
  it('écrit une section depuis un fichier de réponses et sauvegarde', async () => {
    const isolated = isolate('active_model = "grok-4"\n');
    const answers = path.join(isolated.home, 'reponses.json');
    writeFileSync(answers, JSON.stringify({ 'sandbox.mode': 'non-main' }));
    const program = new Command();
    program.exitOverride();
    registerConfigCommand(program);
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await program.parseAsync(['node', 'buddy', 'config', '--section', 'sandbox', '--answers', answers, '--json']);
    } finally {
      process.stdout.write = write;
    }
    const report = JSON.parse(chunks.join('')) as { ok: boolean; errors: string[] };
    expect(report.ok, report.errors.join('\n')).toBe(true);
    expect(readFileSync(isolated.configFile, 'utf8')).toContain('mode = "non-main"');
    expect(readFileSync(configBackupPath(isolated.configFile, 0), 'utf8')).toContain('active_model');
  });

  it('refuse une clé d\'une autre section', async () => {
    isolate('active_model = "grok-4"\n');
    const report = await runConfigAssistant({
      section: 'model',
      answers: { 'ui.theme': 'papier' },
    });
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toContain('n\'appartient pas');
    expect(report.operations).toEqual([]);
  });

  it('refuse une section inconnue', async () => {
    isolate();
    const report = await runConfigAssistant({ section: 'secret', answers: { 'sandbox.mode': 'all' } });
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toContain('Section inconnue');
  });

  it('lit des réponses JSON fournies comme entrée standard', () => {
    const parsed = parseAnswersText('{"gateway.port": 3000, "gateway.bind": "loopback"}');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.answers['gateway.port']).toBe(3000);
  });

  it('refuse une valeur hors schéma avant d\'écrire', async () => {
    const isolated = isolate('[sandbox]\nmode = "off"\n');
    const before = readFileSync(isolated.configFile, 'utf8');
    const report = await runConfigAssistant({
      section: 'sandbox',
      answers: { 'sandbox.mode': 'partout' },
    });
    expect(report.ok).toBe(false);
    expect(readFileSync(isolated.configFile, 'utf8')).toBe(before);
  });

  it('règle le modèle de la section model', async () => {
    const isolated = isolate('active_model = "grok-4"\n');
    const report = await runConfigAssistant({
      section: 'model',
      answers: { 'model_roles.primary': 'grok-4' },
    });
    expect(report.ok, report.errors.join('\n')).toBe(true);
    expect(readFileSync(isolated.configFile, 'utf8')).toContain('primary = "grok-4"');
  });

  it('conserve les anciens refus d\'outils et de modèles', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cb-politique-ancien-'));
    homes.push(root);
    const file = path.join(root, 'managed.json');
    writeFileSync(file, policyText(
      { sandbox: { mode: 'all' } },
      { disallowedTools: ['bash'], allowedModels: ['grok-4'], disallowedCommands: ['sudo'] },
    ));
    const manager = new ManagedPoliciesManager(path.join(root, 'absent.json'), file);
    expect(manager.isManaged()).toBe(true);
    expect(manager.isToolAllowed('bash')).toBe(false);
    expect(manager.isToolAllowed('read_file')).toBe(true);
    expect(manager.isCommandAllowed('sudo ls')).toBe(false);
    expect(manager.getPolicies().allowedModels).toEqual(['grok-4']);
    expect(manager.getPolicies().domains?.sandbox?.mode).toBe('all');
  });
});
