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
 *   buddy skills enable <name>
 *   buddy skills disable <name>
 *
 * Selection-time enforcement of the disabled flag (so a disabled package is
 * excluded from prompt injection) reads `SkillsHub.listEnabled()`.
 */

import type { Command } from 'commander';

export function registerSkillsCommands(program: Command): void {
  const skills = program
    .command('skills')
    .description('Browse, inspect and enable/disable installed SKILL.md packages');

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

      if (opts.json) {
        console.log(JSON.stringify({ count: shown.length, total: all.length, skills: shown }, null, 2));
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
      console.log('');
    });

  skills
    .command('doctor')
    .description('Audit installed skill packages for missing or modified SKILL.md files')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { getSkillsHub } = await import('../../skills/hub.js');
      const skills = getSkillsHub().listWithIntegrity();
      const issues = skills
        .filter((skill) => !skill.exists || !skill.integrityOk)
        .map((skill) => {
          const issue = skill.exists ? 'integrity-mismatch' : 'missing-file';
          return {
            commands: issue === 'missing-file'
              ? [
                `skill_manage action=delete name=${skill.name} approved_by=<reviewer>`,
              ]
              : [
                `skill_manage action=history name=${skill.name}`,
                `skill_manage action=rollback name=${skill.name} approved_by=<reviewer>`,
              ],
            enabled: skill.enabled !== false,
            issue,
            name: skill.name,
            path: skill.path,
            recommendation: issue === 'missing-file'
              ? 'Restore the SKILL.md file or remove the stale lockfile entry after reviewer approval.'
              : 'Inspect local edits, then keep, patch, update, or rollback after reviewer approval.',
            version: skill.version,
          };
        });
      const result = {
        healthyCount: skills.length - issues.length,
        issueCount: issues.length,
        issues,
        ok: issues.length === 0,
        total: skills.length,
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
      for (const issue of issues) {
        console.log(`  ! ${issue.name} v${issue.version}: ${issue.issue}`);
        console.log(`      path: ${issue.path}`);
        console.log(`      next: ${issue.recommendation}`);
        console.log(`      command: ${issue.commands[0]}`);
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
    .command('enable <name>')
    .description('Enable an installed skill')
    .action(async (name: string) => {
      await toggleSkill(name, true);
    });

  skills
    .command('disable <name>')
    .description('Disable an installed skill (stays installed but inactive)')
    .action(async (name: string) => {
      await toggleSkill(name, false);
    });
}

async function toggleSkill(name: string, enabled: boolean): Promise<void> {
  const { getSkillsHub } = await import('../../skills/hub.js');
  const result = getSkillsHub().setEnabled(name, enabled);
  if (!result) {
    console.error(`Skill not found: ${name}`);
    process.exit(1);
    return;
  }
  console.log(`Skill ${enabled ? 'enabled' : 'disabled'}: ${name}`);
}
