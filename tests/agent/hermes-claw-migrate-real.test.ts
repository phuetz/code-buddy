import { Command } from 'commander';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectOpenClawHome,
  runClawMigration,
  buildClawMigrationPlan,
} from '../../src/agent/hermes-claw-migrate.js';
import { registerHermesCommands } from '../../src/commands/cli/hermes-commands.js';
import { SkillsHub } from '../../src/skills/hub.js';

const SECRET_VALUE = 'tg-secret-value-do-not-leak';

function skillContent(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'version: 1.0.0',
    `description: ${name} migrated from OpenClaw`,
    'author: OpenClaw',
    'tags:',
    '  - migrated',
    '---',
    '',
    `# ${name}`,
    '',
    'Body content.',
    '',
  ].join('\n');
}

function writeOpenClawFixture(home: string): void {
  fs.ensureDirSync(home);
  fs.writeFileSync(path.join(home, 'SOUL.md'), '# Persona\nI am the migrated OpenClaw persona.\n');
  fs.writeFileSync(path.join(home, 'MEMORY.md'), '- OpenClaw remembered fact A\n- fact B\n');
  fs.writeFileSync(path.join(home, 'USER.md'), '# User\nName: Patrice\n');
  fs.writeFileSync(path.join(home, 'AGENTS.md'), '# Agents\nmigrated agent doc\n');
  fs.writeJsonSync(path.join(home, 'clawdbot.json'), {
    model: 'claude-sonnet-4-6',
    thinkingLevel: 'high',
    mcpServers: { files: { command: 'mcp-files', args: [] } },
    providers: { customA: { baseURL: 'https://example.invalid' } },
    channels: { telegram: { enabled: true } },
    tts: { voice: 'alloy' },
    cron: [{ schedule: '0 9 * * *', task: 'daily' }],
    // Expanded category set (toward upstream `hermes claw migrate` parity).
    toolsets: { core: ['file', 'terminal'] },
    profiles: { coder: { model: 'gpt-5.5' } },
    bundles: { research: ['web-search', 'browser'] },
    pairing: { devices: [{ id: 'phone-1' }] },
    runtimes: { docker: { image: 'ubuntu' } },
    // A webhooks slice can carry a credential — assert it is archived 0600 and
    // its secret value never leaks into the report.
    webhooks: { deploy: { url: 'https://hooks.invalid', token: SECRET_VALUE } },
    hooks: { preToolUse: [{ command: 'echo hi' }] },
    TELEGRAM_BOT_TOKEN: SECRET_VALUE,
    apiKeys: { OPENAI_API_KEY: 'sk-also-secret' },
  });
  const skillDir = path.join(home, 'skills', 'demo-skill');
  fs.ensureDirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent('demo-skill'));
}

