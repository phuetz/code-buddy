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
}
