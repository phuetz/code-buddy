/**
 * `buddy skills` — browse installed SKILL.md packages, inspect usage telemetry,
 * and enable/disable them.
 *
 * Hermes Agent treats skills as a visible, manageable capability surface
 * (`/skills`, `hermes tools`). Code Buddy already has a SkillsHub with install,
 * usage telemetry and (item 14) a review-only candidate queue; this adds the
 * operator-facing management commands:
 *
 *   buddy skills list [--json] [--all]
 *   buddy skills doctor [--json]
 *   buddy skills usage [--json]
 *   buddy skills learning-usage [--json]
 *   buddy skills update-preview <name>
 *   buddy skills update <name> --approved-by <reviewer>
 *   buddy skills patch <name> --approved-by <reviewer> --old-text <text> --new-text <text>
 *   buddy skills reset <name> --approved-by <reviewer>
 *   buddy skills enable <name> --approved-by <reviewer>
 *   buddy skills disable <name> --approved-by <reviewer>
 *   buddy skills deprecate <name> --approved-by <reviewer>
 *   buddy skills delete <name> --approved-by <reviewer>
 *   buddy skills rollback <name> --approved-by <reviewer>
 *   buddy skills tap list|add|remove|trust|refresh
 *   buddy skills well-known <url>
 *
 * Selection-time enforcement of the disabled flag (so a disabled package is
 * excluded from prompt injection) reads `SkillsHub.listEnabled()`.
 */

import type { Command } from 'commander';
import os from 'os';
import path from 'path';
import type { InstalledSkillStatus } from '../../skills/hub.js';

