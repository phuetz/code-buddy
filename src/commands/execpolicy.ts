/**
 * buddy execpolicy — CLI for the ExecPolicy command authorization system.
 *
 * Codex-inspired command execution policy management with token-array prefix
 * rules and glob/regex pattern rules.
 *
 * Subcommands:
 *   check <command>           Evaluate a command against all active rules
 *   check-argv <cmd> [args…]  Evaluate a parsed argv token array (prefix rules first)
 *   list                      List all active rules
 *   list-prefix               List prefix rules
 *   add-prefix <tokens…>      Add a prefix rule
 *   show-dangerous <command>  Check if a command matches dangerous patterns
 *   dashboard                 Show full policy dashboard
 */

import { Command } from 'commander';
import { getExecPolicy, initializeExecPolicy, PrefixRule } from '../sandbox/execpolicy.js';

export function createExecPolicyCommand(): Command {
  const cmd = new Command('execpolicy').description(
    'Manage execution policy rules — allow/deny/ask/sandbox for shell commands (Codex-inspired)'
  );

  // ── check ──────────────────────────────────────────────────────────────────
  cmd
    .command('check <command>')
    .description('Evaluate a shell command string against all active rules')
    .option('-d, --cwd <dir>', 'Working directory context', process.cwd())
    .action(async (command: string, opts: { cwd: string }) => {
      const policy = await initializeExecPolicy();
      const result = policy.evaluate(command, [], opts.cwd);
      const icon =
        result.action === 'allow' ? '✓' :
        result.action === 'deny'  ? '✗' :
        result.action === 'sandbox' ? '📦' : '?';
      console.log(`${icon} Action: ${result.action.toUpperCase()}`);
      console.log(`  Reason: ${result.reason}`);
      if (result.matchedRule) {
        console.log(`  Rule:   [${result.matchedRule.id}] ${result.matchedRule.name}`);
      }
      if (result.constraints && Object.keys(result.constraints).length > 0) {
        console.log(`  Constraints:`, JSON.stringify(result.constraints, null, 2));
      }
    });

  // ── check-argv ─────────────────────────────────────────────────────────────
  cmd
    .command('check-argv <cmd> [args...]')
    .description('Evaluate a parsed argv token array (prefix rules take priority over regex/glob)')
    .option('-d, --cwd <dir>', 'Working directory context', process.cwd())
    .action(async (cmd2: string, args: string[], opts: { cwd: string }) => {
      const policy = await initializeExecPolicy();
      const argv = [cmd2, ...args];
      const result = policy.evaluateArgv(argv, opts.cwd);
      const icon =
        result.action === 'allow' ? '✓' :
        result.action === 'deny'  ? '✗' :
        result.action === 'sandbox' ? '📦' : '?';
      console.log(`Argv: ${argv.join(' ')}`);
      console.log(`${icon} Action: ${result.action.toUpperCase()}`);
      console.log(`  Reason: ${result.reason}`);
    });

  // ── list ───────────────────────────────────────────────────────────────────
  cmd
    .command('list')
    .description('List all active policy rules')
    .option('--no-builtin', 'Hide built-in rules')
    .action(async (opts: { builtin: boolean }) => {
      const policy = await initializeExecPolicy();
      const rules = policy.getRules(opts.builtin !== false);
      if (rules.length === 0) {
        console.log('No rules found.');
        return;
      }
      console.log(`\n${'ID'.padEnd(36)} ${'ACTION'.padEnd(8)} ${'PRI'.padEnd(4)} NAME`);
      console.log('─'.repeat(80));
      for (const r of rules) {
        const status = r.enabled ? '' : ' [disabled]';
        console.log(`${r.id.padEnd(36)} ${r.action.padEnd(8)} ${String(r.priority).padEnd(4)} ${r.name}${status}`);
      }
    });

  // ── list-prefix ────────────────────────────────────────────────────────────
  cmd
    .command('list-prefix')
    .description('List token-array prefix rules')
    .action(async () => {
      const policy = await initializeExecPolicy();
      const rules = policy.getPrefixRules();
      if (rules.length === 0) {
        console.log('No prefix rules defined.');
        return;
      }
      console.log(`\n${'PREFIX TOKENS'.padEnd(40)} ${'ACTION'.padEnd(8)} ID`);
      console.log('─'.repeat(80));
      for (const r of rules) {
        const tokens = r.prefix.join(' ').padEnd(40);
        const desc = r.description ? `  # ${r.description}` : '';
        console.log(`${tokens} ${r.action.padEnd(8)} ${r.id}${desc}`);
      }
    });

  // ── add-prefix ─────────────────────────────────────────────────────────────
  cmd
    .command('add-prefix <tokens...>')
    .description('Add a token-array prefix rule (e.g. "add-prefix git push --action deny")')
    .option('-a, --action <action>', 'Action: allow|deny|ask|sandbox', 'ask')
    .option('--desc <description>', 'Human-readable description')
    .option('--disable', 'Create rule in disabled state')
    .action(async (tokens: string[], opts: { action: string; desc?: string; disable?: boolean }) => {
      const validActions = ['allow', 'deny', 'ask', 'sandbox'];
      if (!validActions.includes(opts.action)) {
        console.error(`Invalid action "${opts.action}". Must be one of: ${validActions.join(', ')}`);
        process.exit(1);
      }
      const policy = await initializeExecPolicy();
      const rule: Omit<PrefixRule, 'id' | 'createdAt'> = {
        prefix: tokens,
        action: opts.action as 'allow' | 'deny' | 'ask' | 'sandbox',
        description: opts.desc,
        enabled: !opts.disable,
      };
      const created = policy.addPrefixRule(rule);
      console.log(`✓ Added prefix rule [${created.id}]: ${tokens.join(' ')} → ${opts.action}`);
      await policy.saveRules();
    });

  // ── show-dangerous ─────────────────────────────────────────────────────────
  cmd
    .command('show-dangerous <command>')
    .description('Check if a command matches known dangerous patterns')
    .action(async (command: string) => {
      // Access dangerous pattern detection via evaluate
      const policy = await initializeExecPolicy();
      const result = policy.evaluate(command);
      if (result.action === 'deny' && result.matchedRule === null) {
        // Dangerous pattern match (no rule matched, directly denied)
        console.log(`⚠️  DANGEROUS: ${result.reason}`);
      } else if (result.action === 'deny') {
        console.log(`✗ DENIED by rule: ${result.matchedRule?.name ?? result.reason}`);
      } else {
        console.log(`✓ No dangerous pattern detected. Action: ${result.action}`);
      }
    });

  // ── dashboard ──────────────────────────────────────────────────────────────
  cmd
    .command('dashboard')
    .description('Show full execution policy dashboard')
    .action(async () => {
      const policy = await initializeExecPolicy();
      console.log(policy.formatDashboard());
      const prefixRules = policy.getPrefixRules();
      if (prefixRules.length > 0) {
        console.log(`\n🔑 Prefix Rules (${prefixRules.length})`);
        for (const r of prefixRules) {
          const status = r.enabled ? '' : ' [disabled]';
          console.log(`  ${r.prefix.join(' ')} → ${r.action}${status}`);
        }
      }
    });

  return cmd;
}
