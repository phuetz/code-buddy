/**
 * Utility CLI commands: doctor, onboard, webhook
 *
 * Extracted from index.ts for modularity.
 */

import type { Command } from 'commander';

/**
 * Register doctor, onboard, and webhook commands on the given program
 */
export function registerUtilityCommands(program: Command): void {
  // Doctor command
  program
    .command('doctor')
    .description('Diagnose Code Buddy environment, dependencies, and configuration')
    .option('-v, --verbose', 'Show all checks including passing ones')
    .action(async (options: { verbose?: boolean }) => {
      const { runDoctorChecks } = await import('../../doctor/index.js');
      const checks = await runDoctorChecks(process.cwd());

      console.log('\n🔍 Code Buddy Doctor\n');

      const icons = { ok: '✅', warn: '⚠️', error: '❌' };

      for (const check of checks) {
        if (options.verbose || check.status !== 'ok') {
          console.log(`  ${icons[check.status]} ${check.name}: ${check.message}`);
        }
      }

      const errors = checks.filter(c => c.status === 'error').length;
      const warns = checks.filter(c => c.status === 'warn').length;
      const oks = checks.filter(c => c.status === 'ok').length;

      console.log(`\n  Summary: ${oks} passed, ${warns} warnings, ${errors} errors\n`);

      if (errors > 0) process.exit(1);
    });

  // Security Audit command
  program
    .command('security-audit')
    .description('Run a security audit of your Code Buddy environment')
    .option('--deep', 'Deep scan (git history, npm audit)')
    .option('--fix', 'Auto-fix file permission issues')
    .option('--json', 'Output as JSON')
    .action(async (options: { deep?: boolean; fix?: boolean; json?: boolean }) => {
      const { SecurityAuditor } = await import('../../security/security-audit.js');
      const auditor = new SecurityAuditor();
      const result = await auditor.audit(options.deep);

      if (options.fix) {
        const fixResult = await auditor.fix(result);
        if (!options.json) {
          console.log(`\nFixed ${fixResult.fixed} permission issue(s).`);
          for (const err of fixResult.errors) {
            console.log(`  Error: ${err}`);
          }
          console.log('');
        }
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(SecurityAuditor.formatResult(result));
      }

      if (!result.passed) process.exit(1);
    });

  // Onboard command
  program
    .command('onboard')
    .description('Interactive setup wizard for Code Buddy')
    .action(async () => {
      const { runOnboarding } = await import('../../wizard/onboarding.js');
      await runOnboarding();
    });

  // Webhook command
  const webhookCommand = program
    .command('webhook')
    .description('Manage webhook triggers');

  webhookCommand
    .command('list')
    .description('List registered webhooks')
    .action(async () => {
      const { WebhookManager } = await import('../../webhooks/webhook-manager.js');
      const mgr = new WebhookManager();
      const hooks = mgr.list();
      if (hooks.length === 0) {
        console.log('No webhooks registered.');
        return;
      }
      console.log('\nRegistered webhooks:\n');
      for (const h of hooks) {
        const status = h.enabled ? 'ON' : 'OFF';
        console.log(`  [${status}] ${h.name} (${h.id})`);
        console.log(`     Message: ${h.agentMessage}`);
        console.log(`     Secret: ${h.secret ? 'yes' : 'no'}\n`);
      }
    });

  webhookCommand
    .command('add <name> <message>')
    .description('Register a new webhook')
    .option('-s, --secret <secret>', 'HMAC secret for signature verification')
    .action(async (name: string, message: string, opts: { secret?: string }) => {
      const { WebhookManager } = await import('../../webhooks/webhook-manager.js');
      const mgr = new WebhookManager();
      const hook = mgr.register(name, message, opts.secret);
      console.log(`\nWebhook registered: ${hook.id}`);
      console.log(`Trigger URL: POST /api/webhooks/${hook.id}/trigger\n`);
    });

  webhookCommand
    .command('remove <id>')
    .description('Remove a webhook')
    .action(async (id: string) => {
      const { WebhookManager } = await import('../../webhooks/webhook-manager.js');
      const mgr = new WebhookManager();
      if (mgr.remove(id)) {
        console.log('Webhook removed.');
      } else {
        console.log('Webhook not found.');
      }
    });
}
