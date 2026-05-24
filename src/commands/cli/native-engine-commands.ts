/**
 * Enterprise-grade CLI commands
 *
 * Registers heartbeat, hub (skills marketplace), identity, companion, groups,
 * and auth-profile subcommands on the given program.
 */

import type { Command } from 'commander';

// ============================================================================
// Heartbeat commands
// ============================================================================

export function registerHeartbeatCommands(program: Command): void {
  const heartbeat = program
    .command('heartbeat')
    .description('Manage the heartbeat engine (periodic agent wake)');

  heartbeat
    .command('start')
    .description('Start the heartbeat engine')
    .option('--interval <ms>', 'interval in milliseconds', '1800000')
    .action(async (opts: { interval: string }) => {
      const { getHeartbeatEngine } = await import('../../daemon/heartbeat.js');
      const engine = getHeartbeatEngine({ intervalMs: parseInt(opts.interval) });
      engine.start();
      console.log(`Heartbeat started (interval: ${parseInt(opts.interval) / 1000}s)`);
    });

  heartbeat
    .command('stop')
    .description('Stop the heartbeat engine')
    .action(async () => {
      const { getHeartbeatEngine } = await import('../../daemon/heartbeat.js');
      const engine = getHeartbeatEngine();
      engine.stop();
      console.log('Heartbeat stopped');
    });

  heartbeat
    .command('status')
    .description('Show heartbeat status')
    .action(async () => {
      const { getHeartbeatEngine } = await import('../../daemon/heartbeat.js');
      const engine = getHeartbeatEngine();
      const status = engine.getStatus();
      console.log(`\nHeartbeat Engine`);
      console.log(`  Running: ${status.running ? 'YES' : 'NO'}`);
      console.log(`  Enabled: ${status.enabled ? 'YES' : 'NO'}`);
      console.log(`  Total ticks: ${status.totalTicks}`);
      console.log(`  Suppressions: ${status.totalSuppressions} (consecutive: ${status.consecutiveSuppressions})`);
      if (status.lastRunTime) {
        console.log(`  Last run: ${status.lastRunTime.toISOString()}`);
      }
      if (status.nextRunTime) {
        console.log(`  Next run: ${status.nextRunTime.toISOString()}`);
      }
      if (status.lastResult) {
        console.log(`  Last result: ${status.lastResult.slice(0, 200)}`);
      }
      console.log('');
    });

  heartbeat
    .command('tick')
    .description('Manually trigger a single heartbeat tick')
    .action(async () => {
      const { getHeartbeatEngine } = await import('../../daemon/heartbeat.js');
      const engine = getHeartbeatEngine();
      console.log('Running heartbeat tick...');
      const result = await engine.tick();
      if (result.skipped) {
        console.log(`Skipped: ${result.skipReason}`);
      } else if (result.suppressed) {
        console.log('Suppressed (HEARTBEAT_OK)');
      } else {
        console.log(`Result:\n${result.agentResponse ?? 'No response'}`);
      }
    });
}

// ============================================================================
// Hub (Skills Marketplace) commands
// ============================================================================

