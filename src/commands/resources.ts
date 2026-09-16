import fs from 'node:fs/promises';
import { Command } from 'commander';
import { ResourceCatalog, resourceSchema, selectionWarning } from '../fleet/resource-catalog.js';

export function createResourcesCommand(): Command {
  const command = new Command('resources').description('Explicit resource inventory and bounded read-only health probes (JSON output)');
  const run = (action: () => Promise<unknown>) => async () => {
    try { process.stdout.write(`${JSON.stringify(await action(), null, 2)}\n`); }
    catch (error) { command.error(error instanceof Error ? error.message : 'RESOURCE_OPERATION_FAILED'); }
  };
  command.command('schema').description('Show the resource registration fields').action(() => {
    process.stdout.write(`${JSON.stringify({ kinds: resourceSchema.shape.kind.options,
      fields: ['id', 'kind', 'hostId', 'declaredCapabilities', 'endpointRef', 'healthPath', 'permissions', 'ttlMs', 'timeoutMs'],
      endpointRef: 'Environment variable containing HTTP(S) origin; no embedded credentials, path, query or fragment',
      permissions: { probe: false, use: false }, load: 'unknown (not collected)', usageConfirmed: false }, null, 2)}\n`);
  });
  command.command('add <file>').description('Register one explicit JSON resource; never scans the network').action(async (file: string) => {
    await run(async () => {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 16384) throw new Error('RESOURCE_INPUT_TOO_LARGE');
      let input: unknown;
      try { input = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw new Error('INVALID_RESOURCE_JSON'); }
      return new ResourceCatalog().add(input);
    })();
  });
  command.command('remove <id>').description('Remove an explicit registration and its observation').action(async (id: string) => {
    await run(() => new ResourceCatalog().remove(id))();
  });
  command.command('list').description('List declarations and observation freshness; no network I/O').action(run(() => new ResourceCatalog().list()));
  command.command('status <id>').description('Read one resource state; does not refresh observations').action(async (id: string) => {
    await run(async () => {
      const result = (await new ResourceCatalog().list()).find(e => e.resource.id === id);
      if (!result) throw new Error('RESOURCE_NOT_FOUND');
      return result;
    })();
  });
  command.command('probe <id>').description('Run one explicitly permitted, bounded GET health probe').action(async (id: string) => {
    await run(() => new ResourceCatalog().probe(id))();
  });
  command.command('select <capability>').option('--kind <kind>', 'Required resource kind').description('Select fresh compatible resource; no task dispatch or automatic replay').action(async (capability: string, options: { kind?: string }) => {
    await run(async () => {
      const parsed = options.kind === undefined ? undefined : resourceSchema.shape.kind.safeParse(options.kind);
      if (parsed && !parsed.success) throw new Error('INVALID_RESOURCE_KIND');
      const result = await new ResourceCatalog().select(capability, parsed?.data);
      if (!result.selected) process.exitCode = 2;
      const warning = selectionWarning(result.selected);
      return warning ? { ...result, warning } : result;
    })();
  });
  return command;
}