interface SkillDoctorIssue {
  commands: string[];
  enabled: boolean;
  issue: 'integrity-mismatch' | 'missing-file';
  name: string;
  path: string;
  preferredCommand?: string;
  recommendation: string;
  staleTempPath?: true;
  version: string;
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isStaleTempSkillPath(skill: InstalledSkillStatus): boolean {
  return !skill.exists && isPathInside(os.tmpdir(), skill.path);
}

function buildSkillDoctorIssue(skill: InstalledSkillStatus): SkillDoctorIssue {
  const issue = skill.exists ? 'integrity-mismatch' : 'missing-file';
  const staleTempPath = isStaleTempSkillPath(skill);
  const missingCommands = staleTempPath
    ? [
      `skill_manage action=delete name=${skill.name} approved_by=<reviewer>`,
      `skill_manage action=reset name=${skill.name} approved_by=<reviewer>`,
    ]
    : [
      `skill_manage action=reset name=${skill.name} approved_by=<reviewer>`,
      `skill_manage action=delete name=${skill.name} approved_by=<reviewer>`,
    ];
  return {
    commands: issue === 'missing-file'
      ? missingCommands
      : [
        `skill_manage action=history name=${skill.name}`,
        `skill_manage action=reset name=${skill.name} approved_by=<reviewer>`,
        `skill_manage action=rollback name=${skill.name} approved_by=<reviewer>`,
      ],
    enabled: skill.enabled !== false,
    issue,
    name: skill.name,
    path: skill.path,
    ...(staleTempPath ? {
      preferredCommand: `buddy skills doctor --repair-stale-temp --approved-by <reviewer> --json`,
    } : {}),
    recommendation: issue === 'missing-file'
      ? staleTempPath
        ? 'This lockfile entry points inside the OS temp directory and SKILL.md is gone; delete the stale entry after reviewer approval unless you intentionally want to reconstruct it.'
        : 'Reset from hub/cache, restore the SKILL.md file, or remove the stale lockfile entry after reviewer approval.'
      : 'Inspect local edits, then keep, patch, reset, update, or rollback after reviewer approval.',
    ...(staleTempPath ? { staleTempPath: true } : {}),
    version: skill.version,
  };
}

function buildSkillListHealth(
  all: InstalledSkillStatus[],
  shown: InstalledSkillStatus[],
): {
  disabledCount: number;
  enabledCount: number;
  healthyCount: number;
  integrityMismatchCount: number;
  issueCount: number;
  missingFileCount: number;
  nextCommand: string;
  ok: boolean;
  shownCount: number;
  staleTempMissingCount: number;
  total: number;
} {
  const missingFileCount = all.filter((skill) => !skill.exists).length;
  const staleTempMissingCount = all.filter(isStaleTempSkillPath).length;
  const integrityMismatchCount = all.filter((skill) => skill.exists && !skill.integrityOk).length;
  const issueCount = missingFileCount + integrityMismatchCount;
  return {
    disabledCount: all.filter((skill) => skill.enabled === false).length,
    enabledCount: all.filter((skill) => skill.enabled !== false).length,
    healthyCount: all.length - issueCount,
    integrityMismatchCount,
    issueCount,
    missingFileCount,
    nextCommand: issueCount > 0 ? 'buddy skills doctor --json' : 'buddy skills learning-usage --json',
    ok: issueCount === 0,
    shownCount: shown.length,
    staleTempMissingCount,
    total: all.length,
  };
}

export function registerSkillsCommands(program: Command): void {
  const skills = program
    .command('skills')
    .description('Browse, inspect and manage installed SKILL.md packages');

  skills
    .command('list')
    .description('List installed skill packages')
    .option('--all', 'include disabled skills (default: enabled only)')
    .option('--json', 'output JSON')
    .action(async (opts: { all?: boolean; json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const hub = getSkillsHub();
      const all = hub.listWithIntegrity();
      const shown = opts.all ? all : all.filter((s) => s.enabled !== false);
      const health = buildSkillListHealth(all, shown);

      if (opts.json) {
        console.log(JSON.stringify({ count: shown.length, health, total: all.length, skills: shown }, null, 2));
        return;
      }
      if (shown.length === 0) {
        console.log(all.length === 0 ? 'No skills installed.' : 'No enabled skills (use --all to see disabled).');
        return;
      }
      console.log(`\nInstalled skills (${shown.length}${opts.all ? '' : ` enabled / ${all.length} total`}):`);
      for (const skill of shown) {
        const status = skill.enabled === false ? '-' : skill.integrityOk ? '+' : '!';
        const inv = skill.usage ? `  used ${skill.usage.invocationCount}×` : '';
        const health = skill.integrityOk ? '' : skill.exists ? '  integrity mismatch' : '  missing SKILL.md';
        console.log(`  ${status} ${skill.name} v${skill.version} (${skill.source})${inv}${health}`);
      }
      if (!health.ok) {
        console.log(`\nHealth: ${health.healthyCount} ok / ${health.issueCount} issue(s). Run ${health.nextCommand}.`);
      }
      console.log('');
    });

  skills
    .command('doctor')
    .description('Audit installed skill packages for missing or modified SKILL.md files')
    .option('--repair-missing', 'remove missing-file lockfile entries after explicit reviewer approval')
    .option('--repair-stale-temp', 'remove only missing skill entries that point inside the OS temp directory')
    .option('--approved-by <reviewer>', 'reviewer/operator approving repair actions')
    .option('--json', 'output JSON')
    .action(async (opts: {
      approvedBy?: string;
      json?: boolean;
      repairMissing?: boolean;
      repairStaleTemp?: boolean;
    }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const hub = getSkillsHub();
      const skills = hub.listWithIntegrity();
      const issues = skills
        .filter((skill) => !skill.exists || !skill.integrityOk)
        .map(buildSkillDoctorIssue);
      const repairMissingRequested = opts.repairMissing === true;
      const repairStaleTempRequested = opts.repairStaleTemp === true;
      const repairRequested = repairMissingRequested || repairStaleTempRequested;
      const approvedBy = opts.approvedBy?.trim();
      if (repairMissingRequested && repairStaleTempRequested) {
        const message = 'Use either --repair-missing or --repair-stale-temp, not both';
        if (opts.json) {
          console.log(JSON.stringify({ error: message, ok: false }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
        return;
      }
      if (repairRequested && !approvedBy) {
        const message = '--approved-by is required when using repair actions';
        if (opts.json) {
          console.log(JSON.stringify({ error: message, ok: false }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
        return;
      }

      const repairedMissing = repairRequested
        ? issues
          .filter((issue) => issue.issue === 'missing-file')
          .filter((issue) => repairMissingRequested || issue.staleTempPath === true)
          .map((issue) => ({
            name: issue.name,
            removed: false,
            staleTempPath: issue.staleTempPath === true,
          }))
        : [];
      if (repairRequested) {
        for (const item of repairedMissing) {
          item.removed = hub.removeMissingSkillRecord(item.name);
        }
      }
      const inspectedAfterRepair = repairRequested ? hub.listWithIntegrity() : skills;
      const finalIssues = repairRequested
        ? inspectedAfterRepair
          .filter((skill) => !skill.exists || !skill.integrityOk)
          .map(buildSkillDoctorIssue)
        : issues;
      const result = {
        healthyCount: inspectedAfterRepair.length - finalIssues.length,
        issueCount: finalIssues.length,
        issues: finalIssues,
        ok: finalIssues.length === 0,
        ...(repairRequested ? {
          repair: {
            approvedBy,
            missingRemovedCount: repairedMissing.filter((item) => item.removed).length,
            mode: repairStaleTempRequested ? 'stale-temp' : 'missing',
            removed: repairedMissing,
            remainingIssueNames: finalIssues.map((issue) => issue.name),
            staleTempRemovedCount: repairedMissing.filter((item) => item.removed && item.staleTempPath).length,
          },
        } : {}),
        staleTempMissingCount: finalIssues.filter((issue) => issue.staleTempPath === true).length,
        total: inspectedAfterRepair.length,
      };

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (issues.length === 0) {
        console.log(`Skill package doctor: OK (${skills.length} installed).`);
        return;
      }

      console.log(`Skill package doctor: ${issues.length} issue(s) across ${skills.length} installed package(s).`);
      const staleTempIssueCount = issues.filter((issue) => issue.staleTempPath === true).length;
      if (staleTempIssueCount > 0) {
        console.log(`  ${staleTempIssueCount} missing entr${staleTempIssueCount === 1 ? 'y points' : 'ies point'} inside the OS temp directory.`);
      }
      for (const issue of issues) {
        console.log(`  ! ${issue.name} v${issue.version}: ${issue.issue}`);
        console.log(`      path: ${issue.path}`);
        console.log(`      next: ${issue.recommendation}`);
        console.log(`      command: ${issue.commands[0]}`);
      }
      if (repairRequested) {
        console.log(`\nRepaired missing lockfile entries: ${repairedMissing.filter((item) => item.removed).length}`);
        if (finalIssues.length) {
          console.log(`Remaining issues: ${finalIssues.map((issue) => issue.name).join(', ')}`);
        }
      }
    });

  skills
    .command('usage')
    .description('Show local usage telemetry, most-used first')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const summary = getSkillsHub().usageSummary();

      if (opts.json) {
        console.log(JSON.stringify({ count: summary.length, skills: summary }, null, 2));
        return;
      }
      if (summary.length === 0) {
        console.log('No skill usage recorded yet.');
        return;
      }
      console.log('\nSkill usage (most used first):');
      for (const skill of summary) {
        const u = skill.usage!;
        const avg = u.averageDurationMs !== undefined ? `, avg ${Math.round(u.averageDurationMs)}ms` : '';
        console.log(`  ${skill.name}: ${u.invocationCount} run(s), ${u.successCount} ok / ${u.failureCount} fail${avg}`);
        if (u.lastError) console.log(`      last error: ${u.lastError}`);
      }
      console.log('');
    });

  skills
    .command('learning-usage')
    .description('Show Learning Agent skill outcome telemetry')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { listLearningSkillUsage } = await import('../../agent/learning-agent.js');
      const summary = listLearningSkillUsage(process.cwd());

      if (opts.json) {
        console.log(JSON.stringify({ count: summary.length, skills: summary }, null, 2));
        return;
      }
      if (summary.length === 0) {
        console.log('No Learning Agent skill usage recorded yet.');
        return;
      }
      console.log('\nLearning Agent skill usage:');
      for (const skill of summary) {
        const avg = skill.averageDurationMs !== undefined ? `, avg ${Math.round(skill.averageDurationMs)}ms` : '';
        const flags = [
          skill.reinforced ? 'reinforced' : '',
          skill.deprecated ? 'deprecated' : '',
        ].filter(Boolean);
        console.log(`  ${skill.skillName}: ${skill.invocationCount} run(s), ${skill.successCount} ok / ${skill.failureCount} fail${avg}, score ${skill.score}/100, ${skill.recommendation}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
        console.log(`      reason: ${skill.scoreReason}`);
        console.log(`      next: ${skill.nextAction}`);
        if (skill.lastError) console.log(`      last error: ${skill.lastError}`);
      }
      console.log('');
    });

  skills
    .command('update-preview <name>')
    .description('Preview a hub-backed skill update diff without applying it')
    .option('--version <version>', 'target version to preview')
    .option('--json', 'output JSON')
    .action(async (name: string, opts: { json?: boolean; version?: string }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const preview = await getSkillsHub().previewInstalledSkillUpdate(name, {
        version: opts.version,
      });
      if (!preview) {
        const message = `Skill not found: ${name}`;
        if (opts.json) {
          console.log(JSON.stringify({ error: message, preview: null }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify(preview, null, 2));
        return;
      }
      const state = preview.updateAvailable ? 'update available' : 'no newer version';
      console.log(`${preview.name}: ${preview.fromVersion} -> ${preview.toVersion} (${state})`);
      console.log(`checksums: ${preview.currentChecksum.slice(0, 12)} -> ${preview.remoteChecksum.slice(0, 12)}`);
      const nextCommand = `buddy skills update ${preview.name} --approved-by <reviewer>${opts.version ? ` --version ${opts.version}` : ''}`;
      console.log(`next: ${nextCommand}`);
      console.log('');
      console.log(preview.diff.preview);
      if (preview.diff.truncated) {
        console.log('\n[diff preview truncated]');
      }
    });

  skills
    .command('update <name>')
    .description('Update an installed skill to a hub/cache-backed version')
    .requiredOption('--approved-by <reviewer>', 'reviewer/operator approving the update')
    .option('--reason <reason>', 'review reason')
    .option('--version <version>', 'target version to install; defaults to latest known hub/cache version')
    .option('--force', 'allow reinstalling the same or an older version')
    .option('--json', 'output JSON')
    .action(async (
      name: string,
      opts: { approvedBy: string; force?: boolean; json?: boolean; reason?: string; version?: string },
    ) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      try {
        const result = await getSkillsHub().updateInstalledSkill(name, {
          actor: opts.approvedBy,
          force: opts.force === true,
          reason: opts.reason,
          version: opts.version,
        });
        if (!result) {
          const message = `Skill not found: ${name}`;
          if (opts.json) {
            console.log(JSON.stringify({ approvedBy: opts.approvedBy, error: message, name, updated: false }, null, 2));
          } else {
            console.error(message);
          }
          process.exit(1);
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify({ ...result, approvedBy: opts.approvedBy, updated: true }, null, 2));
          return;
        }
        console.log(`Skill updated: ${result.installed.name} ${result.fromVersion} -> ${result.toVersion}`);
        console.log(`snapshot: ${result.snapshot.id}`);
      } catch (error) {
        const message = `Skill update failed: ${error instanceof Error ? error.message : String(error)}`;
        if (opts.json) {
          console.log(JSON.stringify({ approvedBy: opts.approvedBy, error: message, name, updated: false }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
      }
    });

  skills
    .command('patch <name>')
    .description('Patch text in an installed skill package')
    .requiredOption('--approved-by <reviewer>', 'reviewer/operator approving the patch')
    .requiredOption('--old-text <text>', 'text to replace')
    .requiredOption('--new-text <text>', 'replacement text')
    .option('--file-path <path>', 'file inside the skill package; defaults to SKILL.md')
    .option('--expected-replacements <count>', 'expected number of matched replacements')
    .option('--replace-all', 'replace all matches instead of requiring a unique match')
    .option('--reason <reason>', 'review reason')
    .option('--json', 'output JSON')
    .action(async (
      name: string,
      opts: {
        approvedBy: string;
        expectedReplacements?: string;
        filePath?: string;
        json?: boolean;
        newText: string;
        oldText: string;
        reason?: string;
        replaceAll?: boolean;
      },
    ) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      try {
        const expectedReplacements = parseOptionalNonNegativeInteger(
          opts.expectedReplacements,
          '--expected-replacements',
        );
        const result = getSkillsHub().patchInstalledSkill(name, opts.oldText, opts.newText, {
          actor: opts.approvedBy,
          expectedReplacements,
          filePath: opts.filePath,
          reason: opts.reason,
          replaceAll: opts.replaceAll === true,
        });
        if (!result) {
          const message = `Skill not found: ${name}`;
          if (opts.json) {
            console.log(JSON.stringify({ approvedBy: opts.approvedBy, error: message, name, patched: false }, null, 2));
          } else {
            console.error(message);
          }
          process.exit(1);
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify({ ...result, approvedBy: opts.approvedBy, patched: true }, null, 2));
          return;
        }
        console.log(`Skill patched: ${result.installed.name} ${result.filePath} replacements=${result.replacements}`);
        console.log(`snapshot: ${result.snapshot.id}`);
      } catch (error) {
        const message = `Skill patch failed: ${error instanceof Error ? error.message : String(error)}`;
        if (opts.json) {
          console.log(JSON.stringify({ approvedBy: opts.approvedBy, error: message, name, patched: false }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
      }
    });

  skills
    .command('reset <name>')
    .description('Reset an installed skill to its hub/cache-backed version')
    .requiredOption('--approved-by <reviewer>', 'reviewer/operator approving the reset')
    .option('--reason <reason>', 'review reason')
    .option('--version <version>', 'target version to reset to; defaults to installed version')
    .option('--json', 'output JSON')
    .action(async (
      name: string,
      opts: { approvedBy: string; json?: boolean; reason?: string; version?: string },
    ) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const result = await getSkillsHub().resetInstalledSkill(name, {
        actor: opts.approvedBy,
        reason: opts.reason,
        version: opts.version,
      });
      if (!result) {
        const message = `Skill not found: ${name}`;
        if (opts.json) {
          console.log(JSON.stringify({ error: message, result: null }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const recreated = result.recreated ? ' (recreated missing SKILL.md)' : '';
      console.log(`Skill reset: ${result.installed.name} ${result.fromVersion} -> ${result.toVersion}${recreated}`);
      if (result.snapshot) {
        console.log(`snapshot: ${result.snapshot.id}`);
      }
    });

  skills
    .command('enable <name>')
    .description('Enable an installed skill')
    .requiredOption('--approved-by <reviewer>', 'reviewer/operator approving the lifecycle change')
    .option('--reason <reason>', 'review reason')
    .action(async (name: string, opts: { approvedBy: string; reason?: string }) => {
      await toggleSkill(name, true, opts);
    });

  skills
    .command('disable <name>')
    .description('Disable an installed skill (stays installed but inactive)')
    .requiredOption('--approved-by <reviewer>', 'reviewer/operator approving the lifecycle change')
    .option('--reason <reason>', 'review reason')
    .action(async (name: string, opts: { approvedBy: string; reason?: string }) => {
      await toggleSkill(name, false, opts);
    });

  skills
    .command('deprecate <name>')
    .description('Deprecate an installed skill (disabled and marked deprecated)')
    .requiredOption('--approved-by <reviewer>', 'reviewer/operator approving the lifecycle change')
    .option('--reason <reason>', 'review reason')
    .action(async (name: string, opts: { approvedBy: string; reason?: string }) => {
      await toggleSkill(name, false, {
        ...opts,
        status: 'deprecated',
        verb: 'deprecated',
      });
    });

  skills
    .command('delete <name>')
    .description('Delete an installed skill package')
    .requiredOption('--approved-by <reviewer>', 'reviewer/operator approving the deletion')
    .option('--reason <reason>', 'review reason')
    .option('--json', 'output JSON')
    .action(async (name: string, opts: { approvedBy: string; json?: boolean; reason?: string }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const hub = getSkillsHub();
      const previous = hub.info(name)?.installed;
      const removed = await hub.uninstall(name);
      if (!removed) {
        const message = `Skill not found: ${name}`;
        if (opts.json) {
          console.log(JSON.stringify({ approvedBy: opts.approvedBy, error: message, name, removed: false }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify({
          approvedBy: opts.approvedBy,
          name,
          previous,
          reason: opts.reason,
          removed: true,
        }, null, 2));
        return;
      }
      console.log(`Skill deleted: ${name}`);
    });

  skills
    .command('rollback <name>')
    .description('Rollback an installed skill to a saved snapshot')
    .requiredOption('--approved-by <reviewer>', 'reviewer/operator approving the rollback')
    .option('--snapshot <id>', 'snapshot id to restore; defaults to the latest snapshot')
    .option('--reason <reason>', 'review reason')
    .option('--json', 'output JSON')
    .action(async (
      name: string,
      opts: { approvedBy: string; json?: boolean; reason?: string; snapshot?: string },
    ) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      try {
        const result = getSkillsHub().rollbackInstalledSkill(name, opts.snapshot, {
          actor: opts.approvedBy,
          reason: opts.reason,
        });
        if (!result) {
          const message = `Skill not found: ${name}`;
          if (opts.json) {
            console.log(JSON.stringify({ approvedBy: opts.approvedBy, error: message, name, rolledBack: false }, null, 2));
          } else {
            console.error(message);
          }
          process.exit(1);
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify({ ...result, approvedBy: opts.approvedBy, rolledBack: true }, null, 2));
          return;
        }
        console.log(
          `Skill rolled back: ${name} restored=${result.restoredSnapshot.id} current=${result.currentSnapshot.id}`,
        );
      } catch (error) {
        const message = `Skill rollback failed: ${error instanceof Error ? error.message : String(error)}`;
        if (opts.json) {
          console.log(JSON.stringify({ approvedBy: opts.approvedBy, error: message, name, rolledBack: false }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
      }
    });

  const tap = skills
    .command('tap')
    .description('Manage repository-backed skill taps');

  tap
    .command('list')
    .description('List configured skill taps')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const hub = getSkillsHub();
      const taps = hub.listTaps();
      const result = {
        count: taps.length,
        taps,
        tapsPath: hub.getConfig().tapsPath,
      };

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (taps.length === 0) {
        console.log(`No skill taps configured. Tap registry: ${result.tapsPath}`);
        return;
      }
      console.log(`\nSkill taps (${taps.length}):`);
      for (const item of taps) {
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
      const tap = getSkillsHub().addTap(repo, {
        actor: opts.approvedBy,
        path: opts.path,
        trust: parseTapTrust(opts.trust),
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
    .command('trust <repo> <trust>')
    .description('Set trust level for an existing skill tap')
    .option('--approved-by <reviewer>', 'reviewer/operator approving the trust change')
    .option('--json', 'output JSON')
    .action(async (
      repo: string,
      trust: string,
      opts: { approvedBy?: string; json?: boolean },
    ) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const parsedTrust = parseTapTrustRequired(trust);
      const updated = getSkillsHub().setTapTrust(repo, parsedTrust, {
        actor: opts.approvedBy,
      });
      if (!updated) {
        const message = `Skill tap not found: ${repo}`;
        if (opts.json) {
          console.log(JSON.stringify({ error: message, repo, tap: null }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify({ repo, tap: updated }, null, 2));
        return;
      }
      console.log(`Skill tap trust updated: ${updated.repo} trust=${updated.trust}`);
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

  skills
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

  // ── Import external skills (Hermes / a repository), firewall-gated ──────────
  skills
    .command('import')
    .description('Import external skills from a directory or a named source (firewall-gated)')
    .option('--dir <path>', 'import from a local directory')
    .option('--source <name>', 'import from a named source (see `skills sources`)')
    .option('--apply', 'install (default is a dry run)')
    .option('--include-review', "also import skills the firewall flags as 'review'")
    .option('--overwrite', 'overwrite an already-imported skill')
    .option('--category <c>', 'only import skills whose path contains this')
    .option('--json', 'output JSON')
    .action(async (opts: { dir?: string; source?: string; apply?: boolean; includeReview?: boolean; overwrite?: boolean; category?: string; json?: boolean }) => {
      const { importSkills } = await import('../../skills/skill-importer.js');
      const { getSource, resolveSourceDir } = await import('../../skills/skill-sources.js');
      let dir: string | undefined;
      let label = 'import';
      if (opts.dir) {
        dir = opts.dir.startsWith('~') ? path.join(os.homedir(), opts.dir.slice(1)) : opts.dir;
        label = path.basename(dir);
      } else if (opts.source) {
        const src = getSource(opts.source);
        if (!src) {
          console.log(`Unknown source: ${opts.source} (see \`buddy skills sources list\`)`);
          return;
        }
        dir = resolveSourceDir(src);
        label = src.name;
      } else {
        console.log('Specify --dir <path> or --source <name>.');
        return;
      }
      const fs = await import('fs');
      if (!fs.existsSync(dir)) {
        console.log(`Directory not found: ${dir}`);
        return;
      }
      const report = importSkills(dir, {
        source: label,
        dryRun: opts.apply !== true,
        includeReview: opts.includeReview === true,
        overwrite: opts.overwrite === true,
        ...(opts.category ? { category: opts.category } : {}),
      });
      if (opts.json) {
        console.log(JSON.stringify({ source: label, report }, null, 2));
        return;
      }
      console.log(report.dryRun ? `Dry run (use --apply to install) — "${label}"` : `Imported from "${label}"`);
      console.log(`  ${report.dryRun ? 'would import' : 'imported'}: ${report.imported.length} · quarantined: ${report.quarantined.length} · review: ${report.review.length} · skipped: ${report.skipped.length}`);
      if (report.quarantined.length) {
        console.log('  ⚠️  quarantined by firewall:');
        for (const q of report.quarantined.slice(0, 15)) console.log(`     - ${q.sourcePath}`);
      }
      if (report.imported.length) {
        console.log(`  ✓ ${report.dryRun ? 'would import' : 'imported'}:`);
        for (const s of report.imported.slice(0, 30)) console.log(`     - ${s.name}`);
      }
    });

  skills
    .command('imported')
    .description('List imported skills (with provenance + pinned status)')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const fs = await import('fs');
      const { parseSkillFile } = await import('../../skills/parser.js');
      const root = path.join(os.homedir(), '.codebuddy', 'skills', 'managed');
      const items: Array<{ name: string; pinned: boolean; source?: string }> = [];
      if (fs.existsSync(root)) {
        for (const e of fs.readdirSync(root, { withFileTypes: true })) {
          if (!e.isDirectory() || !e.name.startsWith('imported-')) continue;
          const md = path.join(root, e.name, 'SKILL.md');
          if (!fs.existsSync(md)) continue;
          let pinned = false;
          let source: string | undefined;
          try {
            const sk = parseSkillFile(fs.readFileSync(md, 'utf-8'), md, 'managed');
            pinned = sk.metadata.pinned === true;
            source = sk.metadata.source;
          } catch { /* ignore */ }
          items.push({ name: e.name, pinned, ...(source ? { source } : {}) });
        }
      }
      if (opts.json) {
        console.log(JSON.stringify({ imported: items }, null, 2));
        return;
      }
      console.log(items.length ? items.map((s) => `  ${s.pinned ? '📌' : '  '} ${s.name}${s.source ? ` (source: ${s.source})` : ''}`).join('\n') : 'No imported skills');
    });

  // ── Signed skill exchange (local-only, explicit env opt-in) ───────────────
  const exchange = skills
    .command('exchange')
    .description('Export, verify and install locally signed skill packages');

  exchange
    .command('export <name>')
    .description('Export an authored or bundled skill as a signed package')
    .option('--out <dir>', 'package registry/output directory', path.join(process.cwd(), 'skill-exchange'))
    .option('--json', 'output JSON')
    .action(async (name: string, opts: { json?: boolean; out: string }) => {
      const { exportSkill } = await import('../../skills/skill-exchange.js');
      const manifest = exportSkill(name, expandHome(opts.out));
      const packagePath = path.resolve(expandHome(opts.out), name);
      if (opts.json) {
        console.log(JSON.stringify({ manifest, path: packagePath }, null, 2));
        return;
      }
      console.log(`Exported ${manifest.name} v${manifest.version} → ${packagePath}`);
      console.log(`Author: ${manifest.author}`);
    });

  exchange
    .command('install <dir>')
    .description('Verify and install a signed skill package')
    .option('--trust', 'explicitly trust an unknown author key (TOFU)')
    .option('--json', 'output JSON')
    .action(async (dir: string, opts: { json?: boolean; trust?: boolean }) => {
      const { installSkill } = await import('../../skills/skill-exchange.js');
      const result = installSkill(expandHome(dir), { trust: opts.trust === true });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Installed ${result.name} v${result.version} from author ${result.author}`);
    });

  exchange
    .command('verify <dir>')
    .description('Verify a signed package without installing it')
    .option('--json', 'output JSON')
    .action(async (dir: string, opts: { json?: boolean }) => {
      const { verifySkill } = await import('../../skills/skill-exchange.js');
      const result = verifySkill(expandHome(dir));
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Valid signed package: ${result.name} v${result.version}`);
      console.log(`Author: ${result.author} (${result.trusted ? 'trusted' : 'not trusted'})`);
    });

  exchange
    .command('keys')
    .description('Show the local public key and trusted exchange author keys')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const exchangeModule = await import('../../skills/skill-exchange.js');
      if (!exchangeModule.isSkillExchangeEnabled()) {
        throw new Error(`Skill exchange is disabled; set ${exchangeModule.SKILL_EXCHANGE_ENV}=true to opt in`);
      }
      const signing = await import('../../skills/skill-signing.js');
      const local = { id: signing.getPublicKeyId(), publicKey: signing.getPublicKey() };
      const trusted = exchangeModule.listTrustedKeys();
      if (opts.json) {
        console.log(JSON.stringify({ local, trusted }, null, 2));
        return;
      }
      console.log(`Local public key (${local.id}):\n${local.publicKey.trim()}`);
      console.log(trusted.length
        ? `Trusted keys:\n${trusted.map((key) => `  ${key.id}  trusted ${key.trustedAt}`).join('\n')}`
        : 'Trusted keys: none');
    });

  const sources = skills.command('sources').description('Manage skill sources (the import referential)');
  sources
    .command('list')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { listSources } = await import('../../skills/skill-sources.js');
      const list = listSources();
      if (opts.json) {
        console.log(JSON.stringify({ sources: list }, null, 2));
        return;
      }
      console.log(list.length ? list.map((s) => `  ${s.name}  [${s.type}]  ${s.location}`).join('\n') : 'No skill sources configured');
    });
  sources
    .command('add <name> <location>')
    .description('Register a skill source (local dir, local exchange registry, or git url)')
    .option('--type <type>', "'dir', 'exchange', or 'git'")
    .action(async (name: string, location: string, opts: { type?: string }) => {
      const { addSource } = await import('../../skills/skill-sources.js');
      const src = addSource(name, location, parseSkillSourceType(opts.type));
      console.log(`Added source ${src.name} [${src.type}] → ${src.location}`);
    });
  sources
    .command('remove <name>')
    .action(async (name: string) => {
      const { removeSource } = await import('../../skills/skill-sources.js');
      console.log(removeSource(name) ? `Removed source ${name}` : `No such source: ${name}`);
    });
}

