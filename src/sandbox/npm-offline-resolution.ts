/** Resolve lockfiles without giving project dependency sources host network access. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

export interface NpmCommandResult { stdout: string; stderr: string; exitCode: number }
interface Lockfile { packages?: Record<string, { resolved?: string; link?: boolean }> }
const REGISTRY = 'https://registry.npmjs.org/';

/** Foreign URLs and workspace links are opaque pins, never new resolution inputs. */
export function assertOpaqueLockEntriesUnchanged(before: Lockfile, after: Lockfile): void {
  const external = (entry: { resolved?: string }) => entry.resolved && !entry.resolved.startsWith(REGISTRY);
  for (const key of new Set([...Object.keys(before.packages ?? {}), ...Object.keys(after.packages ?? {})])) {
    const previous = before.packages?.[key]; const next = after.packages?.[key];
    if ((previous && external(previous)) || (next && external(next))) {
      if (!previous || !next || !isDeepStrictEqual(previous, next)) {
        throw new Error(`Offline lock resolution must preserve the existing external/workspace entry: ${key}`);
      }
    }
  }
}

/** Even offline npm must not read an arbitrary host file as a package source. */
export function assertNoLocalPackageSources(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const inspectSpecs = (spec: unknown): void => {
    if (typeof spec === 'string' && /(?:^|\s)(?:file|link):/i.test(spec)) {
      throw new Error('Registry lock resolution refuses file and link dependency specs');
    }
    if (spec && typeof spec === 'object') for (const nested of Object.values(spec)) inspectSpecs(nested);
  };
  for (const [key, entry] of Object.entries(value)) {
    if (['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'resolved'].includes(key)) inspectSpecs(entry);
    assertNoLocalPackageSources(entry);
  }
}

export async function resolveNpmLockOffline(
  scratch: string, npmCli: string, args: string[], signal: AbortSignal,
): Promise<NpmCommandResult> {
  if (process.platform !== 'linux') throw new Error('Offline registry resolution requires the native Linux sandbox');
  const lockPath = path.join(scratch, 'package-lock.json');
  const before = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Lockfile : {};
  const nodePrefix = path.dirname(path.dirname(fs.realpathSync(process.execPath)));
  if (nodePrefix === path.parse(nodePrefix).root) throw new Error('Node runtime prefix is too broad for offline resolution');
  const deadline = Date.now() + 120000;
  const env = { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: scratch,
    CI: 'true', NO_COLOR: '1', NPM_CONFIG_UPDATE_NOTIFIER: 'false' };
  const execute = (file: string, argv: string[], cwd = scratch) => new Promise<NpmCommandResult>((resolve, reject) => {
    execFile(file, argv, { cwd, env, encoding: 'utf8', timeout: Math.max(1, deadline - Date.now()),
      maxBuffer: 24 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') { reject(error); return; }
      resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 });
    });
  });
  // Start with an empty filesystem, not the operator's HOME. Dependency source
  // handlers cannot reach credentials or a project script, even via file URLs.
  const sandbox = ['--die-with-parent', '--unshare-net', '--unshare-pid', '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
    ...(nodePrefix === '/usr' ? [] : ['--ro-bind', nodePrefix, nodePrefix]),
    '--symlink', 'usr/bin', '/bin', '--tmpfs', '/tmp', '--bind', scratch, scratch,
    '--proc', '/proc', '--dev', '/dev', '--chdir', scratch, '--', process.execPath, npmCli];
  const metadataDirectory = path.join(scratch, 'metadata'); fs.mkdirSync(metadataDirectory);
  const cache = path.join(scratch, 'cache'); const warmed = new Set<string>();
  while (Date.now() < deadline) {
    // Offline, scripts disabled, Git disabled, no audit side request. The
    // shell's flags cannot override these final trusted options.
    const result = await execute('/usr/bin/bwrap', [...sandbox, ...args,
      '--offline', '--git=/usr/bin/false', '--audit=false', '--fetch-retries=0']);
    if (result.exitCode === 0) {
      const after = JSON.parse(fs.readFileSync(path.join(scratch, 'package-lock.json'), 'utf8')) as Lockfile;
      assertOpaqueLockEntriesUnchanged(before, after);
      return result;
    }
    if (!result.stderr.includes('ENOTCACHED')) return result;
    const logs = path.join(cache, '_logs');
    const text = result.stderr + (fs.existsSync(logs) ? fs.readdirSync(logs)
      .filter(file => file.endsWith('debug-0.log')).map(file => fs.readFileSync(path.join(logs, file), 'utf8')).join('\n') : '');
    const names = [...new Set((text.match(/https:\/\/registry\.npmjs\.org\/[^\s]+/g) ?? [])
      .filter(url => /^https:\/\/registry\.npmjs\.org\/(?:@[a-z0-9][a-z0-9._-]*%2f)?[a-z0-9][a-z0-9._-]*$/i.test(url))
      .map(url => decodeURIComponent(url.slice(REGISTRY.length))))].filter(name => !warmed.has(name));
    if (!names.length || warmed.size + names.length > 128) return result;
    // Every distinct packument is fetched once, from the fixed registry only.
    // npm view seeds the same full-metadata cache that offline Arborist reads.
    for (let index = 0; index < names.length; index += 4) {
      const batch = await Promise.allSettled(names.slice(index, index + 4).map(async name => {
        warmed.add(name);
        return execute(process.execPath, [npmCli, 'view', name, 'version', '--json',
          ...args.filter(arg => /^--(?:registry|userconfig|globalconfig|cache)=/.test(arg)),
          '--ignore-scripts', '--fetch-retries=0'], metadataDirectory);
      }));
      const cacheBytes = (directory: string): number => fs.existsSync(directory)
        ? fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
          const file = path.join(directory, entry.name);
          return total + (entry.isDirectory() ? cacheBytes(file) : fs.statSync(file).size);
        }, 0) : 0;
      if (cacheBytes(cache) > 256 * 1024 * 1024) throw new Error('Registry metadata cache exceeds 256 MiB');
      const rejected = batch.find((item): item is PromiseRejectedResult => item.status === 'rejected');
      if (rejected) throw rejected.reason;
      const failed = batch.find((item): item is PromiseFulfilledResult<NpmCommandResult> =>
        item.status === 'fulfilled' && item.value.exitCode !== 0);
      if (failed) return failed.value;
    }
  }
  throw new Error('Offline registry resolution exceeded its total deadline');
}
