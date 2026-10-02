/**
 * A Unix socket exposes fixed npm registry operations to a networkless shell.
 * npm runs as trusted installation code in an empty scratch directory, with
 * no project scripts, user config, credentials, proxy or arbitrary URL specs.
 * The server exists only while the awaited shell invocation is running.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isPathWithin } from '../utils/path-within.js';
import { classifySecretPath } from '../security/secret-files.js';
import { capabilityAllowsSegment } from './shell-capabilities.js';

const MAX_BYTES = 24 * 1024 * 1024;
const digest = (data: string) => createHash('sha256').update(data).digest('hex');
const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

function assertRegistrySpecs(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'resolved' && typeof entry === 'string' && !entry.startsWith('https://registry.npmjs.org/')) {
      throw new Error('npm registry capability refuses non-registry lockfile URLs');
    }
    if (['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides'].includes(key)) {
      const inspect = (item: unknown): void => {
        if (typeof item === 'string' && !/^[a-z0-9.*^~+<>=| @/_-]+$/i.test(item)) throw new Error('npm registry capability refuses URL, file and Git dependency specs');
        if (typeof item === 'string' && /(?:file|git|https?|workspace):/i.test(item)) throw new Error('npm registry capability refuses external dependency specs');
        if (item && typeof item === 'object') for (const nested of Object.values(item)) inspect(nested);
      };
      inspect(entry);
    }
    assertRegistrySpecs(entry);
  }
}

export async function startNpmRegistryBroker(workspace: string, temporary: string, signal?: AbortSignal) {
  const directory = fs.mkdtempSync(path.join(temporary, 'npm-broker-'));
  const socket = path.join(directory, 'rpc.sock');
  if (Buffer.byteLength(socket) > 100) throw new Error('Session temporary path is too long for npm registry socket');
  const npmCli = fs.realpathSync(path.join(path.dirname(process.execPath), 'npm'));
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const operations = new Set<Promise<unknown>>();
  const server = http.createServer((request, response) => {
    const operation = (async () => {
      try {
        if (request.method !== 'POST' || request.url !== '/npm') throw new Error('Registry broker endpoint denied');
        const parts: Buffer[] = []; let size = 0;
        for await (const part of request) {
          size += part.length;
          if (size > 8192) throw new Error('Registry broker request exceeds limit');
          parts.push(part);
        }
        const argv: unknown = JSON.parse(Buffer.concat(parts).toString());
        if (!Array.isArray(argv) || argv.length > 32 || !argv.every(arg => typeof arg === 'string')
          || !['audit', 'view', 'pack', 'install', 'update'].includes(argv[0] ?? '')
          || !capabilityAllowsSegment(['npm', ...argv])) throw new Error('Registry operation not granted');
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-registry-'));
        try {
          const packagePath = path.join(workspace, 'package.json');
          const lockPath = path.join(workspace, 'package-lock.json');
          for (const file of [packagePath, lockPath]) {
            if (fs.existsSync(file) && (!isPathWithin(fs.realpathSync(file), fs.realpathSync(workspace)) || classifySecretPath(file).secret)) {
              throw new Error('Registry broker input must be a non-secret workspace file');
            }
          }
          const packageText = fs.readFileSync(packagePath, 'utf8');
          const lockText = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : '';
          const packageData = JSON.parse(packageText) as Record<string, unknown>;
          // npm install is allowed to resolve metadata, never to execute scripts.
          delete packageData.scripts;
          if (argv[0] !== 'audit') delete packageData.workspaces;
          if (!['audit', 'view', 'pack'].includes(argv[0] ?? '')) {
            assertRegistrySpecs(packageData);
            if (lockText) assertRegistrySpecs(JSON.parse(lockText));
          }
          fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify(packageData));
          if (lockText) fs.writeFileSync(path.join(scratch, 'package-lock.json'), lockText);
          if (argv[0] === 'audit' && packageData.workspaces && lockText) {
            const lock = JSON.parse(lockText) as { packages?: Record<string, unknown> };
            for (const key of Object.keys(lock.packages ?? {})) {
              if (!key || key.split('/').includes('node_modules')) continue;
              const manifest = path.join(workspace, key, 'package.json');
              if (!fs.existsSync(manifest) || !isPathWithin(fs.realpathSync(manifest), fs.realpathSync(workspace))
                || classifySecretPath(manifest).secret) throw new Error('Workspace audit manifest is unavailable or outside the allowed workspace');
              const data = JSON.parse(fs.readFileSync(manifest, 'utf8')) as Record<string, unknown>;
              delete data.scripts;
              const destination = path.resolve(scratch, key, 'package.json');
              if (!isPathWithin(destination, scratch)) throw new Error('Workspace lock path escapes scratch');
              fs.mkdirSync(path.dirname(destination), { recursive: true });
              fs.writeFileSync(destination, JSON.stringify(data));
            }
          }

          const args = [...argv, '--ignore-scripts', '--registry=https://registry.npmjs.org',
            '--userconfig=' + path.join(scratch, 'empty-user.npmrc'), '--globalconfig=' + path.join(scratch, 'empty-global.npmrc'), '--cache=' + path.join(scratch, 'cache')];
          const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
            execFile(process.execPath, [npmCli, ...args], {
              cwd: scratch, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: scratch,
                CI: 'true', NO_COLOR: '1', NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
              timeout: 120000, maxBuffer: MAX_BYTES, signal: controller.signal,
            }, (error, stdout, stderr) => {
              if (error && typeof error.code !== 'number') { reject(error); return; }
              resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 });
            });
          });
          if (result.exitCode === 0 && ['install', 'update'].includes(argv[0] ?? '')) {
            if (digest(fs.readFileSync(packagePath, 'utf8')) !== digest(packageText)
              || (fs.existsSync(lockPath) ? digest(fs.readFileSync(lockPath, 'utf8')) : '') !== (lockText ? digest(lockText) : '')) {
              throw new Error('Workspace changed during lock resolution; refusing stale write');
            }
            fs.writeFileSync(lockPath, fs.readFileSync(path.join(scratch, 'package-lock.json')));
          }
          if (result.exitCode === 0 && argv[0] === 'pack') {
            const archives = fs.readdirSync(scratch).filter(file => file.endsWith('.tgz'));
            if (archives.length !== 1) throw new Error('Registry pack must produce exactly one archive');
            const filename = archives[0]!;
            const archive = path.join(scratch, filename);
            if (!/^[a-z0-9._-]+\.tgz$/i.test(filename) || !fs.lstatSync(archive).isFile()
              || fs.statSync(archive).size > 64 * 1024 * 1024) throw new Error('Registry archive is invalid or too large');
            // A downloaded artifact stays in the operator-granted session scratch.
            fs.copyFileSync(archive, path.join(temporary, filename), fs.constants.COPYFILE_EXCL);
          }
          response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result));
        } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
      } catch (error) {
        response.statusCode = 403;
        response.end(JSON.stringify({ exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));
      }
    })();
    operations.add(operation); void operation.finally(() => operations.delete(operation));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  fs.chmodSync(socket, 0o600);
  const client = path.join(directory, 'npm-client.mjs');
  fs.writeFileSync(client, `import http from 'node:http';
import {spawn} from 'node:child_process';
const argv=process.argv.slice(2);
if (!['audit','view','pack','install','update'].includes(argv[0] ?? '')) {
 const child=spawn(${JSON.stringify(process.execPath)},[${JSON.stringify(npmCli)},...argv],{stdio:'inherit'});
 child.on('close',(code)=>{process.exitCode=code??1});child.on('error',(error)=>{process.stderr.write(error.message);process.exitCode=1});
} else {
 const request=http.request({socketPath:${JSON.stringify(socket)},path:'/npm',method:'POST'},response=>{
 let text='';response.on('data',part=>text+=part);response.on('end',()=>{
 try {const result=JSON.parse(text);process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.exitCode}
 catch(error){process.stderr.write(error.message);process.exitCode=1}
 });});
 request.on('error',error=>{process.stderr.write(error.message);process.exitCode=1});request.end(JSON.stringify(argv));
}
`);
  fs.writeFileSync(path.join(directory, 'npm'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(client)} "$@"\n`, { mode: 0o755 });
  return {
    directory,
    async close() {
      controller.abort(); signal?.removeEventListener('abort', abort);
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await Promise.allSettled([...operations]);
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}