describe('hermes claw migrate (real)', () => {
  let tmp: string;
  let openclaw: string;
  let target: string;
  let hub: SkillsHub;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-migrate-'));
    openclaw = path.join(tmp, '.openclaw');
    target = path.join(tmp, 'project');
    fs.ensureDirSync(target);
    writeOpenClawFixture(openclaw);
    hub = new SkillsHub({
      skillsDir: path.join(tmp, 'hub', 'managed'),
      cacheDir: path.join(tmp, 'hub', 'cache'),
      lockfilePath: path.join(tmp, 'hub', 'lock.json'),
      tapsPath: path.join(tmp, 'hub', 'taps.json'),
    });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('detects the OpenClaw home from an explicit source', () => {
    expect(detectOpenClawHome({ source: openclaw })).toBe(path.resolve(openclaw));
    expect(detectOpenClawHome({ source: path.join(tmp, 'nope') })).toBeNull();
  });

  it('plans a dry-run without writing anything', async () => {
    const report = await runClawMigration({ source: openclaw, workspaceTarget: target, skillsHub: hub, apply: false });

    expect(report.detected).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.applied).toBe(false);
    expect(report.summary.import).toBeGreaterThan(0);

    const categories = new Map(report.entries.map((e) => [e.category, e.action]));
    expect(categories.get('persona')).toBe('import');
    expect(categories.get('memory')).toBe('import');
    expect(categories.get('model')).toBe('import');
    expect(categories.get('mcp_servers')).toBe('import');
    expect(report.entries.some((e) => e.category === 'skills' && e.action === 'import')).toBe(true);

    // No writes on dry-run.
    expect(fs.existsSync(path.join(target, 'SOUL.md'))).toBe(false);
    expect(fs.existsSync(path.join(target, '.codebuddy'))).toBe(false);
    expect(hub.list()).toHaveLength(0);
  });

  it('applies imports to real, consumer-backed destinations', async () => {
    const report = await runClawMigration({ source: openclaw, workspaceTarget: target, skillsHub: hub, apply: true });

    expect(report.applied).toBe(true);
    expect(report.summary.failedCount).toBe(0);

    // Identity files copied to the workspace.
    expect(fs.readFileSync(path.join(target, 'SOUL.md'), 'utf-8')).toContain('migrated OpenClaw persona');
    expect(fs.readFileSync(path.join(target, 'USER.md'), 'utf-8')).toContain('Patrice');
    expect(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf-8')).toContain('migrated agent doc');

    // Memory appended to the project memory file.
    const memory = fs.readFileSync(path.join(target, '.codebuddy', 'CODEBUDDY_MEMORY.md'), 'utf-8');
    expect(memory).toContain('Migrated from OpenClaw');
    expect(memory).toContain('OpenClaw remembered fact A');

    // Settings written with model + mcpServers (the real consumers read these keys).
    const settings = fs.readJsonSync(path.join(target, '.codebuddy', 'settings.json'));
    expect(settings.model).toBe('claude-sonnet-4-6');
    expect(settings.mcpServers.files).toBeTruthy();

    // Skill installed into the injected hub.
    expect(hub.list().map((s) => s.name)).toContain('demo-skill');

    // Archive-for-review categories written, not applied to live config.
    const archiveDir = path.join(target, '.codebuddy', 'openclaw-migration', 'archive');
    expect(fs.existsSync(path.join(archiveDir, 'custom_providers.json'))).toBe(true);
    expect(fs.existsSync(path.join(archiveDir, 'cron.json'))).toBe(true);

    // Expanded categories are archived (never imported), each to its own file.
    for (const file of ['toolsets.json', 'profiles.json', 'bundles.json', 'pairing.json', 'runtimes.json', 'webhooks.json', 'hooks.json']) {
      expect(fs.existsSync(path.join(archiveDir, file))).toBe(true);
    }

    // None of the expanded categories leaked into live settings.json.
    const liveSettings = fs.readJsonSync(path.join(target, '.codebuddy', 'settings.json'));
    expect(liveSettings.toolsets).toBeUndefined();
    expect(liveSettings.hooks).toBeUndefined();
    expect(liveSettings.webhooks).toBeUndefined();
  });

  it('covers the expanded category set (30+) and never leaks secrets in expanded slices', async () => {
    const report = await runClawMigration({ source: openclaw, workspaceTarget: target, skillsHub: hub, apply: true });

    // The report enumerates the full category surface (import + archive + secrets).
    const categories = new Set(report.entries.map((e) => e.category));
    for (const expected of [
      'toolsets', 'profiles', 'bundles', 'pairing', 'vision', 'image_video',
      'runtimes', 'portal', 'learning_loop', 'kanban', 'webhooks', 'hooks',
    ]) {
      expect(categories.has(expected)).toBe(true);
    }
    // 30+ distinct categories recognized (parity target).
    expect(categories.size).toBeGreaterThanOrEqual(30);

    // Present expanded categories are archived; absent ones are skipped.
    const action = new Map(report.entries.map((e) => [e.category, e.action]));
    expect(action.get('toolsets')).toBe('archive');
    expect(action.get('webhooks')).toBe('archive');
    expect(action.get('vision')).toBe('skip'); // not present in fixture

    // A webhook token in the source must never surface in the report object.
    expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);

    // The webhooks archive file carries the value (for manual handling) and is 0600.
    const webhooksFile = path.join(target, '.codebuddy', 'openclaw-migration', 'archive', 'webhooks.json');
    expect(fs.readFileSync(webhooksFile, 'utf-8')).toContain('token');
    if (process.platform !== 'win32') {
      expect(fs.statSync(webhooksFile).mode & 0o777).toBe(0o600);
    }
  });

  it('never leaks secret values and skips secrets without --migrate-secrets', async () => {
    const report = await runClawMigration({ source: openclaw, workspaceTarget: target, skillsHub: hub, apply: true });

    const secrets = report.entries.find((e) => e.category === 'secrets');
    expect(secrets?.action).toBe('skip');
    // Source names are surfaced, raw values never are.
    expect(secrets?.detail).toContain('TELEGRAM_BOT_TOKEN');
    expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);

    // No secrets review file when not requested.
    const secretsFile = path.join(target, '.codebuddy', 'openclaw-migration', 'archive', 'secrets.json');
    expect(fs.existsSync(secretsFile)).toBe(false);
  });

  it('archives secrets to a review file with --migrate-secrets (still not in the report)', async () => {
    const report = await runClawMigration({
      source: openclaw,
      workspaceTarget: target,
      skillsHub: hub,
      apply: true,
      migrateSecrets: true,
    });

    const secrets = report.entries.find((e) => e.category === 'secrets');
    expect(secrets?.action).toBe('archive');
    expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);

    const secretsFile = path.join(target, '.codebuddy', 'openclaw-migration', 'archive', 'secrets.json');
    expect(fs.existsSync(secretsFile)).toBe(true);
    // The review file is where the actual values live (for manual handling).
    expect(fs.readFileSync(secretsFile, 'utf-8')).toContain('TELEGRAM_BOT_TOKEN');
  });

  it('honors --skill-conflict skip on a second apply', async () => {
    await runClawMigration({ source: openclaw, workspaceTarget: target, skillsHub: hub, apply: true });
    const second = await runClawMigration({
      source: openclaw,
      workspaceTarget: target,
      skillsHub: hub,
      apply: true,
      skillConflict: 'skip',
    });

    const skill = second.entries.find((e) => e.category === 'skills' && e.label === 'skill:demo-skill');
    expect(skill?.action).toBe('skip');
    expect(hub.list().filter((s) => s.name === 'demo-skill')).toHaveLength(1);
  });

  it('reports a missing OpenClaw install gracefully', async () => {
    const report = await runClawMigration({ source: path.join(tmp, 'absent'), apply: false });
    expect(report.detected).toBe(false);
    expect(report.entries).toHaveLength(0);
    expect(report.notes.join(' ')).toMatch(/No OpenClaw installation/i);
  });

  it('builds a plan that is purely read-only', () => {
    const entries = buildClawMigrationPlan({ source: openclaw, workspaceTarget: target });
    expect(entries.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(target, '.codebuddy'))).toBe(false);
  });

  it('exposes `buddy hermes claw status --json` through the CLI', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
      registerHermesCommands(program);

      await program.parseAsync(['node', 'test', 'hermes', 'claw', 'status', '--source', openclaw, '--json']);

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const payload = JSON.parse(output);
      expect(payload.kind).toBe('hermes_claw_migration');
      expect(payload.detected).toBe(true);
      expect(payload.dryRun).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('exposes `buddy hermes claw bridge status --json` through the CLI without leaking gateway tokens', async () => {
    fs.writeJsonSync(path.join(openclaw, 'gateway.json'), {
      httpUrl: 'http://127.0.0.1:4150/',
      token: 'oc_cli_status_secret_fixture',
      methods: ['node.describe'],
    });
    fs.writeJsonSync(path.join(openclaw, 'node.json'), {
      nodeId: 'openclaw-cli-node-host',
      displayName: 'CLI Node Host',
      gatewayHost: '127.0.0.1',
      gatewayPort: 18789,
      token: 'oc_cli_node_status_secret_fixture',
      capabilities: ['system.run', 'system.which'],
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
      registerHermesCommands(program);

      await program.parseAsync(['node', 'test', 'hermes', 'claw', 'bridge', 'status', '--source', openclaw, '--json']);

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const payload = JSON.parse(output);
      expect(payload.kind).toBe('openclaw_bridge_status');
      expect(payload.discovery.found).toBe(true);
      expect(payload.discovery.safety.tokenPresent).toBe(true);
      expect(payload.discovery.safety.nodeTokenPresent).toBe(true);
      expect(payload.discovery.nodeHost).toMatchObject({
        found: true,
        nodeId: 'openclaw-cli-node-host',
        displayName: 'CLI Node Host',
        capabilities: ['system.run', 'system.which'],
      });
      expect(payload.descriptor.role).toBe('codebuddy-fleet-bridge');
      expect(payload.descriptor.nodeId).toBe('openclaw-cli-node-host');
      expect(output).not.toContain('oc_cli_status_secret_fixture');
      expect(output).not.toContain('oc_cli_node_status_secret_fixture');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('exposes `buddy hermes claw bridge draft --json` through the CLI with redacted Fleet handoff output', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
      registerHermesCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'claw',
        'bridge',
        'draft',
        '--workspace-target',
        target,
        '--message-id',
        'oc-cli-msg-1',
        '--channel',
        'telegram',
        '--sender-id',
        'user-1',
        '--text',
        'Please route this. password=cli-draft-secret',
        '--json',
      ]);

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const payload = JSON.parse(output);
      expect(payload.kind).toBe('openclaw_fleet_handoff_draft');
      expect(payload.dispatchInput.dispatchProfile).toBe('safe');
      expect(payload.dispatchInput.privacyTag).toBe('sensitive');
      expect(payload.dispatchInput.goal).toContain('password=[redacted]');
      expect(output).not.toContain('cli-draft-secret');
      expect(fs.existsSync(payload.draftFile)).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('exposes `buddy hermes claw bridge send --json` as dry-run by default', async () => {
    fs.writeJsonSync(path.join(openclaw, 'gateway.json'), {
      httpUrl: 'http://127.0.0.1:4150/',
      token: 'oc_cli_send_secret_fixture',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
      registerHermesCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'claw',
        'bridge',
        'send',
        '--source',
        openclaw,
        '--workspace-target',
        target,
        '--message-id',
        'oc-cli-msg-2',
        '--channel',
        'discord',
        '--thread-id',
        'thread-2',
        '--text',
        'Dry-run reply. secret=cli-send-secret',
        '--json',
      ]);

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const payload = JSON.parse(output);
      expect(payload.kind).toBe('openclaw_response_send_result');
      expect(payload.ok).toBe(true);
      expect(payload.record.status).toBe('preview');
      expect(payload.record.safety.networkContacted).toBe(false);
      expect(payload.record.textPreview).toContain('secret=[redacted]');
      expect(output).not.toContain('cli-send-secret');
      expect(output).not.toContain('oc_cli_send_secret_fixture');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('exposes `buddy hermes claw bridge probe-ws --json` as dry-run by default', async () => {
    fs.writeJsonSync(path.join(openclaw, 'gateway.json'), {
      wsUrl: 'ws://127.0.0.1:18789',
      token: 'oc_cli_ws_secret_fixture',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
      registerHermesCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'claw',
        'bridge',
        'probe-ws',
        '--source',
        openclaw,
        '--workspace-target',
        target,
        '--json',
      ]);

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const payload = JSON.parse(output);
      expect(payload.kind).toBe('openclaw_websocket_probe_result');
      expect(payload.ok).toBe(true);
      expect(payload.record.status).toBe('preview');
      expect(payload.record.wsUrl).toBe('ws://127.0.0.1:18789/');
      expect(payload.record.safety.networkContacted).toBe(false);
      expect(payload.record.safety.tokenPresent).toBe(true);
      expect(output).not.toContain('oc_cli_ws_secret_fixture');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('exposes `buddy hermes claw bridge call-ws --json` as dry-run by default', async () => {
    fs.writeJsonSync(path.join(openclaw, 'gateway.json'), {
      wsUrl: 'ws://127.0.0.1:18789',
      token: 'oc_cli_ws_call_secret_fixture',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
      registerHermesCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'claw',
        'bridge',
        'call-ws',
        'logs.tail',
        '--source',
        openclaw,
        '--workspace-target',
        target,
        '--params',
        '{"sinceMs":60000,"secret":"cli-ws-call-param-secret"}',
        '--json',
      ]);

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const payload = JSON.parse(output);
      expect(payload.kind).toBe('openclaw_websocket_call_result');
      expect(payload.ok).toBe(true);
      expect(payload.record.status).toBe('preview');
      expect(payload.record.request.method).toBe('logs.tail');
      expect(payload.record.request.paramKeys).toEqual(['secret', 'sinceMs']);
      expect(payload.record.safety.networkContacted).toBe(false);
      expect(output).not.toContain('oc_cli_ws_call_secret_fixture');
      expect(output).not.toContain('cli-ws-call-param-secret');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('exposes `buddy hermes claw bridge nodes-pending --json` as dry-run by default', async () => {
    fs.writeJsonSync(path.join(openclaw, 'gateway.json'), {
      wsUrl: 'ws://127.0.0.1:18789',
      token: 'oc_cli_nodes_pending_secret_fixture',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
      registerHermesCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'claw',
        'bridge',
        'nodes-pending',
        '--source',
        openclaw,
        '--workspace-target',
        target,
        '--json',
      ]);

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const payload = JSON.parse(output);
      expect(payload.kind).toBe('openclaw_websocket_call_result');
      expect(payload.ok).toBe(true);
      expect(payload.record.status).toBe('preview');
      expect(payload.record.request.method).toBe('nodes.pending');
      expect(payload.record.request.paramKeys).toEqual([]);
      expect(payload.record.safety.networkContacted).toBe(false);
      expect(output).not.toContain('oc_cli_nodes_pending_secret_fixture');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('exposes `buddy hermes claw bridge node-approve --json` as dry-run by default', async () => {
    fs.writeJsonSync(path.join(openclaw, 'gateway.json'), {
      wsUrl: 'ws://127.0.0.1:18789',
      token: 'oc_cli_node_approve_secret_fixture',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
      registerHermesCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'claw',
        'bridge',
        'node-approve',
        '--source',
        openclaw,
        '--workspace-target',
        target,
        '--code',
        'CLI-PAIRING-CODE-SECRET',
        '--json',
      ]);

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const payload = JSON.parse(output);
      expect(payload.kind).toBe('openclaw_websocket_call_result');
      expect(payload.ok).toBe(true);
      expect(payload.record.status).toBe('preview');
      expect(payload.record.request.method).toBe('nodes.approve');
      expect(payload.record.request.paramKeys).toEqual(['code']);
      expect(payload.record.safety.networkContacted).toBe(false);
      expect(output).not.toContain('oc_cli_node_approve_secret_fixture');
      expect(output).not.toContain('CLI-PAIRING-CODE-SECRET');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('exposes `buddy hermes claw bridge validate-upstream --json` as dry-run by default', async () => {
    fs.writeJsonSync(path.join(openclaw, 'gateway.json'), {
      wsUrl: 'ws://127.0.0.1:18789',
      token: 'oc_cli_validate_upstream_secret_fixture',
    });
    fs.writeJsonSync(path.join(openclaw, 'node.json'), {
      nodeId: 'cli-validation-node',
      token: 'oc_cli_validate_node_secret_fixture',
    });
    const openclawBin = path.join(tmp, 'openclaw');
    fs.writeFileSync(openclawBin, '#!/usr/bin/env sh\nexit 0\n');
    fs.chmodSync(openclawBin, 0o755);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
      registerHermesCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'claw',
        'bridge',
        'validate-upstream',
        '--source',
        openclaw,
        '--workspace-target',
        target,
        '--openclaw-bin',
        openclawBin,
        '--json',
      ]);

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const payload = JSON.parse(output);
      expect(payload.kind).toBe('openclaw_upstream_validation_result');
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('preview');
      expect(payload.safety.networkContacted).toBe(false);
      expect(payload.checks).toContainEqual(expect.objectContaining({
        name: 'openclaw-cli',
        status: 'passed',
      }));
      expect(payload.checks.map((check: { name: string }) => check.name)).toContain('websocket-probe');
      expect(output).not.toContain('oc_cli_validate_upstream_secret_fixture');
      expect(output).not.toContain('oc_cli_validate_node_secret_fixture');
    } finally {
      logSpy.mockRestore();
    }
  });
});