export function registerHubCommands(program: Command): void {
  const hub = program
    .command('hub')
    .description('Skills marketplace (search, install, publish)');

  hub
    .command('search <query>')
    .description('Search for skills')
    .option('-t, --tags <tags>', 'filter by tags (comma-separated)')
    .option('-l, --limit <n>', 'max results', '20')
    .action(async (query: string, opts: { tags?: string; limit: string }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const result = await skillsHub.search(query, {
        tags: opts.tags?.split(','),
        limit: parseInt(opts.limit),
      });
      if (result.skills.length === 0) {
        console.log('No skills found.');
        return;
      }
      console.log(`\nFound ${result.total} skill(s):\n`);
      for (const skill of result.skills) {
        console.log(`  ${skill.name} v${skill.version}`);
        console.log(`    ${skill.description}`);
        if (skill.tags.length > 0) {
          console.log(`    Tags: ${skill.tags.join(', ')}`);
        }
        console.log('');
      }
    });

  hub
    .command('install <name>')
    .description('Install a skill from the hub')
    .option('-v, --version <version>', 'specific version')
    .action(async (name: string, opts: { version?: string }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      try {
        const installed = await skillsHub.install(name, opts.version);
        console.log(`Installed ${installed.name} v${installed.version}`);
      } catch (error) {
        console.error(`Failed to install: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  hub
    .command('uninstall <name>')
    .description('Uninstall a skill')
    .action(async (name: string) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const removed = await skillsHub.uninstall(name);
      if (removed) {
        console.log(`Uninstalled ${name}`);
      } else {
        console.log(`Skill not found: ${name}`);
      }
    });

  hub
    .command('update [name]')
    .description('Update installed skills (or a specific skill)')
    .action(async (name?: string) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const updated = await skillsHub.update(name);
      if (updated.length === 0) {
        console.log('All skills are up to date.');
      } else {
        console.log(`Updated ${updated.length} skill(s):`);
        for (const s of updated) {
          console.log(`  ${s.name} -> v${s.version}`);
        }
      }
    });

  hub
    .command('list')
    .description('List installed skills')
    .action(async () => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const installed = skillsHub.list();
      if (installed.length === 0) {
        console.log('No skills installed from the hub.');
        return;
      }
      console.log(`\nInstalled skills (${installed.length}):\n`);
      for (const s of installed) {
        console.log(`  ${s.name} v${s.version} (${new Date(s.installedAt).toLocaleDateString()})`);
      }
      console.log('');
    });

  hub
    .command('usage')
    .description('Show local skill usage telemetry')
    .action(async () => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const used = skillsHub.usageSummary();
      if (used.length === 0) {
        console.log('No skill usage recorded yet.');
        return;
      }

      console.log(`\nSkill usage (${used.length}):\n`);
      for (const s of used) {
        const usage = s.usage;
        if (!usage) continue;
        console.log(`  ${s.name} v${s.version}`);
        console.log(
          `    ${usage.invocationCount} run(s), ${usage.successCount} ok, ${usage.failureCount} failed`,
        );
        console.log(`    Last used: ${new Date(usage.lastUsedAt).toISOString()}`);
        if (usage.averageDurationMs !== undefined) {
          console.log(`    Avg duration: ${Math.round(usage.averageDurationMs)}ms`);
        }
        if (usage.lastError) {
          console.log(`    Last error: ${usage.lastError}`);
        }
        console.log('');
      }
    });

  hub
    .command('info <name>')
    .description('Show details about an installed skill')
    .action(async (name: string) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const result = skillsHub.info(name);
      if (!result) {
        console.log(`Skill not found: ${name}`);
        return;
      }
      console.log(`\n${result.installed.name} v${result.installed.version}`);
      console.log(`  Integrity: ${result.integrityOk ? 'OK' : 'MISMATCH'}`);
      console.log(`  Installed: ${new Date(result.installed.installedAt).toISOString()}`);
      console.log(`  Path: ${result.installed.path}`);
      console.log('');
    });

  hub
    .command('publish <path>')
    .description('Publish a skill to the hub')
    .action(async (skillPath: string) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      try {
        const published = await skillsHub.publish(skillPath);
        console.log(`Published ${published.name} v${published.version}`);
      } catch (error) {
        console.error(`Failed to publish: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  hub
    .command('sync')
    .description('Sync installed skills with lockfile')
    .action(async () => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const result = await skillsHub.sync();
      console.log(`Sync complete:`);
      if (result.removed.length) console.log(`  Removed: ${result.removed.join(', ')}`);
      if (result.mismatched.length) console.log(`  Mismatched: ${result.mismatched.join(', ')}`);
      if (result.updated.length) console.log(`  Updated: ${result.updated.join(', ')}`);
      if (!result.removed.length && !result.mismatched.length && !result.updated.length) {
        console.log('  Everything in sync.');
      }
    });
}

// ============================================================================
// Identity commands
// ============================================================================

export function registerIdentityCommands(program: Command): void {
  const identity = program
    .command('identity')
    .description('Manage agent identity files (SOUL.md, USER.md, etc.)');

  identity
    .command('show')
    .description('Show loaded identity files')
    .action(async () => {
      const { getIdentityManager } = await import('../../identity/identity-manager.js');
      const mgr = getIdentityManager();
      await mgr.load(process.cwd());
      const files = mgr.getAll();
      if (files.length === 0) {
        console.log('No identity files loaded.');
        console.log('Create .codebuddy/SOUL.md or ~/.codebuddy/SOUL.md to define agent personality.');
        return;
      }
      console.log(`\nIdentity files (${files.length}):\n`);
      for (const f of files) {
        console.log(`  ${f.name} (${f.source})`);
        console.log(`    Path: ${f.path}`);
        console.log(`    Size: ${f.content.length} chars`);
        console.log(`    Modified: ${f.lastModified.toISOString()}`);
        console.log('');
      }
    });

  identity
    .command('get <name>')
    .description('Show content of a specific identity file')
    .action(async (name: string) => {
      const { getIdentityManager } = await import('../../identity/identity-manager.js');
      const mgr = getIdentityManager();
      await mgr.load(process.cwd());
      // Try with and without .md extension
      const file = mgr.get(name) ?? mgr.get(`${name}.md`) ?? mgr.get(name.toUpperCase()) ?? mgr.get(`${name.toUpperCase()}.md`);
      if (!file) {
        console.log(`Identity file not found: ${name}`);
        return;
      }
      console.log(`\n--- ${file.name} (${file.source}: ${file.path}) ---\n`);
      console.log(file.content);
      console.log('');
    });

  identity
    .command('set <name> <content>')
    .description('Set content of an identity file (writes to project .codebuddy/)')
    .action(async (name: string, content: string) => {
      const { getIdentityManager } = await import('../../identity/identity-manager.js');
      const mgr = getIdentityManager();
      await mgr.load(process.cwd());
      const fileName = name.toUpperCase().endsWith('.md') ? name.toUpperCase() : `${name.toUpperCase()}.md`;
      await mgr.set(fileName, content);
      console.log(`Updated ${fileName}`);
    });

  identity
    .command('awaken')
    .description('Install the Buddy companion identity in project .codebuddy/SOUL.md')
    .option('--force', 'Overwrite an existing project SOUL.md')
    .action(async (opts: { force?: boolean }) => {
      const { getIdentityManager } = await import('../../identity/identity-manager.js');
      const { BUDDY_COMPANION_SOUL_MD } = await import('../../identity/companion-identity.js');
      const mgr = getIdentityManager();
      await mgr.load(process.cwd());

      const existing = mgr.get('SOUL.md');
      if (existing && !opts.force) {
        console.log('Project SOUL.md already exists.');
        console.log('Run `buddy identity awaken --force` to replace it, or edit .codebuddy/SOUL.md manually.');
        return;
      }

      await mgr.set('SOUL.md', BUDDY_COMPANION_SOUL_MD);
      console.log('Buddy companion identity installed in .codebuddy/SOUL.md');
      console.log('Use `/persona use companion` in chat for the matching built-in persona.');
      console.log('In Cowork, use the titlebar voice overlay or the mic in the composer for voice input.');
    });

  identity
    .command('prompt')
    .description('Show the combined identity prompt injection')
    .action(async () => {
      const { getIdentityManager } = await import('../../identity/identity-manager.js');
      const mgr = getIdentityManager();
      await mgr.load(process.cwd());
      const prompt = mgr.getPromptInjection();
      if (!prompt) {
        console.log('No identity content loaded.');
        return;
      }
      console.log(`\n--- Identity Prompt ---\n`);
      console.log(prompt);
      console.log('');
    });
}

// ============================================================================
// Companion commands
// ============================================================================

export function registerCompanionCommands(program: Command): void {
  const companion = program
    .command('companion')
    .description('Configure Buddy as a ChatGPT-backed voice companion');

  companion
    .command('setup')
    .description('Install companion identity and configure voice-first defaults')
    .option('--force', 'Overwrite existing SOUL.md and BOOT.md')
    .option('--no-voice', 'Skip voice input and TTS configuration')
    .option('--no-set-model', 'Do not set the project model to the ChatGPT companion default')
    .option('--language <lang>', 'Voice language', 'fr')
    .option('--stt-provider <provider>', 'Voice input provider (system, whisper-local, whisper-api)')
    .option('--tts-provider <provider>', 'TTS provider (edge-tts, espeak, say, piper, audioreader)')
    .option('--tts-voice <voice>', 'TTS voice name')
    .option('--model <model>', 'ChatGPT model to use when OAuth credentials are present')
    .action(async (opts: {
      force?: boolean;
      voice?: boolean;
      setModel?: boolean;
      language?: string;
      sttProvider?: 'system' | 'whisper-local' | 'whisper-api';
      ttsProvider?: 'edge-tts' | 'espeak' | 'say' | 'piper' | 'audioreader';
      ttsVoice?: string;
      model?: string;
    }) => {
      const { setupCompanionMode, formatCompanionStatus } = await import('../../companion/companion-mode.js');
      const result = await setupCompanionMode({
        forceIdentity: opts.force,
        configureVoice: opts.voice !== false,
        configureModel: opts.setModel !== false,
        language: opts.language,
        sttProvider: opts.sttProvider,
        ttsProvider: opts.ttsProvider,
        ttsVoice: opts.ttsVoice,
        model: opts.model,
      });

      console.log('Buddy companion setup complete.');
      if (result.wroteSoul) console.log('Installed .codebuddy/SOUL.md');
      if (result.wroteBoot) console.log('Installed .codebuddy/BOOT.md');
      if (result.skippedSoul) console.log('Kept existing SOUL.md (use --force to replace).');
      if (result.skippedBoot) console.log('Kept existing BOOT.md (use --force to replace).');
      if (result.voiceConfigured) console.log('Voice input and TTS defaults configured.');
      if (result.modelConfigured && result.model) {
        console.log(`Project model set to ${result.model}.`);
      } else {
        console.log('Project model not changed; run `buddy login` to connect ChatGPT OAuth first.');
      }
      console.log('');
      console.log(formatCompanionStatus(result.status));
    });

  companion
    .command('status')
    .description('Show companion readiness across ChatGPT auth, identity, voice, TTS, and camera')
    .action(async () => {
      const { getCompanionStatus, formatCompanionStatus } = await import('../../companion/companion-mode.js');
      console.log(formatCompanionStatus(await getCompanionStatus()));
    });

  companion
    .command('self')
    .description('Record Buddy companion self-state into the local percept journal')
    .action(async () => {
      const { recordCompanionSelfState } = await import('../../companion/companion-mode.js');
      const percept = await recordCompanionSelfState();
      console.log(`Self-state percept recorded: ${percept.id}`);
      console.log(percept.summary);
    });

  companion
    .command('evaluate')
    .description('Evaluate Buddy companion readiness and record self-improvement suggestions')
    .option('--no-record', 'Do not write self-evaluation or suggestion percepts')
    .action(async (opts: { record?: boolean }) => {
      const {
        evaluateCompanionSelf,
        formatCompanionSelfEvaluation,
      } = await import('../../companion/self-evaluation.js');
      const evaluation = await evaluateCompanionSelf({ recordSuggestions: opts.record !== false });
      console.log(formatCompanionSelfEvaluation(evaluation));
    });

  const camera = companion
    .command('camera')
    .description('Manage the companion camera bridge');

  camera
    .command('status')
    .description('Show local camera snapshot readiness')
    .action(async () => {
      const { checkCameraAvailability, formatCameraStatus } = await import('../../companion/camera.js');
      console.log(formatCameraStatus(await checkCameraAvailability()));
    });

  camera
    .command('snapshot')
    .description('Capture one webcam frame for Buddy vision')
    .option('--output <path>', 'Output image path')
    .option('--device <device>', 'Camera device name or index')
    .option('--timeout-ms <ms>', 'Capture timeout in milliseconds', '10000')
    .action(async (opts: { output?: string; device?: string; timeoutMs: string }) => {
      const { captureCameraSnapshot } = await import('../../companion/camera.js');
      const result = await captureCameraSnapshot({
        outputPath: opts.output,
        device: opts.device,
        timeoutMs: parseInt(opts.timeoutMs, 10),
      });

      if (result.success) {
        console.log(`Camera snapshot saved: ${result.path}`);
        if (result.perceptId) console.log(`Percept recorded: ${result.perceptId}`);
        if (result.command) console.log(`Command: ${result.command}`);
        return;
      }

      console.error(result.error || 'Camera snapshot failed.');
      if (result.command) console.error(`Command: ${result.command}`);
      process.exit(1);
    });

  const percepts = companion
    .command('percepts')
    .description('Inspect Buddy companion percepts recorded from camera, voice, screen, tools, and self-state');

  percepts
    .command('recent')
    .description('Show recent companion percepts')
    .option('--limit <n>', 'Maximum percepts to print', '10')
    .option('--modality <name>', 'Filter by modality: vision, hearing, screen, self, memory, tool, suggestion')
    .action(async (opts: { limit: string; modality?: string }) => {
      const { readRecentCompanionPercepts, formatCompanionPercepts } = await import('../../companion/percepts.js');
      const modality = opts.modality as 'vision' | 'hearing' | 'screen' | 'self' | 'memory' | 'tool' | 'suggestion' | undefined;
      const recent = await readRecentCompanionPercepts({
        limit: parseInt(opts.limit, 10),
        modality,
      });
      console.log(formatCompanionPercepts(recent));
    });

  percepts
    .command('stats')
    .description('Show companion percept store statistics')
    .action(async () => {
      const { getCompanionPerceptStats, formatCompanionPerceptStats } = await import('../../companion/percepts.js');
      console.log(formatCompanionPerceptStats(await getCompanionPerceptStats()));
    });
}

// ============================================================================
// Group security commands
// ============================================================================

export function registerGroupCommands(program: Command): void {
  const groups = program
    .command('groups')
    .description('Manage group chat security');

  groups
    .command('status')
    .description('Show group security status')
    .action(async () => {
      const { getGroupSecurity } = await import('../../channels/group-security.js');
      const mgr = getGroupSecurity();
      const stats = mgr.getStats();
      console.log(`\nGroup Security`);
      console.log(`  Enabled: ${stats.enabled ? 'YES' : 'NO'}`);
      console.log(`  Default mode: ${stats.defaultMode}`);
      console.log(`  Groups configured: ${stats.totalGroups}`);
      console.log(`  Blocklist: ${stats.blocklistSize} users`);
      console.log(`  Global allowlist: ${stats.globalAllowlistSize} users`);
      if (Object.keys(stats.groupsByMode).length > 0) {
        console.log(`  Groups by mode:`);
        for (const [mode, count] of Object.entries(stats.groupsByMode)) {
          console.log(`    ${mode}: ${count}`);
        }
      }
      console.log('');
    });

  groups
    .command('list')
    .description('List configured groups')
    .action(async () => {
      const { getGroupSecurity } = await import('../../channels/group-security.js');
      const mgr = getGroupSecurity();
      const groupsList = mgr.listGroups();
      if (groupsList.length === 0) {
        console.log('No groups configured.');
        return;
      }
      console.log(`\nConfigured groups (${groupsList.length}):\n`);
      for (const g of groupsList) {
        console.log(`  [${g.activationMode}] ${g.channelType}:${g.groupId}`);
        if (g.allowedUsers && g.allowedUsers.length > 0) {
          console.log(`    Allowed: ${g.allowedUsers.join(', ')}`);
        }
      }
      console.log('');
    });

  groups
    .command('block <userId>')
    .description('Add a user to the global blocklist')
    .action(async (userId: string) => {
      const { getGroupSecurity } = await import('../../channels/group-security.js');
      const mgr = getGroupSecurity();
      mgr.addToBlocklist(userId);
      console.log(`Blocked user: ${userId}`);
    });

  groups
    .command('unblock <userId>')
    .description('Remove a user from the global blocklist')
    .action(async (userId: string) => {
      const { getGroupSecurity } = await import('../../channels/group-security.js');
      const mgr = getGroupSecurity();
      if (mgr.removeFromBlocklist(userId)) {
        console.log(`Unblocked user: ${userId}`);
      } else {
        console.log(`User not in blocklist: ${userId}`);
      }
    });
}

// ============================================================================
// Auth profile commands
// ============================================================================

export function registerAuthProfileCommands(program: Command): void {
  const authCmd = program
    .command('auth-profile')
    .description('Manage authentication profiles (API key rotation)');

  authCmd
    .command('list')
    .description('List authentication profiles')
    .action(async () => {
      const { getAuthProfileManager } = await import('../../auth/profile-manager.js');
      const mgr = getAuthProfileManager();
      const status = mgr.getStatus();
      if (status.length === 0) {
        console.log('No auth profiles configured.');
        console.log('Use auth-profile add to register one.');
        return;
      }
      console.log(`\nAuth profiles (${status.length}):\n`);
      for (const p of status) {
        const health = p.healthy ? 'HEALTHY' : `COOLDOWN (${p.failureCount} failures)`;
        console.log(`  [${health}] ${p.profileId} (${p.provider})`);
        console.log(`    Type: ${p.type}, Priority: ${p.priority}`);
        if (p.inCooldown && p.cooldownRemainingMs > 0) {
          console.log(`    Cooldown remaining: ${Math.round(p.cooldownRemainingMs / 1000)}s`);
        }
        if (p.lastError) {
          console.log(`    Last error: ${p.lastError}`);
        }
        console.log('');
      }
    });

  authCmd
    .command('add <id> <provider>')
    .description('Add an authentication profile')
    .option('-k, --api-key <key>', 'API key')
    .option('-p, --priority <n>', 'priority (higher = preferred)', '0')
    .option('-m, --model <model>', 'model to use')
    .option('-u, --base-url <url>', 'base URL override')
    .action(async (id: string, provider: string, opts: { apiKey?: string; priority: string; model?: string; baseUrl?: string }) => {
      const { getAuthProfileManager } = await import('../../auth/profile-manager.js');
      const mgr = getAuthProfileManager();
      mgr.addProfile({
        id,
        provider,
        type: 'api-key',
        credentials: { apiKey: opts.apiKey ?? process.env[`${provider.toUpperCase()}_API_KEY`] },
        priority: parseInt(opts.priority),
        metadata: {
          model: opts.model,
          baseURL: opts.baseUrl,
        },
      });
      console.log(`Added profile: ${id} (${provider})`);
    });

  authCmd
    .command('remove <id>')
    .description('Remove an authentication profile')
    .action(async (id: string) => {
      const { getAuthProfileManager } = await import('../../auth/profile-manager.js');
      const mgr = getAuthProfileManager();
      if (mgr.removeProfile(id)) {
        console.log(`Removed profile: ${id}`);
      } else {
        console.log(`Profile not found: ${id}`);
      }
    });

  authCmd
    .command('reset')
    .description('Reset all profiles (clears cooldowns)')
    .action(async () => {
      const { resetAuthProfileManager } = await import('../../auth/profile-manager.js');
      resetAuthProfileManager();
      console.log('Auth profile manager reset. All cooldowns cleared.');
    });
}