function expandHome(value: string): string {
  return value === '~' || value.startsWith(`~${path.sep}`)
    ? path.join(os.homedir(), value.slice(2))
    : value;
}

function parseSkillSourceType(value?: string): 'dir' | 'exchange' | 'git' | undefined {
  if (value === undefined) return undefined;
  if (value === 'dir' || value === 'exchange' || value === 'git') return value;
  throw new Error(`Invalid skill source type '${value}'. Use dir, exchange, or git.`);
}

async function toggleSkill(
  name: string,
  enabled: boolean,
  opts: { approvedBy: string; reason?: string; status?: 'active' | 'disabled' | 'deprecated'; verb?: string },
): Promise<void> {
  const { getSkillsHub } = await import('../../skills/hub.js');
  const result = getSkillsHub().setEnabled(name, enabled, {
    actor: opts.approvedBy,
    reason: opts.reason,
    status: opts.status,
  });
  if (!result) {
    console.error(`Skill not found: ${name}`);
    process.exit(1);
    return;
  }
  const verb = opts.verb ?? (enabled ? 'enabled' : 'disabled');
  console.log(`Skill ${verb}: ${name}`);
}

function parseOptionalNonNegativeInteger(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${optionName} must be a non-negative integer.`);
  }
  return Number.parseInt(value, 10);
}

function parseTapTrust(value?: string): import('../../skills/hub.js').SkillTapTrust | undefined {
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

function parseTapTrustRequired(value: string): import('../../skills/hub.js').SkillTapTrust {
  const parsed = parseTapTrust(value);
  if (!parsed) {
    throw new Error('Trust level is required.');
  }
  return parsed;
}
