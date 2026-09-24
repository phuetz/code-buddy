/**
 * CLI `buddy config` command
 *
 * Displays environment variable configuration, validation status,
 * and current values with sensitive masking.
 */

import type { Command } from 'commander';

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Show environment variable configuration and validation');

  config
    .command('show')
    .description('Show all environment variables and their values')
    .option('--category <cat>', 'Filter by category (core, provider, server, security, debug, voice, search, cache, metrics, display)')
    .action(async (opts: { category?: string }) => {
      const { getEnvSummary, ENV_SCHEMA } = await import('../../config/env-schema.js');

      if (opts.category) {
        // Filter schema to just this category for display
        const validCategories = [
          'core', 'provider', 'server', 'security', 'debug',
          'voice', 'search', 'cache', 'metrics', 'display',
        ];
        if (!validCategories.includes(opts.category)) {
          console.error(`Unknown category: ${opts.category}`);
          console.error(`Valid categories: ${validCategories.join(', ')}`);
          process.exit(1);
        }
      }

      console.log('\n' + getEnvSummary() + '\n');
    });

  config
    .command('validate')
    .description('Validate current environment configuration')
    .action(async () => {
      const { validateEnv } = await import('../../config/env-schema.js');
      const result = validateEnv();

      if (result.errors.length === 0 && result.warnings.length === 0) {
        console.log('\nEnvironment configuration is valid.\n');
        return;
      }

      if (result.errors.length > 0) {
        console.log('\nErrors:');
        for (const err of result.errors) {
          console.log(`  ! ${err}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log('\nWarnings:');
        for (const warn of result.warnings) {
          console.log(`  ? ${warn}`);
        }
      }

      console.log('');

      if (!result.valid) {
        process.exit(1);
      }
    });

  config
    .command('get <name>')
    .description('Show the value and definition of a single environment variable')
    .action(async (name: string) => {
      const { getEnvDef, maskValue } = await import('../../config/env-schema.js');
      const def = getEnvDef(name.toUpperCase());

      if (!def) {
        console.error(`Unknown environment variable: ${name}`);
        console.error('Run "buddy config show" to see all known variables.');
        process.exit(1);
      }

      const raw = process.env[def.name];
      const isSet = raw !== undefined && raw !== '';

      console.log(`\n${def.name}`);
      console.log(`  Type:        ${def.type}`);
      console.log(`  Description: ${def.description}`);
      console.log(`  Required:    ${def.required ? 'yes' : 'no'}`);
      console.log(`  Sensitive:   ${def.sensitive ? 'yes' : 'no'}`);
      console.log(`  Category:    ${def.category}`);

      if (def.default !== undefined) {
        console.log(`  Default:     ${def.default}`);
      }

      if (isSet) {
        const display = def.sensitive ? maskValue(raw) : raw;
        console.log(`  Value:       ${display}`);
      } else {
        console.log(`  Value:       (not set)`);
      }

      console.log('');
    });

  const bindMutation = (opts: { dryRun?: boolean; json?: boolean }): { dryRun: boolean; json: boolean } => ({
    dryRun: opts.dryRun === true,
    json: opts.json === true,
  });

  config
    .command('set [key] [value]')
    .description('Set a user config key outside a session. Unknown keys are refused.')
    .option('--dry-run', 'Report the change without writing')
    .option('--json', 'Print the structured report, or pass a JSON object of keys when value is omitted')
    .action(async (key: string | undefined, value: string | undefined, opts: { dryRun?: boolean; json?: boolean }) => {
      const flags = bindMutation(opts);
      const { runConfigSet, formatConfigReport } = await import('../../config/config-cli.js');
      let batch: Record<string, unknown> | undefined;
      let singleKey = key;
      let singleValue = value;
      if (flags.json && key && value === undefined && key.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(key) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('le JSON doit être un objet de clés');
          }
          batch = parsed as Record<string, unknown>;
          singleKey = undefined;
          singleValue = undefined;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(message);
          process.exitCode = 1;
          return;
        }
      }
      const report = await runConfigSet({
        ...(singleKey ? { key: singleKey } : {}),
        ...(singleValue !== undefined ? { value: singleValue } : {}),
        ...(batch ? { batch } : {}),
        dryRun: flags.dryRun,
      });
      process.stdout.write(formatConfigReport(report, flags.json));
      if (!report.ok) process.exitCode = 1;
    });

  config
    .command('patch <key> <value>')
    .description('Merge an object into the user config. Null removes a key. Scalars replace.')
    .option('--dry-run', 'Report the change without writing')
    .option('--json', 'Print the structured report')
    .action(async (key: string, value: string, opts: { dryRun?: boolean; json?: boolean }) => {
      const flags = bindMutation(opts);
      const { runConfigPatch, formatConfigReport } = await import('../../config/config-cli.js');
      const report = await runConfigPatch({ key, value, dryRun: flags.dryRun });
      process.stdout.write(formatConfigReport(report, flags.json));
      if (!report.ok) process.exitCode = 1;
    });

  config
    .command('unset <key>')
    .description('Remove a key from the user config file')
    .option('--dry-run', 'Report the change without writing')
    .option('--json', 'Print the structured report')
    .action(async (key: string, opts: { dryRun?: boolean; json?: boolean }) => {
      const flags = bindMutation(opts);
      const { runConfigUnset, formatConfigReport } = await import('../../config/config-cli.js');
      const report = await runConfigUnset({ key, dryRun: flags.dryRun });
      process.stdout.write(formatConfigReport(report, flags.json));
      if (!report.ok) process.exitCode = 1;
    });

  config
    .command('schema')
    .description('Print the JSON Schema of the TOML config and the environment variables')
    .action(async () => {
      const { runConfigSchema } = await import('../../config/config-cli.js');
      process.stdout.write(`${JSON.stringify(runConfigSchema(), null, 2)}\n`);
    });
}
