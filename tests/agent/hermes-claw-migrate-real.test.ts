import { Command } from 'commander';
import fs from 'fs-extra';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';

import {
  detectOpenClawHome,
  runClawMigration,
  buildClawMigrationPlan,
  mapClawCronJobs,
  mapClawStateCronJob,
  readClawStateCronJobs,
  collectClawCronJobs,
  clawMcpServers,
  mapClawCommandAllowlist,
  mapClawMemoryBackend,
  mapClawExecTimeout,
  mapClawVisionSettings,
} from '../../src/agent/hermes-claw-migrate.js';
import { registerHermesCommands } from '../../src/commands/cli/hermes-commands.js';
import {
  listOpenClawPendingNodes,
  probeOpenClawGatewayWebSocket,
} from '../../src/openclaw/gateway-bridge.js';
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
    cron: [{ schedule: '0 9 * * *', task: 'daily', label: 'morning-report' }],
    commandAllowlist: ['git', 'npm', 'docker', 'ls'],
    memoryBackend: 'honcho',
    execTimeout: 120,
    vision: { enabled: true, model: 'gpt-4-vision-preview' },
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
  const commandDir = path.join(home, 'commands');
  fs.ensureDirSync(commandDir);
  fs.writeFileSync(
    path.join(commandDir, 'review.md'),
    [
      '---',
      'description: Review migrated code',
      '---',
      '',
      'Review the current branch for regressions.',
      '',
    ].join('\n'),
  );
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
    expect(report.entries.some((e) => e.category === 'commands' && e.action === 'import')).toBe(true);

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

    // Custom slash commands copied to the real project command loader path.
    const commandFile = path.join(target, '.codebuddy', 'commands', 'review.md');
    expect(fs.readFileSync(commandFile, 'utf-8')).toContain('Review migrated code');

    // Archive-for-review categories written, not applied to live config.
    const archiveDir = path.join(target, '.codebuddy', 'openclaw-migration', 'archive');
    expect(fs.existsSync(path.join(archiveDir, 'custom_providers.json'))).toBe(true);

    // Promoted categories are imported into settings.json, NOT archived.
    expect(fs.existsSync(path.join(archiveDir, 'cron.json'))).toBe(false);
    expect(fs.existsSync(path.join(archiveDir, 'command_allowlist.json'))).toBe(false);
    expect(fs.existsSync(path.join(archiveDir, 'memory_backend.json'))).toBe(false);
    expect(fs.existsSync(path.join(archiveDir, 'exec_timeout.json'))).toBe(false);
    expect(fs.existsSync(path.join(archiveDir, 'vision.json'))).toBe(false);

    // Promoted categories are written to live settings.
    expect(settings.cronJobs).toBeDefined();
    expect(settings.cronJobs).toHaveLength(1);
    expect(settings.cronJobs[0].name).toBe('morning-report');
    expect(settings.cronJobs[0].schedule).toEqual({ cron: '0 9 * * *' });
    expect(settings.commandAllowlist).toEqual(['git', 'npm', 'docker', 'ls']);
    expect(settings.memoryProvider).toBe('honcho');
    expect(settings.execTimeout).toBe(120000); // 120s → 120000ms
    expect(settings.visionEnabled).toBe(true);
    expect(settings.visionModel).toBe('gpt-4-vision-preview');

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

  it('reads the OpenClaw 2026.6.x nested layout (agents.defaults.model.primary + models.providers)', async () => {
    // OpenClaw 2026.6.x redesigned the on-disk layout: the default model moved to
    // `agents.defaults.model.primary` and custom providers to `models.providers`,
    // while the legacy flat `clawdbot.json` (covered above) used root
    // `model`/`providers`. The migrator must read both shapes.
    const home = path.join(tmp, '.openclaw-2026');
    fs.ensureDirSync(home);
    fs.writeJsonSync(path.join(home, 'openclaw.json'), {
      agents: { defaults: { workspace: '/w', model: { primary: 'ollama/qwen2.5:7b-instruct' } } },
      models: {
        mode: 'merge',
        providers: { ollama: { baseUrl: 'http://127.0.0.1:11434', api: 'openai', apiKey: SECRET_VALUE, models: ['qwen2.5'] } },
      },
      tools: { profile: 'default' },
    });

    const report = await runClawMigration({ source: home, workspaceTarget: target, skillsHub: hub, apply: true });
    expect(report.detected).toBe(true);
    const action = new Map(report.entries.map((e) => [e.category, e.action]));

    // model imported from the nested `agents.defaults.model.primary` (was skipped
    // before the 2026.6.x reader), copied verbatim — Code Buddy resolves the
    // `ollama/` provider prefix.
    expect(action.get('model')).toBe('import');
    const settings = fs.readJsonSync(path.join(target, '.codebuddy', 'settings.json'));
    expect(settings.model).toBe('ollama/qwen2.5:7b-instruct');

    // custom_providers detected from `models.providers` (was reported "Not
    // present in source") and archived — never imported into live settings.
    expect(action.get('custom_providers')).toBe('archive');
    const provFile = path.join(target, '.codebuddy', 'openclaw-migration', 'archive', 'custom_providers.json');
    expect(fs.existsSync(provFile)).toBe(true);
    expect(fs.readFileSync(provFile, 'utf-8')).toContain('ollama'); // the nested slice
    expect(settings.models).toBeUndefined(); // provider catalog never leaks into live settings

    // The provider block carries an apiKey -> archive is 0600 and the raw value
    // never surfaces in the report object.
    expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);
    if (process.platform !== 'win32') {
      expect(fs.statSync(provFile).mode & 0o777).toBe(0o600);
    }
  });

  it('imports the REAL 2026.6.x live-install shape: workspace identity files, symlinked plugin-skill, nested secrets archived 0600', async () => {
    // This mirrors a *populated* `~/.openclaw` (verified against the real install
    // on 2026-06-13): identity markdown lives under the configured workspace dir
    // (NOT the home root, as legacy clawdbot did), skills are *symlinks* under
    // `plugin-skills/`, and the gateway token + provider apiKey are nested.
    const home = path.join(tmp, '.openclaw-live');
    const workspace = path.join(home, 'workspace');
    fs.ensureDirSync(workspace);

    // Identity files in the workspace dir (the 2026.6.x location). IDENTITY.md /
    // BOOTSTRAP.md exist on the real install but have no Code Buddy consumer, so
    // they are intentionally NOT migrated — only SOUL/USER/AGENTS are.
    fs.writeFileSync(path.join(workspace, 'SOUL.md'), '# Soul\nLive-install workspace persona.\n');
    fs.writeFileSync(path.join(workspace, 'USER.md'), '# User\nName: LiveUser\n');
    fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# Agents\nLive workspace agent doc\n');
    fs.writeFileSync(path.join(workspace, 'IDENTITY.md'), 'id doc with no consumer\n');
    fs.writeFileSync(path.join(workspace, 'BOOTSTRAP.md'), 'bootstrap doc with no consumer\n');
    // MEMORY.md at the workspace root — the OpenClaw long-term memory convention
    // (documented in its own AGENTS.md), present on the populated live install
    // since 2026-07-03.
    fs.writeFileSync(path.join(workspace, 'MEMORY.md'), '- Live-install remembered fact\n');

    // A symlinked plugin-skill, exactly like `plugin-skills/browser-automation`
    // -> the installed openclaw npm package. The Dirent reports isDirectory()
    // === false for the link, so the reader must follow it via statSync.
    const realSkillDir = path.join(tmp, 'npm-pkg', 'skills', 'browser-automation');
    fs.ensureDirSync(realSkillDir);
    fs.writeFileSync(path.join(realSkillDir, 'SKILL.md'), skillContent('browser-automation'));
    const pluginSkillsDir = path.join(home, 'plugin-skills');
    fs.ensureDirSync(pluginSkillsDir);
    const skillsSupported = process.platform !== 'win32';
    if (skillsSupported) {
      fs.symlinkSync(realSkillDir, path.join(pluginSkillsDir, 'browser-automation'), 'dir');
    }

    const GATEWAY_TOKEN = 'live-gateway-token-placeholder';
    const PROVIDER_KEY = 'live-provider-apikey-placeholder';
    fs.writeJsonSync(path.join(home, 'openclaw.json'), {
      agents: { defaults: { workspace, model: { primary: 'ollama/gemma4:12b' } } },
      models: {
        mode: 'merge',
        providers: { ollama: { baseUrl: 'http://127.0.0.1:11434', api: 'openai', apiKey: PROVIDER_KEY, models: ['gemma4'] } },
      },
      // gateway carries a nested auth token -> must archive 0600 (the live install
      // does exactly this; gateway was previously archived at default perms).
      gateway: { mode: 'local', bind: '127.0.0.1', port: 18789, auth: { mode: 'token', token: GATEWAY_TOKEN } },
      plugins: { entries: { ollama: { enabled: true } } },
      session: { dmScope: 'per-conversation' },
      tools: { profile: 'coder' },
      // 2026.6.x nests MCP servers under `mcp.servers.<name>` (verified live:
      // `openclaw mcp set filesystem '{...}'` writes exactly this path). The
      // pre-fix reader matched the bare `mcp` key and imported ONE bogus server
      // named "servers".
      mcp: { servers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] } } },
    });

    const report = await runClawMigration({ source: home, workspaceTarget: target, skillsHub: hub, apply: true });
    expect(report.detected).toBe(true);
    expect(report.summary.failedCount).toBe(0);
    const action = new Map(report.entries.map((e) => [e.category, e.action]));

    // Identity files resolved from the WORKSPACE dir (were skipped before the fix).
    expect(action.get('persona')).toBe('import');
    expect(action.get('user')).toBe('import');
    expect(action.get('agents')).toBe('import');
    expect(fs.readFileSync(path.join(target, 'SOUL.md'), 'utf-8')).toContain('Live-install workspace persona');
    expect(fs.readFileSync(path.join(target, 'USER.md'), 'utf-8')).toContain('LiveUser');
    expect(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf-8')).toContain('Live workspace agent doc');

    // IDENTITY.md / BOOTSTRAP.md have no consumer -> never copied.
    expect(fs.existsSync(path.join(target, 'IDENTITY.md'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'BOOTSTRAP.md'))).toBe(false);

    // MEMORY.md resolved from the WORKSPACE dir and appended to the project
    // memory file (exercised against the populated live install, 2026-07-03).
    expect(action.get('memory')).toBe('import');
    const migratedMemory = fs.readFileSync(path.join(target, '.codebuddy', 'CODEBUDDY_MEMORY.md'), 'utf-8');
    expect(migratedMemory).toContain('Migrated from OpenClaw');
    expect(migratedMemory).toContain('Live-install remembered fact');

    // MCP servers read from the 2026.6.x nested `mcp.servers` map — the real
    // server name imports; the wrapper is never mistaken for a server.
    expect(action.get('mcp_servers')).toBe('import');

    // The symlinked plugin-skill is discovered (Dirent.isDirectory() is false for
    // the link; the reader follows it via statSync) and installed.
    if (skillsSupported) {
      expect(report.entries.some((e) => e.category === 'skills' && e.action === 'import')).toBe(true);
      expect(hub.list().map((s) => s.name)).toContain('browser-automation');
    }

    // Nested gateway/provider blocks archived (never imported into live settings).
    expect(action.get('gateway')).toBe('archive');
    expect(action.get('custom_providers')).toBe('archive');
    const settings = fs.readJsonSync(path.join(target, '.codebuddy', 'settings.json'));
    expect(settings.model).toBe('ollama/gemma4:12b');
    expect(settings.gateway).toBeUndefined();
    expect(settings.models).toBeUndefined();
    // The nested `mcp.servers` map lands on the real consumer key with the real
    // server name — the pre-fix reader wrote `mcpServers.servers` instead.
    expect(settings.mcpServers.filesystem).toEqual({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] });
    expect(settings.mcpServers.servers).toBeUndefined();

    // SECURITY: the gateway archive carries a nested token, so it MUST be 0600
    // (this file was written at default 0644 before `gateway` joined the
    // sensitive set). custom_providers was already 0600; assert both.
    const archiveDir = path.join(target, '.codebuddy', 'openclaw-migration', 'archive');
    const gatewayFile = path.join(archiveDir, 'gateway.json');
    const provFile = path.join(archiveDir, 'custom_providers.json');
    expect(fs.existsSync(gatewayFile)).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(gatewayFile).mode & 0o777).toBe(0o600);
      expect(fs.statSync(provFile).mode & 0o777).toBe(0o600);
    }

    // The secrets category surfaces the nested credential NAMES (never values).
    const secrets = report.entries.find((e) => e.category === 'secrets');
    expect(secrets?.detail).toContain('gateway.auth.token');
    expect(secrets?.detail).toContain('models.providers.ollama.apiKey');

    // No placeholder secret value leaks anywhere into the report object.
    expect(JSON.stringify(report)).not.toContain(GATEWAY_TOKEN);
    expect(JSON.stringify(report)).not.toContain(PROVIDER_KEY);
  });

  it('still reads root-level identity files for legacy clawdbot installs (no workspace dir)', async () => {
    // The legacy clawdbot.json fixture (writeOpenClawFixture) keeps SOUL/USER/
    // AGENTS at the home root with no `agents.defaults.workspace`. The
    // workspace-aware reader must not regress that path.
    const report = await runClawMigration({ source: openclaw, workspaceTarget: target, skillsHub: hub, apply: false });
    const action = new Map(report.entries.map((e) => [e.category, e.action]));
    expect(action.get('persona')).toBe('import');
    expect(action.get('user')).toBe('import');
    expect(action.get('agents')).toBe('import');
    // Exactly one entry per identity category (workspace+root dedup).
    expect(report.entries.filter((e) => e.category === 'persona')).toHaveLength(1);
  });

  it('covers the expanded category set (30+) and never leaks secrets in expanded slices', async () => {
    const report = await runClawMigration({ source: openclaw, workspaceTarget: target, skillsHub: hub, apply: true });

    // The report enumerates the full category surface (import + archive + secrets).
    const categories = new Set(report.entries.map((e) => e.category));
    for (const expected of [
      'toolsets', 'profiles', 'bundles', 'pairing', 'vision', 'image_video',
      'runtimes', 'portal', 'learning_loop', 'kanban', 'webhooks', 'hooks', 'commands',
    ]) {
      expect(categories.has(expected)).toBe(true);
    }
    // 30+ distinct categories recognized (parity target).
    expect(categories.size).toBeGreaterThanOrEqual(30);

    // Present expanded categories are archived; absent ones are skipped.
    const action = new Map(report.entries.map((e) => [e.category, e.action]));
    expect(action.get('toolsets')).toBe('archive');
    expect(action.get('webhooks')).toBe('archive');

    // Promoted categories present in fixture are imported, not archived.
    expect(action.get('cron')).toBe('import');
    expect(action.get('command_allowlist')).toBe('import');
    expect(action.get('memory_backend')).toBe('import');
    expect(action.get('exec_timeout')).toBe('import');
    expect(action.get('vision')).toBe('import');

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

  it('does not overwrite existing custom slash commands without --overwrite', async () => {
    const commandsDir = path.join(target, '.codebuddy', 'commands');
    fs.ensureDirSync(commandsDir);
    const existing = path.join(commandsDir, 'review.md');
    fs.writeFileSync(existing, 'existing command body\n');

    const report = await runClawMigration({ source: openclaw, workspaceTarget: target, skillsHub: hub, apply: true, backup: false });
    const command = report.entries.find((e) => e.category === 'commands' && e.label === 'command:/review');
    expect(command?.action).toBe('conflict');
    expect(fs.readFileSync(existing, 'utf-8')).toBe('existing command body\n');

    await runClawMigration({
      source: openclaw,
      workspaceTarget: target,
      skillsHub: hub,
      apply: true,
      backup: false,
      overwrite: true,
    });
    expect(fs.readFileSync(existing, 'utf-8')).toContain('Review migrated code');
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

  // -----------------------------------------------------------------------
  // Promoted category mapper unit tests
  // -----------------------------------------------------------------------

  describe('mapClawCronJobs', () => {
    it('maps a standard cron array with label', () => {
      const jobs = mapClawCronJobs({ cron: [{ schedule: '*/5 * * * *', task: 'health-check', label: 'health' }] });
      expect(jobs).toEqual([{ name: 'health', schedule: '*/5 * * * *', task: 'health-check', enabled: true }]);
    });

    it('falls through to cronJobs key', () => {
      const jobs = mapClawCronJobs({ cronJobs: [{ schedule: '0 0 * * *', task: 'nightly' }] });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toMatch(/^claw-cron-/);
    });

    it('rejects entries without valid 5-field schedule', () => {
      const jobs = mapClawCronJobs({ cron: [{ schedule: 'every 5 minutes', task: 'bad' }] });
      expect(jobs).toEqual([]);
    });

    it('returns empty for missing key', () => {
      expect(mapClawCronJobs({})).toEqual([]);
    });
  });

  describe('mapClawStateCronJob (2026.6.x job_json shape)', () => {
    // Sanitized copy of a REAL `job_json` row from a live 2026.6.1 gateway
    // state DB (state/openclaw.sqlite:cron_jobs, read 2026-07-03).
    const realJob = {
      id: '2100729c-5843-47f9-a471-02d457240625',
      name: 'parity-probe',
      enabled: false,
      createdAtMs: 1783058723196,
      schedule: { kind: 'cron', expr: '0 9 * * 1' },
      sessionTarget: 'isolated',
      wakeMode: 'now',
      payload: { kind: 'agentTurn', message: 'Weekly parity probe' },
      delivery: { mode: 'announce', channel: 'last' },
      state: {},
    };

    it('maps the real live-install shape, preserving the disabled flag', () => {
      expect(mapClawStateCronJob(realJob)).toEqual({
        name: 'parity-probe',
        schedule: '0 9 * * 1',
        task: 'Weekly parity probe',
        enabled: false,
      });
    });

    it('drops non-cron schedule kinds (at/every one-shots)', () => {
      expect(mapClawStateCronJob({ ...realJob, schedule: { kind: 'at', at: '2026-07-04T09:00:00+02:00' } })).toBeNull();
      expect(mapClawStateCronJob({ ...realJob, schedule: { kind: 'every', everyMs: 600000 } })).toBeNull();
    });

    it('drops 6-field (seconds) expressions — Code Buddy cron is 5-field', () => {
      expect(mapClawStateCronJob({ ...realJob, schedule: { kind: 'cron', expr: '0 0 9 * * 1' } })).toBeNull();
    });

    it('drops systemEvent payloads (no direct Code Buddy consumer)', () => {
      expect(mapClawStateCronJob({ ...realJob, payload: { kind: 'systemEvent', text: 'heartbeat' } })).toBeNull();
    });

    it('falls back to an id-derived name', () => {
      const mapped = mapClawStateCronJob({ ...realJob, name: undefined });
      expect(mapped?.name).toBe('claw-cron-2100729c');
    });
  });

  describe('clawMcpServers (layout generations)', () => {
    it('reads the 2026.6.x nested mcp.servers map', () => {
      const found = clawMcpServers({ mcp: { servers: { filesystem: { command: 'npx' } } } });
      expect(found?.source).toBe('config:mcp.servers');
      expect(Object.keys(found?.servers ?? {})).toEqual(['filesystem']);
    });

    it('never mistakes the 2026.6.x wrapper for a server map (the pre-fix bug)', () => {
      // An empty `mcp.servers` means NO servers — the wrapper itself must not
      // be imported as one server named "servers".
      expect(clawMcpServers({ mcp: { servers: {} } })).toBeUndefined();
    });

    it('still reads legacy flat root keys', () => {
      const found = clawMcpServers({ mcpServers: { files: { command: 'mcp-files' } } });
      expect(found?.source).toBe('config:mcpServers');
      expect(Object.keys(found?.servers ?? {})).toEqual(['files']);
    });

    it('accepts a bare legacy `mcp` record only when it is not the wrapper', () => {
      const found = clawMcpServers({ mcp: { files: { command: 'mcp-files' } } });
      expect(found?.source).toBe('config:mcp');
      expect(Object.keys(found?.servers ?? {})).toEqual(['files']);
    });
  });

  describe('readClawStateCronJobs (gateway state DB)', () => {
    const sqliteAvailable = (() => {
      try {
        createRequire(import.meta.url)('better-sqlite3');
        return true;
      } catch {
        return false;
      }
    })();

    function writeStateDb(home: string, jobJsons: string[]): void {
      const Database = createRequire(import.meta.url)('better-sqlite3') as new (file: string) => {
        exec(sql: string): void;
        prepare(sql: string): { run(...args: unknown[]): unknown };
        close(): void;
      };
      const stateDir = path.join(home, 'state');
      fs.ensureDirSync(stateDir);
      const db = new Database(path.join(stateDir, 'openclaw.sqlite'));
      try {
        // Column subset of the real 2026.6.1 `cron_jobs` DDL — the reader only
        // selects `job_json`.
        db.exec('CREATE TABLE cron_jobs (store_key TEXT, job_id TEXT, name TEXT, enabled INTEGER, job_json TEXT)');
        const insert = db.prepare('INSERT INTO cron_jobs (store_key, job_id, name, enabled, job_json) VALUES (?, ?, ?, ?, ?)');
        for (const [i, jobJson] of jobJsons.entries()) {
          insert.run('/home/user/.openclaw/cron/jobs.json', `job-${i}`, `job-${i}`, 1, jobJson);
        }
      } finally {
        db.close();
      }
    }

    it('returns null when no state DB exists (distinguishable from zero jobs)', () => {
      expect(readClawStateCronJobs(path.join(tmp, 'no-such-home'))).toBeNull();
    });

    it.skipIf(!sqliteAvailable)('reads and maps real-shape cron jobs from state/openclaw.sqlite', () => {
      const home = path.join(tmp, '.openclaw-state');
      writeStateDb(home, [
        JSON.stringify({
          id: 'aaaa1111', name: 'weekly-report', enabled: true,
          schedule: { kind: 'cron', expr: '0 9 * * 1' },
          payload: { kind: 'agentTurn', message: 'Send the weekly report' },
        }),
        JSON.stringify({
          id: 'bbbb2222', name: 'one-shot', enabled: true,
          schedule: { kind: 'at', at: '2026-07-04T09:00:00+02:00' },
          payload: { kind: 'agentTurn', message: 'One shot' },
        }),
        '{not json', // one malformed row never poisons the rest
      ]);
      const jobs = readClawStateCronJobs(home);
      expect(jobs).toEqual([
        { name: 'weekly-report', schedule: '0 9 * * 1', task: 'Send the weekly report', enabled: true },
      ]);
    });

    it.skipIf(!sqliteAvailable)('collectClawCronJobs prefers legacy config arrays, then falls back to the state DB', () => {
      const home = path.join(tmp, '.openclaw-collect');
      writeStateDb(home, [
        JSON.stringify({
          id: 'cccc3333', name: 'from-state', enabled: false,
          schedule: { kind: 'cron', expr: '30 8 * * *' },
          payload: { kind: 'agentTurn', message: 'From the state DB' },
        }),
      ]);
      // Legacy config array present -> it wins (first storage generation).
      const fromConfig = collectClawCronJobs(home, { cron: [{ schedule: '0 9 * * *', task: 'daily', label: 'morning' }] });
      expect(fromConfig.source).toBe('config:cronJobs');
      expect(fromConfig.jobs.map((j) => j.name)).toEqual(['morning']);
      // No config array -> the 2026.6.x state DB is read, disabled flag intact.
      const fromState = collectClawCronJobs(home, {});
      expect(fromState.source).toBe('state:openclaw.sqlite#cron_jobs');
      expect(fromState.jobs).toEqual([
        { name: 'from-state', schedule: '30 8 * * *', task: 'From the state DB', enabled: false },
      ]);
    });
  });

  describe('mapClawCommandAllowlist', () => {
    it('maps a flat string array', () => {
      expect(mapClawCommandAllowlist({ commandAllowlist: ['git', 'npm', 'docker'] }))
        .toEqual(['git', 'npm', 'docker']);
    });

    it('filters out absolute paths and secret-looking items', () => {
      const result = mapClawCommandAllowlist({
        commandAllowlist: ['git', '/usr/bin/evil', 'my-secret-key', 'npm'],
      });
      expect(result).toEqual(['git', 'npm']);
    });

    it('returns empty for non-array', () => {
      expect(mapClawCommandAllowlist({ commandAllowlist: 'git' })).toEqual([]);
    });
  });

  describe('mapClawMemoryBackend', () => {
    it('maps a known string provider', () => {
      expect(mapClawMemoryBackend({ memoryBackend: 'honcho' })).toBe('honcho');
      expect(mapClawMemoryBackend({ memoryBackend: 'Mem0' })).toBe('mem0');
    });

    it('maps an object with provider key', () => {
      expect(mapClawMemoryBackend({ memoryBackend: { provider: 'redis', url: 'redis://localhost' } }))
        .toBe('redis');
    });

    it('rejects unknown providers', () => {
      expect(mapClawMemoryBackend({ memoryBackend: 'custom-unknown' })).toBeUndefined();
    });

    it('returns undefined for missing key', () => {
      expect(mapClawMemoryBackend({})).toBeUndefined();
    });
  });

  describe('mapClawExecTimeout', () => {
    it('converts seconds to milliseconds', () => {
      expect(mapClawExecTimeout({ execTimeout: 30 })).toBe(30000);
      expect(mapClawExecTimeout({ execTimeout: 3600 })).toBe(3600000);
    });

    it('passes through large ms values', () => {
      expect(mapClawExecTimeout({ execTimeout: 60000 })).toBe(60000);
    });

    it('clamps to 1 hour max', () => {
      expect(mapClawExecTimeout({ execTimeout: 99999999 })).toBe(3600000);
    });

    it('ignores non-positive values', () => {
      expect(mapClawExecTimeout({ execTimeout: 0 })).toBeUndefined();
      expect(mapClawExecTimeout({ execTimeout: -5 })).toBeUndefined();
    });
  });

  describe('mapClawVisionSettings', () => {
    it('maps enabled and model', () => {
      const result = mapClawVisionSettings({ vision: { enabled: true, model: 'gpt-4o' } });
      expect(result).toEqual({ visionEnabled: true, visionModel: 'gpt-4o' });
    });

    it('skips model that looks like a URL', () => {
      const result = mapClawVisionSettings({ vision: { enabled: true, model: 'https://example.com/model' } });
      expect(result).toEqual({ visionEnabled: true });
    });

    it('returns empty for missing key', () => {
      expect(mapClawVisionSettings({})).toEqual({});
    });

    it('returns empty for non-object value', () => {
      expect(mapClawVisionSettings({ vision: 'true' })).toEqual({});
    });
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
      expect(payload.record.request.method).toBe('node.pair.list');
      expect(payload.record.request.paramKeys).toEqual([]);
      expect(payload.record.safety.networkContacted).toBe(false);
      expect(output).not.toContain('oc_cli_nodes_pending_secret_fixture');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('probes the real OpenClaw protocol:4 WebSocket connect RPC shape against a local fixture', async () => {
    const received: Array<Record<string, unknown>> = [];
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');
    fs.writeJsonSync(path.join(openclaw, 'gateway.json'), {
      wsUrl: `ws://127.0.0.1:${address.port}`,
      token: 'oc_ws_live_probe_secret',
      methods: ['status'],
    });
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'nonce-probe-fixture', ts: Date.now() },
      }));
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>;
        received.push(frame);
        if (received.length === 1) {
          expect(frame).toMatchObject({
            type: 'req',
            method: 'connect',
          });
          expect(frame).not.toHaveProperty('client');
          expect(frame.params).toMatchObject({
            minProtocol: 4,
            maxProtocol: 4,
            auth: { token: 'oc_ws_live_probe_secret' },
            client: {
              id: 'cli',
              displayName: 'Code Buddy OpenClaw Bridge',
              mode: 'cli',
            },
            role: 'operator',
            scopes: ['operator.read', 'operator.write'],
          });
          socket.send(JSON.stringify({
            type: 'res',
            id: frame.id,
            ok: true,
            payload: {
              gateway: { id: 'openclaw-fixture' },
              features: { methods: ['status', 'node.pair.list'] },
              uptimeMs: 1234,
            },
          }));
        } else {
          expect(frame).toMatchObject({
            type: 'req',
            method: 'status',
          });
          socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { status: 'ok' } }));
        }
      });
    });

    try {
      const result = await probeOpenClawGatewayWebSocket({
        approvedBy: 'Patrice',
        dryRun: false,
        liveProbeConfirmed: true,
        timeoutMs: 2_000,
      }, {
        home: openclaw,
        cwd: target,
        createId: () => 'probe-fixture',
      });

      expect(result.ok).toBe(true);
      expect(result.record.request.connectFrameType).toBe('req/connect');
      expect(result.record.status).toBe('connected');
      expect(result.record.response).toMatchObject({
        gatewayId: 'openclaw-fixture',
        methodCount: 2,
        statusResponseOk: true,
      });
      expect(JSON.stringify(result)).not.toContain('oc_ws_live_probe_secret');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('calls node.pair.list after a protocol:4 connect RPC and stores only a safe summary', async () => {
    const received: Array<Record<string, unknown>> = [];
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');
    fs.writeJsonSync(path.join(openclaw, 'gateway.json'), {
      wsUrl: `ws://127.0.0.1:${address.port}`,
      token: 'oc_ws_nodes_pending_secret',
      methods: ['node.pair.list'],
    });
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'nonce-nodes-fixture', ts: Date.now() },
      }));
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>;
        received.push(frame);
        if (received.length === 1) {
          expect(frame).toMatchObject({
            type: 'req',
            method: 'connect',
          });
          socket.send(JSON.stringify({
            type: 'res',
            id: frame.id,
            ok: true,
            payload: {
              gateway: { id: 'openclaw-fixture' },
              features: { methods: ['node.pair.list'] },
            },
          }));
        } else {
          expect(frame).toMatchObject({
            type: 'req',
            method: 'node.pair.list',
            params: {},
          });
          socket.send(JSON.stringify({
            type: 'res',
            id: frame.id,
            ok: true,
            payload: {
              nodes: [
                { nodeId: 'pending-1', displayName: 'Phone', code: 'PAIR-CODE-SECRET' },
              ],
            },
          }));
        }
      });
    });

    try {
      const result = await listOpenClawPendingNodes({
        approvedBy: 'Patrice',
        dryRun: false,
        liveCallConfirmed: true,
        timeoutMs: 2_000,
      }, {
        home: openclaw,
        cwd: target,
        createId: () => 'nodes-pending-fixture',
      });

      expect(result.ok).toBe(true);
      expect(result.record.status).toBe('called');
      expect(result.record.response).toMatchObject({
        helloOk: true,
        rpcOk: true,
        summary: {
          pendingCount: 1,
          nodes: [{ nodeId: 'pending-1', displayName: 'Phone', pairingCodePresent: true }],
        },
      });
      expect(JSON.stringify(result)).not.toContain('oc_ws_nodes_pending_secret');
      expect(JSON.stringify(result)).not.toContain('PAIR-CODE-SECRET');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
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
      expect(payload.record.request.method).toBe('node.pair.approve');
      expect(payload.record.request.paramKeys).toEqual(['code']);
      expect(payload.record.safety.networkContacted).toBe(false);
      expect(output).not.toContain('oc_cli_node_approve_secret_fixture');
      expect(output).not.toContain('CLI-PAIRING-CODE-SECRET');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('exposes `buddy hermes claw bridge node-reject --json` as dry-run by default', async () => {
    fs.writeJsonSync(path.join(openclaw, 'gateway.json'), {
      wsUrl: 'ws://127.0.0.1:18789',
      token: 'oc_cli_node_reject_secret_fixture',
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
        'node-reject',
        '--source',
        openclaw,
        '--workspace-target',
        target,
        '--code',
        'CLI-REJECT-CODE-SECRET',
        '--reason',
        'Reject reason secret',
        '--json',
      ]);

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const payload = JSON.parse(output);
      expect(payload.kind).toBe('openclaw_websocket_call_result');
      expect(payload.ok).toBe(true);
      expect(payload.record.status).toBe('preview');
      expect(payload.record.request.method).toBe('node.pair.reject');
      expect(payload.record.request.paramKeys).toEqual(['code', 'reason']);
      expect(payload.record.safety.networkContacted).toBe(false);
      expect(output).not.toContain('oc_cli_node_reject_secret_fixture');
      expect(output).not.toContain('CLI-REJECT-CODE-SECRET');
      expect(output).not.toContain('Reject reason secret');
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
    fs.writeFileSync(
      openclawBin,
      '#!/usr/bin/env sh\nprintf \'{"status":"running","running":true,"healthy":true,"version":"cli-fixture","token":"cli-status-secret"}\\n\'\n',
    );
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
      expect(payload.checks).toContainEqual(expect.objectContaining({
        name: 'openclaw-cli-status',
        status: 'preview',
      }));
      expect(payload.checks.map((check: { name: string }) => check.name)).toContain('websocket-probe');
      expect(output).not.toContain('oc_cli_validate_upstream_secret_fixture');
      expect(output).not.toContain('oc_cli_validate_node_secret_fixture');
      expect(output).not.toContain('cli-status-secret');
    } finally {
      logSpy.mockRestore();
    }
  });
});
