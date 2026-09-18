/**
 * Provision database + authentication for a generated web project.
 *
 * Default is simulation (prints the files and migrations that would be written).
 * `--apply` writes locally. A hosted Supabase project is never created.
 *
 * Usage:
 *   buddy provision db-auth --target local --dir /path/to/app --name my-app
 *   buddy provision db-auth --target supabase --dir /path/to/app --name my-app --apply
 */

import { Command } from 'commander';
import path from 'node:path';
import { logger } from '../../utils/logger.js';
import {
  assertNoSecretLeak,
  formatProvisionPlan,
  provisionDbAuth,
  type ProvisionTarget,
} from '../../templates/db-auth/index.js';
import { ProvisionError } from '../../templates/db-auth/types.js';

function writeLine(line: string): void {
  logger.info(line);
}

export function registerProvisionCommands(program: Command): void {
  const provision = program
    .command('provision')
    .description('Provision database and authentication onto a generated web project');

  provision
    .command('db-auth')
    .description(
      'Overlay versioned SQL, a typed client, and sign-up/sign-in/sign-out pages (simulation by default)',
    )
    .requiredOption('--target <supabase|local>', 'Backend: hosted Supabase (CLI+token required) or local Postgres container')
    .option('--dir <path>', 'Generated web project directory', '.')
    .option('--name <slug>', 'Project slug (default: directory basename)')
    .option('--apply', 'Write files (default: simulation / dry-run)', false)
    .option('--json', 'Print the plan as JSON (secret file bodies omitted)', false)
    .option('--supabase-cli <bin>', 'Supabase CLI executable name', 'supabase')
    .option(
      '--token-env <name>',
      'Environment variable that holds the Supabase access token (value never passed as a flag)',
      'SUPABASE_ACCESS_TOKEN',
    )
    .action(async (opts: {
      target: string;
      dir: string;
      name?: string;
      apply?: boolean;
      json?: boolean;
      supabaseCli?: string;
      tokenEnv?: string;
    }) => {
      const target = opts.target as ProvisionTarget;
      const projectDir = path.resolve(opts.dir);
      const projectName = opts.name ?? path.basename(projectDir);
      try {
        const plan = await provisionDbAuth({
          target,
          projectDir,
          projectName,
          apply: opts.apply === true,
          supabaseCli: opts.supabaseCli,
          tokenEnvVar: opts.tokenEnv,
        });
        const rendered = opts.json
          ? JSON.stringify(
            {
              mode: plan.mode,
              target: plan.target,
              projectName: plan.projectName,
              projectDir: plan.projectDir,
              written: plan.written,
              migrations: plan.migrations,
              files: plan.files.map((item) => ({
                path: item.path,
                action: item.action,
                secret: item.secret === true,
              })),
              warnings: plan.warnings,
              nextSteps: plan.nextSteps,
            },
            null,
            2,
          )
          : formatProvisionPlan(plan);
        assertNoSecretLeak(rendered, process.env);
        for (const line of rendered.split('\n')) {
          writeLine(line);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        assertNoSecretLeak(message, process.env);
        if (error instanceof ProvisionError) {
          logger.error(message, { code: error.code });
        } else {
          logger.error(message);
        }
        process.exitCode = 1;
      }
    });
}
