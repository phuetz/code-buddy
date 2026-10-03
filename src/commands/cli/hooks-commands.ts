import { Command, Option } from 'commander';
import { importHooks, listImportedHooks, manageImportedHook } from '../../hooks/hook-importer.js';

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function registerHooksCommands(program: Command): void {
  const hooks = program.command('hooks').description('Import external hooks through the skill firewall (disabled by default)');
  hooks.command('import')
    .description('Report only by default; --apply installs disabled hooks and inert quarantine evidence')
    .addOption(new Option('--file <path>', 'Claude hooks.json or project settings.json').conflicts('dir'))
    .addOption(new Option('--dir <path>', 'Local repository with hooks/hooks.json or .claude/settings.json').conflicts('file'))
    .option('--apply', 'Install disabled hooks; never execute them')
    .action((options: { file?: string; dir?: string; apply?: boolean }) => print(importHooks(options)));
  hooks.command('imported').description('List provenance, fingerprints, state and quarantine reasons').action(() => print(listImportedHooks()));
  for (const action of ['enable', 'disable', 'remove'] as const) {
    hooks.command(`${action} <id>`).description(`${action} one imported hook (quarantine cannot be enabled)`)
      .action((id: string) => print(manageImportedHook(action, id)));
  }
}
