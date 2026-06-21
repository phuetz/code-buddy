/**
 * Enterprise-grade CLI commands
 *
 * Registers heartbeat, hub (skills marketplace), identity, companion, groups,
 * and auth-profile subcommands on the given program.
 */

import type { Command } from 'commander';
import type { ChannelType, ContentType } from '../../channels/core.js';
import { buildHeartbeatStatusReport } from '../../daemon/status-reports.js';
import type {
  CompanionCardKind,
  CompanionCardPriority,
  CompanionCardStatus,
} from '../../companion/cards.js';

// ============================================================================
// Heartbeat commands
// ============================================================================

export { buildHeartbeatStatusReport };

function parsePositiveIntegerCliOption(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const n = Number(trimmed);
  if (!/^[1-9]\d*$/.test(trimmed) || !Number.isSafeInteger(n)) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return n;
}

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
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { getHeartbeatEngine } = await import('../../daemon/heartbeat.js');
      const engine = getHeartbeatEngine();
      const status = engine.getStatus();
      if (opts.json) {
        console.log(JSON.stringify(buildHeartbeatStatusReport(status, engine.getConfig()), null, 2));
        return;
      }
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
    .option('--json', 'output JSON')
    .action(async (query: string, opts: { tags?: string; limit: string; json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const result = await skillsHub.search(query, {
        tags: opts.tags?.split(','),
        limit: parseInt(opts.limit),
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
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
    .option('--json', 'output JSON')
    .action(async (name: string, opts: { version?: string; json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      try {
        const installed = await skillsHub.install(name, opts.version);
        if (opts.json) {
          console.log(JSON.stringify({ installed }, null, 2));
          return;
        }
        console.log(`Installed ${installed.name} v${installed.version}`);
      } catch (error) {
        const message = `Failed to install: ${error instanceof Error ? error.message : error}`;
        if (opts.json) {
          console.log(JSON.stringify({ error: message, installed: null, name }, null, 2));
        } else {
          console.error(message);
        }
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
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const installed = skillsHub.list();
      if (opts.json) {
        console.log(JSON.stringify({ count: installed.length, skills: installed }, null, 2));
        return;
      }
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
    .option('--sign <key>', 'sign with a base64 Ed25519 private key, or @file to read it from disk')
    .option('--key-id <id>', 'key id to record in the signature (defaults to the key fingerprint)')
    .option('--json', 'output JSON')
    .action(async (skillPath: string, opts: { sign?: string; keyId?: string; json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      try {
        const signingKey = opts.sign ? await readKeyMaterial(opts.sign) : undefined;
        const published = await skillsHub.publish(skillPath, {
          ...(signingKey ? { signingKey } : {}),
          ...(opts.keyId ? { keyId: opts.keyId } : {}),
        });
        if (opts.json) {
          console.log(JSON.stringify({ published }, null, 2));
          return;
        }
        console.log(`Published ${published.name} v${published.version}`);
        if (published.signature) {
          console.log(`  Signed by key ${published.signature.keyId} (${published.signature.algorithm})`);
        }
      } catch (error) {
        const message = `Failed to publish: ${error instanceof Error ? error.message : error}`;
        if (opts.json) {
          console.log(JSON.stringify({ error: message, published: null }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
      }
    });

  hub
    .command('sync')
    .description('Sync installed skills with lockfile')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const result = await skillsHub.sync();
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Sync complete:`);
      if (result.removed.length) console.log(`  Removed: ${result.removed.join(', ')}`);
      if (result.mismatched.length) console.log(`  Mismatched: ${result.mismatched.join(', ')}`);
      if (result.updated.length) console.log(`  Updated: ${result.updated.join(', ')}`);
      if (!result.removed.length && !result.mismatched.length && !result.updated.length) {
        console.log('  Everything in sync.');
      }
    });

  const tap = hub
    .command('tap')
    .description('Manage repository-backed skill taps');

  tap
    .command('list')
    .description('List configured skill taps')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const result = {
        count: skillsHub.listTaps().length,
        taps: skillsHub.listTaps(),
        tapsPath: skillsHub.getConfig().tapsPath,
      };
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.taps.length === 0) {
        console.log(`No skill taps configured. Tap registry: ${result.tapsPath}`);
        return;
      }
      console.log(`\nSkill taps (${result.taps.length}):`);
      for (const item of result.taps) {
        console.log(`  ${item.repo}  path=${item.path}  trust=${item.trust}`);
      }
      console.log('');
    });

  tap
    .command('add <repo>')
    .description('Add or update a skill tap (owner/repo)')
    .option('--path <path>', 'skill directory inside the tap repository', 'skills/')
    .option('--trust <trust>', 'trust level: builtin, official, trusted, or community')
    .option('--approved-by <reviewer>', 'reviewer/operator approving the tap')
    .option('--json', 'output JSON')
    .action(async (
      repo: string,
      opts: { approvedBy?: string; json?: boolean; path?: string; trust?: string },
    ) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const tap = skillsHub.addTap(repo, {
        actor: opts.approvedBy,
        path: opts.path,
        trust: parseSkillTapTrust(opts.trust),
      });
      if (opts.json) {
        console.log(JSON.stringify({ tap }, null, 2));
        return;
      }
      console.log(`Skill tap configured: ${tap.repo} path=${tap.path} trust=${tap.trust}`);
    });

  tap
    .command('remove <repo>')
    .description('Remove a configured skill tap')
    .option('--json', 'output JSON')
    .action(async (repo: string, opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const removed = getSkillsHub().removeTap(repo);
      if (opts.json) {
        console.log(JSON.stringify({ removed, repo }, null, 2));
        return;
      }
      console.log(removed ? `Skill tap removed: ${repo}` : `Skill tap not found: ${repo}`);
    });

  tap
    .command('refresh [repo]')
    .description('Refresh the local discovery cache from GitHub-backed taps')
    .option('--json', 'output JSON')
    .action(async (repo: string | undefined, opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const result = await getSkillsHub().refreshTapIndex(repo);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Refreshed ${result.skillCount} skill(s) from ${result.taps.length} tap(s).`);
      for (const skill of result.skills) {
        console.log(`  ${skill.identifier}  ${skill.description}`);
      }
      for (const error of result.errors) {
        console.log(`  ! ${error.repo}: ${error.error}`);
      }
    });

  hub
    .command('well-known <url>')
    .description('Discover skills from a /.well-known/skills/index.json endpoint')
    .option('--json', 'output JSON')
    .action(async (url: string, opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const result = await getSkillsHub().discoverWellKnownSkills(url);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Discovered ${result.skillCount} well-known skill(s) from ${result.indexUrl}.`);
      for (const skill of result.skills) {
        console.log(`  ${skill.identifier}  ${skill.description}`);
      }
      for (const error of result.errors) {
        console.log(`  ! ${error}`);
      }
    });

  hub
    .command('verify <name>')
    .description('Verify an installed skill\'s recorded signature against the trusted keyring')
    .option('--json', 'output JSON')
    .action(async (name: string, opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const detail = skillsHub.info(name);
      if (!detail || typeof detail.content !== 'string') {
        const message = `Skill not found or missing on disk: ${name}`;
        if (opts.json) {
          console.log(JSON.stringify({ error: message, name }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
        return;
      }
      const verification = skillsHub.verifySkillContentSignature(detail.content, detail.installed.signature);
      if (opts.json) {
        console.log(JSON.stringify({ name, integrityOk: detail.integrityOk, verification }, null, 2));
        return;
      }
      console.log(`\n${name}: signature ${verification.status}`);
      if (verification.keyId) console.log(`  Key: ${verification.keyId}${verification.trust ? ` (trust=${verification.trust})` : ''}`);
      if (verification.reason) console.log(`  Reason: ${verification.reason}`);
      console.log('');
      // Non-zero exit unless the signature is verified or the skill is intentionally unsigned.
      if (verification.status === 'invalid' || verification.status === 'untrusted') {
        process.exit(1);
      }
    });

  const keys = hub
    .command('keys')
    .description('Manage trusted publisher signing keys');

  keys
    .command('list')
    .description('List trusted publisher keys')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      const trustedKeys = skillsHub.listTrustedKeys();
      if (opts.json) {
        console.log(JSON.stringify({
          count: trustedKeys.length,
          keys: trustedKeys,
          trustedKeysPath: skillsHub.getConfig().trustedKeysPath,
        }, null, 2));
        return;
      }
      if (trustedKeys.length === 0) {
        console.log(`No trusted keys configured. Keyring: ${skillsHub.getConfig().trustedKeysPath}`);
        return;
      }
      console.log(`\nTrusted publisher keys (${trustedKeys.length}):`);
      for (const key of trustedKeys) {
        console.log(`  ${key.keyId}  trust=${key.trust}${key.label ? `  (${key.label})` : ''}`);
      }
      console.log('');
    });

  keys
    .command('generate [keyId]')
    .description('Generate a new Ed25519 publisher keypair (private key is NOT trusted or stored)')
    .option('--out <dir>', 'write <keyId>.public.key and <keyId>.private.key into this directory (0600)')
    .option('--json', 'output JSON')
    .action(async (keyId: string | undefined, opts: { out?: string; json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const keypair = getSkillsHub().generateSigningKeyPair(keyId);
      let publicKeyPath: string | undefined;
      let privateKeyPath: string | undefined;
      if (opts.out) {
        const fs = await import('fs');
        const path = await import('path');
        fs.mkdirSync(opts.out, { recursive: true });
        publicKeyPath = path.join(opts.out, `${keypair.keyId}.public.key`);
        privateKeyPath = path.join(opts.out, `${keypair.keyId}.private.key`);
        fs.writeFileSync(publicKeyPath, keypair.publicKey, { encoding: 'utf-8', mode: 0o644 });
        fs.writeFileSync(privateKeyPath, keypair.privateKey, { encoding: 'utf-8', mode: 0o600 });
      }
      if (opts.json) {
        // Never print the private key in JSON unless it was written to a 0600 file.
        console.log(JSON.stringify({
          keyId: keypair.keyId,
          publicKey: keypair.publicKey,
          publicKeyPath,
          privateKeyPath,
          ...(opts.out ? {} : { privateKey: keypair.privateKey }),
        }, null, 2));
        return;
      }
      console.log(`Generated Ed25519 keypair: ${keypair.keyId}`);
      console.log(`  Public key:  ${keypair.publicKey}`);
      if (opts.out) {
        console.log(`  Public key file:  ${publicKeyPath}`);
        console.log(`  Private key file: ${privateKeyPath} (mode 0600 — keep secret)`);
      } else {
        console.log(`  Private key: ${keypair.privateKey}`);
        console.log('  ! Keep the private key secret. Trust the PUBLIC key on consumers with `buddy hub keys add`.');
      }
    });

  keys
    .command('add <publicKey>')
    .description('Trust a publisher public key (base64 SPKI DER, or @file to read it from disk)')
    .option('--key-id <id>', 'key id to record (defaults to the key fingerprint)')
    .option('--trust <trust>', 'trust level: builtin, official, trusted, or community', 'community')
    .option('--label <label>', 'human-readable publisher label')
    .option('--approved-by <reviewer>', 'reviewer/operator approving the key')
    .option('--json', 'output JSON')
    .action(async (
      publicKey: string,
      opts: { keyId?: string; trust?: string; label?: string; approvedBy?: string; json?: boolean },
    ) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      try {
        const material = await readKeyMaterial(publicKey);
        const key = skillsHub.addTrustedKey(material, {
          ...(opts.keyId ? { keyId: opts.keyId } : {}),
          ...(parseSkillTapTrust(opts.trust) ? { trust: parseSkillTapTrust(opts.trust) } : {}),
          ...(opts.label ? { label: opts.label } : {}),
          ...(opts.approvedBy ? { addedBy: opts.approvedBy } : {}),
        });
        if (opts.json) {
          console.log(JSON.stringify({ key }, null, 2));
          return;
        }
        console.log(`Trusted publisher key: ${key.keyId} (trust=${key.trust})`);
      } catch (error) {
        const message = `Failed to add key: ${error instanceof Error ? error.message : error}`;
        if (opts.json) {
          console.log(JSON.stringify({ error: message, key: null }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
      }
    });

  keys
    .command('remove <keyId>')
    .description('Remove a trusted publisher key')
    .option('--json', 'output JSON')
    .action(async (keyId: string, opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const removed = getSkillsHub().removeTrustedKey(keyId);
      if (opts.json) {
        console.log(JSON.stringify({ removed, keyId }, null, 2));
        return;
      }
      console.log(removed ? `Trusted key removed: ${keyId}` : `Trusted key not found: ${keyId}`);
    });

  keys
    .command('trust <keyId> <trust>')
    .description('Set the trust level of an existing trusted key')
    .option('--approved-by <reviewer>', 'reviewer/operator approving the change')
    .option('--json', 'output JSON')
    .action(async (
      keyId: string,
      trust: string,
      opts: { approvedBy?: string; json?: boolean },
    ) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skillsHub = getSkillsHub();
      try {
        const parsed = parseSkillTapTrust(trust);
        if (!parsed) {
          throw new Error('A trust level is required: builtin, official, trusted, or community.');
        }
        const key = skillsHub.setKeyTrust(keyId, parsed, {
          ...(opts.approvedBy ? { addedBy: opts.approvedBy } : {}),
        });
        if (opts.json) {
          console.log(JSON.stringify({ key }, null, 2));
          return;
        }
        console.log(key ? `Trust updated: ${key.keyId} -> ${key.trust}` : `Trusted key not found: ${keyId}`);
        if (!key) process.exit(1);
      } catch (error) {
        const message = `Failed to set trust: ${error instanceof Error ? error.message : error}`;
        if (opts.json) {
          console.log(JSON.stringify({ error: message, key: null }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
      }
    });
}

/**
 * Read key material from a CLI argument: `@path` reads (and trims) the file,
 * anything else is treated as the literal base64 key.
 */
async function readKeyMaterial(value: string): Promise<string> {
  const trimmed = value.trim();
  if (trimmed.startsWith('@')) {
    const fs = await import('fs');
    return fs.readFileSync(trimmed.slice(1), 'utf-8').trim();
  }
  return trimmed;
}

function parseSkillTapTrust(value?: string): import('../../skills/hub.js').SkillTapTrust | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'builtin'
    || normalized === 'official'
    || normalized === 'trusted'
    || normalized === 'community'
  ) {
    return normalized;
  }
  throw new Error(`Invalid trust level '${value}'. Use builtin, official, trusted, or community.`);
}

// ============================================================================
// Gateway device pairing commands
// ============================================================================

export function registerGatewayPairingCommands(program: Command): void {
  const pairing = program
    .command('gateway-pairing')
    .description('Operator approval for gateway device pairing (pending -> approve/reject -> token)');

  pairing
    .command('pending')
    .description('List devices awaiting pairing approval')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { getGatewayPairingStore } = await import('../../gateway/device-pairing.js');
      const store = getGatewayPairingStore();
      const pendingDevices = store.listPending();
      if (opts.json) {
        console.log(JSON.stringify({ count: pendingDevices.length, pending: pendingDevices, dir: store.getDir() }, null, 2));
        return;
      }
      if (pendingDevices.length === 0) {
        console.log(`No devices pending approval. Store: ${store.getDir()}`);
        return;
      }
      console.log(`\nPending devices (${pendingDevices.length}):`);
      for (const d of pendingDevices) {
        console.log(`  ${d.deviceId}  role=${d.role}${d.clientId ? `  client=${d.clientId}` : ''}  scopes=[${d.requestedScopes.join(', ')}]`);
      }
      console.log('');
    });

  pairing
    .command('list')
    .description('List paired (approved) devices')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { getGatewayPairingStore } = await import('../../gateway/device-pairing.js');
      const store = getGatewayPairingStore();
      const paired = store.listPaired();
      if (opts.json) {
        console.log(JSON.stringify({ count: paired.length, paired, dir: store.getDir() }, null, 2));
        return;
      }
      if (paired.length === 0) {
        console.log(`No paired devices. Store: ${store.getDir()}`);
        return;
      }
      console.log(`\nPaired devices (${paired.length}):`);
      for (const d of paired) {
        console.log(`  ${d.deviceId}  role=${d.role}  scopes=[${d.scopes.join(', ')}]${d.approvedBy ? `  by=${d.approvedBy}` : ''}`);
      }
      console.log('');
    });

  pairing
    .command('approve <deviceId>')
    .description('Approve a device and mint its scoped token (shown once)')
    .option('--scopes <csv>', 'comma-separated scopes to grant (default: requested)')
    .option('--role <role>', 'device role: operator, node, control, or webchat')
    .option('--approved-by <name>', 'operator approving the device')
    .option('--json', 'output JSON')
    .action(async (
      deviceId: string,
      opts: { scopes?: string; role?: string; approvedBy?: string; json?: boolean },
    ) => {
      const { getGatewayPairingStore, isDeviceRole } = await import('../../gateway/device-pairing.js');
      const store = getGatewayPairingStore();
      try {
        const result = store.approve(deviceId, {
          ...(opts.scopes ? { scopes: opts.scopes.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
          ...(opts.role && isDeviceRole(opts.role) ? { role: opts.role } : {}),
          ...(opts.approvedBy ? { approvedBy: opts.approvedBy } : {}),
        });
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`Approved ${result.device.deviceId} (scopes=[${result.device.scopes.join(', ')}])`);
        console.log(`  Device token (shown once — give it to the device): ${result.token}`);
      } catch (error) {
        const message = `Failed to approve: ${error instanceof Error ? error.message : error}`;
        if (opts.json) console.log(JSON.stringify({ error: message, device: deviceId }, null, 2));
        else console.error(message);
        process.exit(1);
      }
    });

  pairing
    .command('reject <deviceId>')
    .description('Reject a pending pairing request')
    .option('--json', 'output JSON')
    .action(async (deviceId: string, opts: { json?: boolean }) => {
      const { getGatewayPairingStore } = await import('../../gateway/device-pairing.js');
      const removed = getGatewayPairingStore().reject(deviceId);
      if (opts.json) {
        console.log(JSON.stringify({ rejected: removed, device: deviceId }, null, 2));
        return;
      }
      console.log(removed ? `Rejected pending device: ${deviceId}` : `No pending request for: ${deviceId}`);
    });

  pairing
    .command('revoke <deviceId>')
    .description('Revoke an already-paired device (invalidates its token)')
    .option('--json', 'output JSON')
    .action(async (deviceId: string, opts: { json?: boolean }) => {
      const { getGatewayPairingStore } = await import('../../gateway/device-pairing.js');
      const revoked = getGatewayPairingStore().revoke(deviceId);
      if (opts.json) {
        console.log(JSON.stringify({ revoked, device: deviceId }, null, 2));
        return;
      }
      console.log(revoked ? `Revoked paired device: ${deviceId}` : `No paired device: ${deviceId}`);
    });
}

// ============================================================================
// Fleet autonomy commands
// ============================================================================

export function registerFleetAutonomyCommands(program: Command): void {
  const fleet = program
    .command('autonomy')
    .description('Autonomous fleet loop — claim and run colab tasks on local-first models');

  fleet
    .command('run')
    .description('Run the autonomous loop (default: one tick; --watch for continuous)')
    .option('--watch', 'run continuously until Ctrl-C')
    .option('--interval <ms>', 'tick interval for --watch', '30000')
    .option('--max-ticks <n>', 'stop after N ticks')
    .option('--dir <path>', 'colab dir (default: CODEBUDDY_FLEET_COLAB_DIR or <cwd>/.codebuddy)')
    .option('--output-dir <path>', 'artifact output dir')
    .option('--json', 'output JSON summary')
    .action(async (opts: {
      watch?: boolean; interval: string; maxTicks?: string;
      dir?: string; outputDir?: string; json?: boolean;
    }) => {
      const { createDefaultAutonomousLoop, FleetAutonomousDaemon, watchFleetTasks } = await import('../../daemon/autonomous-daemon.js');
      const path = await import('path');
      const loop = await createDefaultAutonomousLoop({
        ...(opts.dir ? { dir: opts.dir } : {}),
        ...(opts.outputDir ? { outputDir: opts.outputDir } : {}),
      });
      // Same dir resolution the store uses, so the watcher observes the live queue.
      const colabDir = opts.dir || process.env['CODEBUDDY_FLEET_COLAB_DIR'] || path.join(process.cwd(), '.codebuddy');
      const daemon = new FleetAutonomousDaemon({
        loop,
        intervalMs: parseInt(opts.interval, 10) || 30000,
        onTick: (result, n) => {
          if (!opts.json) {
            const tier = result.model ? ` [${result.model.tier}${result.model.paid ? ' $' : ''}]` : '';
            console.log(`tick ${n}: ${result.outcome}${result.taskTitle ? ` — ${result.taskTitle}` : ''}${tier}`);
          }
        },
        // Event-driven only for continuous runs: a write to the queue wakes the
        // daemon at once; the interval stays as a fallback heartbeat.
        ...(opts.watch ? { eventSourceFactory: (wake: () => void) => watchFleetTasks(colabDir, wake) } : {}),
      });

      if (opts.watch) {
        const onSig = () => { console.log('\nstopping after current tick…'); daemon.stop(); };
        process.once('SIGINT', onSig);
        process.once('SIGTERM', onSig);
      }

      const maxTicks = opts.watch
        ? (opts.maxTicks ? parseInt(opts.maxTicks, 10) : undefined)
        : 1;
      const summary = await daemon.run(maxTicks !== undefined ? { maxTicks } : {});

      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`\nDone: ${summary.ticks} tick(s), ${JSON.stringify(summary.outcomes)} (${summary.stoppedReason}).`);
      }
    });

  fleet
    .command('bench')
    .description('Benchmark live Tailnet Ollama peers and rank the network model tier')
    .option('--peer <pattern>', 'only benchmark peers whose hostname or IP contains the pattern')
    .option('--models <csv>', 'only benchmark models whose name contains one of the comma-separated patterns')
    .option('--prompt-set <name>', 'prompt set: balanced, coding, or latency', 'coding')
    .option('--runs <n>', 'repeat the prompt set N times per candidate', '1')
    .option('--timeout <ms>', 'request timeout per prompt', '60000')
    .option('--json', 'output JSON')
    .option('--no-write-cache', 'do not persist the score cache used by the router')
    .action(async (opts: {
      peer?: string;
      models?: string;
      promptSet: 'balanced' | 'coding' | 'latency';
      runs: string;
      timeout: string;
      json?: boolean;
      writeCache?: boolean;
    }) => {
      const { TailscaleManager } = await import('../../integrations/tailscale.js');
      const {
        BENCHMARK_PROMPT_SETS,
        benchmarkCandidates,
        writeBenchmarkIndex,
        defaultBenchmarkIndexPath,
      } = await import('../../agent/model-benchmark.js');

      const peers = await TailscaleManager.getInstance().discoverOllamaPeers();
      const filteredPeers = opts.peer
        ? peers.filter((peer) =>
            peer.hostname.toLowerCase().includes(opts.peer!.toLowerCase())
            || peer.ip.includes(opts.peer!.trim()),
          )
        : peers;
      const modelFilters = opts.models
        ? opts.models.split(',').map((part) => part.trim()).filter(Boolean)
        : [];
      const candidates = filteredPeers.flatMap((peer) =>
        peer.models
          .filter((model) =>
            modelFilters.length === 0
              ? true
              : modelFilters.some((filter) => model.toLowerCase().includes(filter.toLowerCase())),
          )
          .map((model) => ({
            model,
            baseUrl: peer.baseURL,
            label: peer.hostname,
          })),
      );

      if (candidates.length === 0) {
        const message = opts.peer
          ? `No Tailnet Ollama peers matched "${opts.peer}".`
          : 'No Tailnet Ollama peers were discovered.';
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: message }, null, 2));
          return;
        }
        console.log(message);
        return;
      }

      const suite = BENCHMARK_PROMPT_SETS[opts.promptSet] ? opts.promptSet : 'coding';
      const reports = await benchmarkCandidates(candidates, {
        promptSet: suite,
        runs: Math.max(1, parseInt(opts.runs, 10) || 1),
        timeoutMs: Math.max(5_000, parseInt(opts.timeout, 10) || 60_000),
      });
      const ranked = [...reports].sort((a, b) => b.summary.score - a.summary.score);
      let indexPath: string | undefined;
      if (opts.writeCache !== false) {
        indexPath = defaultBenchmarkIndexPath();
        await writeBenchmarkIndex(ranked, suite, indexPath);
      }

      const best = ranked[0];
      if (opts.json) {
        console.log(JSON.stringify({
          ok: true,
          suite,
          indexPath,
          best,
          reports: ranked,
        }, null, 2));
        return;
      }

      console.log(`\nTailnet Ollama benchmark (${suite})`);
      if (indexPath) console.log(`  Cache: ${indexPath}`);
      console.log(`  Candidates: ${ranked.length}`);
      if (best) {
        console.log(`  Best: ${best.candidate.label ?? best.candidate.model} / ${best.candidate.model}`);
        console.log(`    Score: ${best.summary.score.toFixed(1)}  compliance ${(best.summary.complianceRate * 100).toFixed(0)}%  ttft ${Math.round(best.summary.avgTtftMs)}ms  total ${Math.round(best.summary.avgTotalMs)}ms`);
      }
      console.log('');
      ranked.forEach((report, index) => {
        console.log(`${String(index + 1).padStart(2, ' ')}. ${report.candidate.label ?? report.candidate.model} / ${report.candidate.model}`);
        console.log(`    ${report.candidate.baseUrl}`);
        console.log(`    score=${report.summary.score.toFixed(1)} compliance=${(report.summary.complianceRate * 100).toFixed(0)}% ttft=${Math.round(report.summary.avgTtftMs)}ms total=${Math.round(report.summary.avgTotalMs)}ms`);
      });
      console.log('');
    });

  fleet
    .command('status')
    .description('Show the fleet task queue + presence')
    .option('--dir <path>', 'colab dir')
    .option('--json', 'output JSON')
    .action(async (opts: { dir?: string; json?: boolean }) => {
      const { FleetColabStore } = await import('../../fleet/colab-store.js');
      const store = new FleetColabStore({ ...(opts.dir ? { dir: opts.dir } : {}) });
      const tasks = store.listTasks();
      const byStatus = tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {});
      const presence = store.listPresence();
      if (opts.json) {
        console.log(JSON.stringify({ dir: store.getDir(), byStatus, tasks, presence }, null, 2));
        return;
      }
      console.log(`\nFleet store: ${store.getDir()}`);
      console.log(`Tasks: ${tasks.length} (${Object.entries(byStatus).map(([s, n]) => `${s}=${n}`).join(', ') || 'none'})`);
      const next = store.nextClaimable();
      console.log(`Next auto-claimable: ${next ? `${next.title} [${next.priority}]` : 'none (or all critical)'}`);
      const blocked = tasks.filter((t) => t.status === 'open' && !store.areDependenciesMet(t, tasks));
      console.log(`Blocked by deps: ${blocked.length}${blocked.length ? ` (${blocked.map((t) => t.id).join(', ')})` : ''}`);
      const agents = Object.entries(presence);
      console.log(`Agents: ${agents.length ? agents.map(([id, p]) => `${id}(${p.status})`).join(', ') : 'none'}`);
      console.log('');
    });

  const tasks = fleet
    .command('tasks')
    .description('Manage fleet colab tasks');

  tasks
    .command('add <title>')
    .description('Add a task to the fleet queue')
    .option('--priority <p>', 'critical | high | medium | low', 'medium')
    .option('--depends-on <ids>', 'comma-separated task ids this task depends on')
    .option('--description <text>', 'task description')
    .option('--goal-mode', 'judge-gated loop: the worker keeps going until an LLM judge confirms the task is done, then blocks for human review when the budget is spent')
    .option('--goal-max-turns <n>', 'goal-mode turn budget (default 5)')
    .option('--dir <path>', 'colab dir')
    .option('--json', 'output JSON')
    .action(async (
      title: string,
      opts: { priority?: string; dependsOn?: string; description?: string; goalMode?: boolean; goalMaxTurns?: string; dir?: string; json?: boolean },
    ) => {
      let goalMaxTurns: number | undefined;
      try {
        goalMaxTurns = parsePositiveIntegerCliOption(opts.goalMaxTurns, '--goal-max-turns');
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
        return;
      }
      const { FleetColabStore } = await import('../../fleet/colab-store.js');
      const store = new FleetColabStore({ ...(opts.dir ? { dir: opts.dir } : {}) });
      const priority = (['critical', 'high', 'medium', 'low'] as const).find((p) => p === opts.priority) ?? 'medium';
      const task = store.addTask({
        title,
        priority,
        ...(opts.description ? { description: opts.description } : {}),
        ...(opts.dependsOn ? { dependsOn: opts.dependsOn.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
        ...(opts.goalMode ? { goalMode: true } : {}),
        ...(goalMaxTurns !== undefined ? { goalMaxTurns } : {}),
      });
      if (opts.json) { console.log(JSON.stringify({ task }, null, 2)); return; }
      const goalNote = task.goalMode ? ` goal-mode(${task.goalMaxTurns ?? 5} turns)` : '';
      console.log(`Added task ${task.id} [${task.priority}]${goalNote}${task.dependsOn ? ` depends on ${task.dependsOn.join(', ')}` : ''}`);
    });

  tasks
    .command('board')
    .description('Render the unified fleet board as Hermes-style columns (To Do / In Progress / Review / Done)')
    .option('--dir <path>', 'colab dir')
    .option('--json', 'output JSON')
    .action(async (opts: { dir?: string; json?: boolean }) => {
      const { FleetColabStore } = await import('../../fleet/colab-store.js');
      const store = new FleetColabStore({ ...(opts.dir ? { dir: opts.dir } : {}) });
      const all = store.listTasks();
      const columns = [
        { key: 'open', label: 'To Do' },
        { key: 'in_progress', label: 'In Progress' },
        { key: 'blocked', label: 'Review' },
        { key: 'completed', label: 'Done' },
      ] as const;
      if (opts.json) {
        const grouped = Object.fromEntries(columns.map((c) => [c.label, all.filter((t) => t.status === c.key)]));
        console.log(JSON.stringify(grouped, null, 2));
        return;
      }
      for (const col of columns) {
        const items = all.filter((t) => t.status === col.key);
        console.log(`\n${col.label} (${items.length})`);
        if (items.length === 0) { console.log('  —'); continue; }
        for (const t of items) {
          const annotations: string[] = [];
          if (t.claimedBy) annotations.push(`@${t.claimedBy}`);
          if (t.attempts) annotations.push(`attempts:${t.attempts}`);
          if (t.dependsOn?.length) annotations.push(`deps:${t.dependsOn.length}`);
          if (t.goalMode) annotations.push('goal');
          if (col.key === 'blocked' && t.blockedReason) annotations.push(`(${t.blockedReason})`);
          const suffix = annotations.length ? ` — ${annotations.join(' ')}` : '';
          console.log(`  ${t.id} [${t.priority}] ${t.title}${suffix}`);
        }
      }
    });

  fleet
    .command('swarm <goal>')
    .description('Create a workers → verifier → synthesizer task graph')
    .option('--worker <title>', 'a parallel worker (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--verifier <title>', 'verifier task title')
    .option('--synthesizer <title>', 'synthesizer task title')
    .option('--dir <path>', 'colab dir')
    .option('--json', 'output JSON')
    .action(async (
      goal: string,
      opts: { worker: string[]; verifier?: string; synthesizer?: string; dir?: string; json?: boolean },
    ) => {
      const { FleetColabStore } = await import('../../fleet/colab-store.js');
      const { createSwarm } = await import('../../fleet/colab-swarm.js');
      const store = new FleetColabStore({ ...(opts.dir ? { dir: opts.dir } : {}) });
      if (!opts.worker || opts.worker.length === 0) {
        console.error('At least one --worker is required.');
        process.exit(1);
        return;
      }
      const graph = createSwarm(store, {
        goal,
        workers: opts.worker.map((title) => ({ title })),
        ...(opts.verifier ? { verifierTitle: opts.verifier } : {}),
        ...(opts.synthesizer ? { synthesizerTitle: opts.synthesizer } : {}),
      });
      if (opts.json) { console.log(JSON.stringify({ graph }, null, 2)); return; }
      console.log(`Swarm created for "${goal}":`);
      console.log(`  workers: ${graph.workerIds.join(', ')}`);
      console.log(`  verifier: ${graph.verifierId} (after all workers)`);
      console.log(`  synthesizer: ${graph.synthesizerId} (after verifier)`);
    });

  fleet
    .command('link <childId> <parentId>')
    .description('Add a dependency: childId depends on parentId')
    .option('--dir <path>', 'colab dir')
    .action(async (childId: string, parentId: string, opts: { dir?: string }) => {
      const { FleetColabStore } = await import('../../fleet/colab-store.js');
      const store = new FleetColabStore({ ...(opts.dir ? { dir: opts.dir } : {}) });
      try {
        const child = store.link(childId, parentId);
        console.log(`Linked: ${childId} depends on [${(child.dependsOn ?? []).join(', ')}]`);
      } catch (error) {
        console.error(`Failed to link: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  fleet
    .command('unlink <childId> <parentId>')
    .description('Remove a dependency edge')
    .option('--dir <path>', 'colab dir')
    .action(async (childId: string, parentId: string, opts: { dir?: string }) => {
      const { FleetColabStore } = await import('../../fleet/colab-store.js');
      const removed = new FleetColabStore({ ...(opts.dir ? { dir: opts.dir } : {}) }).unlink(childId, parentId);
      console.log(removed ? `Unlinked ${childId} -/-> ${parentId}` : `No such dependency: ${childId} -> ${parentId}`);
    });

  fleet
    .command('install')
    .description('Install the autonomous daemon as an always-on systemd service (survives reboot)')
    .option('--dir <path>', 'colab queue dir (default ~/.codebuddy/fleet)')
    .option('--output-dir <path>', 'artifact dir (default <dir>/out)')
    .option('--model <model>', 'local model', 'qwen2.5:7b-instruct')
    .option('--ollama-url <url>', 'Ollama OpenAI-compatible base URL', 'http://localhost:11434/v1')
    .option('--interval <ms>', 'fallback heartbeat interval (events drive the rest)', '60000')
    .option('--executor <mode>', 'executor: "artifact" (v0, no repo edits) or "agent" (real edits; needs --workspace)', 'artifact')
    .option('--workspace <dir>', 'bounded dir the agent edits (REQUIRED for --executor agent)')
    .option('--json', 'output JSON')
    .action(async (opts: {
      dir?: string; outputDir?: string; model: string; ollamaUrl: string; interval: string;
      executor?: string; workspace?: string; json?: boolean;
    }) => {
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const { ServiceInstaller } = await import('../../daemon/service-installer.js');

      const dir = opts.dir || path.join(os.homedir(), '.codebuddy', 'fleet');
      const outputDir = opts.outputDir || path.join(dir, 'out');
      fs.mkdirSync(dir, { recursive: true });

      // Executor selection. 'agent' runs the real agent (edits files) and is
      // fail-closed: it requires an explicit bounded workspace.
      const executorMode = (opts.executor ?? 'artifact').toLowerCase();
      if (executorMode !== 'artifact' && executorMode !== 'agent') {
        console.error(`Invalid --executor "${opts.executor}" (use artifact|agent).`);
        process.exit(1);
        return;
      }
      const agentEnv: Record<string, string> = {};
      if (executorMode === 'agent') {
        if (!opts.workspace) {
          console.error('--executor agent requires --workspace <dir> (fail-closed: the bounded dir the agent edits).');
          process.exit(1);
          return;
        }
        const ws = path.resolve(opts.workspace);
        fs.mkdirSync(ws, { recursive: true });
        agentEnv['CODEBUDDY_AUTONOMY_EXECUTOR'] = 'agent';
        agentEnv['CODEBUDDY_AUTONOMY_WORKSPACE_ROOT'] = ws;
        if (opts.model === 'qwen2.5:7b-instruct') {
          console.warn('⚠️  --executor agent needs a tool-capable model; qwen2.5:7b is chat-only and cannot edit. Pass --model qwen3.6:35b-a3b-q4_K_M (or another qwen3/devstral/mistral).');
        }
      }

      // Run the built CLI from the service (rebuild dist first if it lacks the
      // autonomy command); fall back to the currently-running entry in dev.
      const distEntry = path.join(process.cwd(), 'dist', 'index.js');
      const script = fs.existsSync(distEntry) ? distEntry : process.argv[1] ?? distEntry;

      const installer = new ServiceInstaller({
        serviceName: 'codebuddy-autonomy',
        displayName: 'Code Buddy Autonomy',
        description: 'Code Buddy autonomous fleet daemon (local-first, event-driven)',
        execPath: process.execPath,
        args: [script, 'autonomy', 'run', '--watch', '--dir', dir, '--output-dir', outputDir, '--interval', String(opts.interval)],
        workingDirectory: dir,
        env: {
          HOME: os.homedir(),
          CODEBUDDY_LOCAL_MODEL: opts.model,
          OLLAMA_BASE_URL: opts.ollamaUrl,
          CODEBUDDY_FLEET_COLAB_DIR: dir,
          ...agentEnv,
        },
      });
      const result = await installer.install();
      if (opts.json) { console.log(JSON.stringify({ result, dir, outputDir, model: opts.model, executor: executorMode, ...(agentEnv['CODEBUDDY_AUTONOMY_WORKSPACE_ROOT'] ? { workspace: agentEnv['CODEBUDDY_AUTONOMY_WORKSPACE_ROOT'] } : {}) }, null, 2)); return; }
      if (!result.success) {
        console.error(`Failed to install autonomy service: ${result.error}`);
        process.exit(1);
        return;
      }
      console.log(`Autonomy service installed (${result.platform}): ${result.servicePath}`);
      console.log(`  Queue: ${dir}  |  model: ${opts.model} (local, $0)  |  executor: ${executorMode}${executorMode === 'agent' ? ` (edits ${agentEnv['CODEBUDDY_AUTONOMY_WORKSPACE_ROOT']})` : ''}`);
      console.log(`  Add work:  buddy autonomy tasks add "<title>" --dir ${dir}`);
      console.log(`  Manage:    systemctl --user status|stop|start|restart codebuddy-autonomy`);
      console.log(`  Remove:    buddy autonomy uninstall`);
    });

  fleet
    .command('service <action>')
    .description('Control the installed autonomy service: start | stop | restart | status')
    .option('--json', 'output JSON')
    .action(async (action: string, opts: { json?: boolean }) => {
      const { ServiceInstaller } = await import('../../daemon/service-installer.js');
      const installer = new ServiceInstaller({ serviceName: 'codebuddy-autonomy' });
      if (action === 'status') {
        const status = await installer.status();
        if (opts.json) { console.log(JSON.stringify({ status }, null, 2)); return; }
        console.log(`Autonomy service (${status.platform}): ${status.installed ? (status.running ? 'running' : 'installed, stopped') : 'not installed'}`);
        return;
      }
      if (action !== 'start' && action !== 'stop' && action !== 'restart') {
        console.error(`Invalid action "${action}" (use start|stop|restart|status).`);
        process.exit(1);
        return;
      }
      const result = await installer.control(action);
      if (opts.json) { console.log(JSON.stringify({ result }, null, 2)); return; }
      console.log(result.success ? `Autonomy service ${action}: ok (${result.platform})` : `Failed to ${action}: ${result.error}`);
      if (!result.success) process.exit(1);
    });

  fleet
    .command('uninstall')
    .description('Remove the autonomous daemon systemd service')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { ServiceInstaller } = await import('../../daemon/service-installer.js');
      const result = await new ServiceInstaller({ serviceName: 'codebuddy-autonomy' }).uninstall();
      if (opts.json) { console.log(JSON.stringify({ result }, null, 2)); return; }
      console.log(result.success ? `Autonomy service removed (${result.platform})` : `Failed: ${result.error}`);
      if (!result.success) process.exit(1);
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

  companion
    .command('radar')
    .description('Compare Buddy against Hermes, OpenClaw, Lisa, and companion systems')
    .option('--no-record', 'Do not write competitive radar suggestion percepts')
    .action(async (opts: { record?: boolean }) => {
      const {
        buildCompanionCompetitiveRadar,
        formatCompanionCompetitiveRadar,
      } = await import('../../companion/competitive-radar.js');
      const radar = await buildCompanionCompetitiveRadar({ recordSuggestions: opts.record !== false });
      console.log(formatCompanionCompetitiveRadar(radar));
    });

  companion
    .command('improve')
    .description('Run Buddy companion self-improvement cycle: radar, missions, and next brief')
    .option('--dry-run', 'Preview the cycle without syncing missions or writing percepts')
    .option('--no-record', 'Do not write improvement-cycle percepts or safety events')
    .option('--no-run-mission', 'Sync missions but do not prepare the next mission brief')
    .action(async (opts: { dryRun?: boolean; record?: boolean; runMission?: boolean }) => {
      const {
        formatCompanionImprovementCycle,
        runCompanionImprovementCycle,
      } = await import('../../companion/improvement-cycle.js');
      const cycle = await runCompanionImprovementCycle({
        dryRun: Boolean(opts.dryRun),
        recordSuggestions: opts.record !== false,
        runMission: opts.runMission !== false,
      });
      console.log(formatCompanionImprovementCycle(cycle));
    });

  companion
    .command('impulses')
    .alias('brief')
    .description('Build Buddy companion proactive impulses from readiness, senses, missions, and safety state')
    .option('--no-record', 'Do not write impulse suggestion percepts')
    .action(async (opts: { record?: boolean }) => {
      const {
        buildCompanionImpulseBrief,
        formatCompanionImpulseBrief,
      } = await import('../../companion/impulses.js');
      const brief = await buildCompanionImpulseBrief({ recordSuggestions: opts.record !== false });
      console.log(formatCompanionImpulseBrief(brief));
    });

  companion
    .command('check-in')
    .alias('say')
    .description('Prepare a short Buddy spoken check-in from local companion state')
    .option('--text <text>', 'Optional user text to adapt the tone')
    .option('--preview', 'Preview without writing percepts, cards, or safety events')
    .action(async (opts: { text?: string; preview?: boolean }) => {
      const {
        buildCompanionCheckIn,
        formatCompanionCheckIn,
      } = await import('../../companion/check-in.js');
      const cue = await buildCompanionCheckIn({
        userText: opts.text,
        recordPercept: !opts.preview,
        createCard: !opts.preview,
        recordSafety: !opts.preview,
      });
      console.log(formatCompanionCheckIn(cue));
    });

  const missions = companion
    .command('missions')
    .description('Manage Buddy companion self-improvement missions');

  missions
    .command('sync')
    .description('Sync the mission board from the competitive radar')
    .option('--no-record', 'Do not write a mission-board percept')
    .action(async (opts: { record?: boolean }) => {
      const {
        formatCompanionMissionBoard,
        syncCompanionMissionBoard,
      } = await import('../../companion/mission-board.js');
      const result = await syncCompanionMissionBoard({ recordSuggestions: opts.record !== false });
      console.log(`Mission board synced from ${result.radarId}.`);
      console.log(`Created: ${result.created}, updated: ${result.updated}, unchanged: ${result.unchanged}`);
      console.log('');
      console.log(formatCompanionMissionBoard(result.board));
    });

  missions
    .command('list')
    .description('List companion self-improvement missions')
    .option('--status <status>', 'Filter by status: open, in_progress, done, dismissed')
    .action(async (opts: { status?: string }) => {
      const {
        formatCompanionMissionBoard,
        readCompanionMissionBoard,
      } = await import('../../companion/mission-board.js');
      const board = await readCompanionMissionBoard();
      const filtered = opts.status
        ? {
            ...board,
            missions: board.missions.filter(mission => mission.status === opts.status),
          }
        : board;
      console.log(formatCompanionMissionBoard(filtered));
    });

  missions
    .command('run-next')
    .description('Prepare an executable brief for the next open companion mission')
    .option('--dry-run', 'Show the selected mission and brief without writing files or changing status')
    .action(async (opts: { dryRun?: boolean }) => {
      const {
        formatCompanionMissionRun,
        runNextCompanionMission,
      } = await import('../../companion/mission-runner.js');
      const result = await runNextCompanionMission({ dryRun: Boolean(opts.dryRun) });
      console.log(formatCompanionMissionRun(result));
    });

  missions
    .command('start <id>')
    .description('Mark a companion mission in progress')
    .action(async (id: string) => {
      const { updateCompanionMissionStatus } = await import('../../companion/mission-board.js');
      const mission = await updateCompanionMissionStatus(id, 'in_progress');
      console.log(`Mission started: ${mission.id}`);
    });

  missions
    .command('done <id>')
    .description('Mark a companion mission done')
    .action(async (id: string) => {
      const { updateCompanionMissionStatus } = await import('../../companion/mission-board.js');
      const mission = await updateCompanionMissionStatus(id, 'done');
      console.log(`Mission completed: ${mission.id}`);
    });

  missions
    .command('dismiss <id>')
    .description('Dismiss a companion mission')
    .action(async (id: string) => {
      const { updateCompanionMissionStatus } = await import('../../companion/mission-board.js');
      const mission = await updateCompanionMissionStatus(id, 'dismissed');
      console.log(`Mission dismissed: ${mission.id}`);
    });

  const skills = companion
    .command('skills')
    .description('Curate reviewed companion skills from repeated missions and percepts');

  skills
    .command('curate')
    .description('Refresh companion skill candidates from missions and percept patterns')
    .option('--no-record', 'Do not write a skill-curator percept')
    .action(async (opts: { record?: boolean }) => {
      const {
        curateCompanionSkills,
        formatCompanionSkillCuratorResult,
      } = await import('../../companion/skill-curator.js');
      const result = await curateCompanionSkills({ recordSuggestions: opts.record !== false });
      console.log(formatCompanionSkillCuratorResult(result));
    });

  skills
    .command('list')
    .description('List companion skill candidates')
    .action(async () => {
      const {
        formatCompanionSkillCandidates,
        readCompanionSkillCandidates,
      } = await import('../../companion/skill-curator.js');
      console.log(formatCompanionSkillCandidates(await readCompanionSkillCandidates()));
    });

  skills
    .command('promote <id>')
    .description('Promote a companion skill candidate into a workspace-local skill artifact')
    .action(async (id: string) => {
      const {
        formatCompanionSkillPromotion,
        promoteCompanionSkillCandidate,
      } = await import('../../companion/skill-curator.js');
      console.log(formatCompanionSkillPromotion(await promoteCompanionSkillCandidate(id)));
    });

  skills
    .command('dismiss <id>')
    .description('Dismiss a companion skill candidate')
    .action(async (id: string) => {
      const { dismissCompanionSkillCandidate } = await import('../../companion/skill-curator.js');
      const candidate = await dismissCompanionSkillCandidate(id);
      console.log(`Companion skill candidate dismissed: ${candidate.id}`);
    });

  const gateway = companion
    .command('gateway')
    .description('Bridge external chat channels into the companion percept and safety model');

  gateway
    .command('profile')
    .description('Show the companion gateway profile')
    .action(async () => {
      const {
        formatCompanionGatewayProfile,
        readCompanionGatewayProfile,
      } = await import('../../companion/gateway.js');
      console.log(formatCompanionGatewayProfile(await readCompanionGatewayProfile()));
    });

  gateway
    .command('enable <channel>')
    .description('Enable a companion gateway channel')
    .option('--mode <mode>', 'Gateway mode: observe, assist, act', 'observe')
    .option('--allow-outbound', 'Allow outbound messages for this channel')
    .option('--no-approval', 'Do not require approval for tool-like actions from this channel')
    .action(async (channel: string, opts: { mode: 'observe' | 'assist' | 'act'; allowOutbound?: boolean; approval?: boolean }) => {
      const {
        formatCompanionGatewayProfile,
        updateCompanionGatewayChannel,
      } = await import('../../companion/gateway.js');
      const profile = await updateCompanionGatewayChannel(channel as ChannelType, {
        enabled: true,
        mode: opts.mode,
        allowOutbound: Boolean(opts.allowOutbound),
        requireApprovalForTools: opts.approval !== false,
      });
      console.log(formatCompanionGatewayProfile(profile));
    });

  gateway
    .command('disable <channel>')
    .description('Disable a companion gateway channel')
    .action(async (channel: string) => {
      const {
        formatCompanionGatewayProfile,
        updateCompanionGatewayChannel,
      } = await import('../../companion/gateway.js');
      const profile = await updateCompanionGatewayChannel(channel as ChannelType, {
        enabled: false,
      });
      console.log(formatCompanionGatewayProfile(profile));
    });

  gateway
    .command('ingest <channel> <text>')
    .description('Record one external-channel message as a companion percept')
    .option('--sender <id>', 'Sender id', 'manual')
    .option('--sender-name <name>', 'Sender display name')
    .option('--thread <id>', 'External thread id')
    .option('--message-id <id>', 'External message id')
    .option('--content-type <type>', 'Content type: text, image, audio, voice, file', 'text')
    .action(async (channel: string, text: string, opts: {
      sender: string;
      senderName?: string;
      thread?: string;
      messageId?: string;
      contentType: string;
    }) => {
      const {
        formatCompanionGatewayMessageResult,
        recordCompanionGatewayMessage,
      } = await import('../../companion/gateway.js');
      const result = await recordCompanionGatewayMessage({
        channel: channel as ChannelType,
        text,
        senderId: opts.sender,
        senderName: opts.senderName,
        threadId: opts.thread,
        messageId: opts.messageId,
        contentType: opts.contentType as ContentType,
      });
      console.log(formatCompanionGatewayMessageResult(result));
    });

  const cards = companion
    .command('cards')
    .description('Create and inspect typed companion UI cards');

  cards
    .command('list')
    .description('List companion cards')
    .option('--status <status>', 'Filter by status: open, resolved, dismissed')
    .option('--kind <kind>', 'Filter by kind: status, approval, camera, checklist, mission, timer, weather, tool')
    .action(async (opts: { status?: string; kind?: string }) => {
      const {
        formatCompanionCards,
        readCompanionCards,
      } = await import('../../companion/cards.js');
      const store = await readCompanionCards({
        status: opts.status as CompanionCardStatus | undefined,
        kind: opts.kind as CompanionCardKind | undefined,
      });
      console.log(formatCompanionCards(store));
    });

  cards
    .command('create <kind> <title>')
    .description('Create a companion card')
    .option('--body <body>', 'Card body')
    .option('--priority <priority>', 'Priority: low, medium, high', 'medium')
    .option('--command <command>', 'Optional primary action command')
    .action(async (kind: string, title: string, opts: { body?: string; priority: string; command?: string }) => {
      const {
        createCompanionCard,
        formatCompanionCards,
        readCompanionCards,
      } = await import('../../companion/cards.js');
      const card = await createCompanionCard({
        kind: kind as CompanionCardKind,
        title,
        body: opts.body,
        priority: opts.priority as CompanionCardPriority,
        actions: opts.command ? [{ id: 'primary', label: 'Run', command: opts.command, style: 'primary' }] : [],
      });
      console.log(`Companion card created: ${card.id}`);
      console.log('');
      console.log(formatCompanionCards(await readCompanionCards({ status: 'open' })));
    });

  cards
    .command('resolve <id>')
    .description('Mark a companion card resolved')
    .action(async (id: string) => {
      const { updateCompanionCardStatus } = await import('../../companion/cards.js');
      const card = await updateCompanionCardStatus(id, 'resolved');
      console.log(`Companion card resolved: ${card.id}`);
    });

  cards
    .command('dismiss <id>')
    .description('Dismiss a companion card')
    .action(async (id: string) => {
      const { updateCompanionCardStatus } = await import('../../companion/cards.js');
      const card = await updateCompanionCardStatus(id, 'dismissed');
      console.log(`Companion card dismissed: ${card.id}`);
    });

  const safety = companion
    .command('safety')
    .description('Inspect Buddy companion safety ledger events');

  safety
    .command('recent')
    .description('Show recent companion safety ledger events')
    .option('--limit <n>', 'Maximum events to print', '10')
    .option('--kind <kind>', 'Filter by kind: sense, tool, mission, permission, data')
    .option('--risk <risk>', 'Filter by risk: low, medium, high')
    .action(async (opts: { limit: string; kind?: string; risk?: string }) => {
      const {
        formatCompanionSafetyEvents,
        readRecentCompanionSafetyEvents,
      } = await import('../../companion/safety-ledger.js');
      const events = await readRecentCompanionSafetyEvents({
        limit: parseInt(opts.limit, 10),
        kind: opts.kind as 'sense' | 'tool' | 'mission' | 'permission' | 'data' | undefined,
        risk: opts.risk as 'low' | 'medium' | 'high' | undefined,
      });
      console.log(formatCompanionSafetyEvents(events));
    });

  safety
    .command('stats')
    .description('Show companion safety ledger statistics')
    .action(async () => {
      const {
        formatCompanionSafetyLedgerStats,
        getCompanionSafetyLedgerStats,
      } = await import('../../companion/safety-ledger.js');
      console.log(formatCompanionSafetyLedgerStats(await getCompanionSafetyLedgerStats()));
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

  camera
    .command('inspect')
    .description('Inspect a camera image or capture a fresh frame and record a vision summary')
    .option('--image <path>', 'Existing image path to inspect instead of capturing a new frame')
    .option('--output <path>', 'Output path when capturing a fresh frame')
    .option('--device <device>', 'Camera device name or index')
    .option('--timeout-ms <ms>', 'Capture timeout in milliseconds', '10000')
    .option('--ocr', 'Also run OCR on the image')
    .option('--language <lang>', 'OCR language code', 'eng')
    .action(async (opts: {
      image?: string;
      output?: string;
      device?: string;
      timeoutMs: string;
      ocr?: boolean;
      language: string;
    }) => {
      const {
        formatCameraSnapshotInspection,
        inspectCameraSnapshot,
      } = await import('../../companion/camera.js');
      const result = await inspectCameraSnapshot({
        imagePath: opts.image,
        outputPath: opts.output,
        device: opts.device,
        timeoutMs: parseInt(opts.timeoutMs, 10),
        includeOcr: Boolean(opts.ocr),
        ocrLanguage: opts.language,
      });
      console.log(formatCameraSnapshotInspection(result));
      if (!result.success) process.exit(1);
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
