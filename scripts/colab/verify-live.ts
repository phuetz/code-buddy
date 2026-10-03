/** Foreground real-CLI verification. Invoke with one job; never reads auth state. */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ColabRunner, invokeColab, type ColabCli, type ColabJob } from '../../src/compute/colab-runner.js';

const name = process.argv[2];
const artifacts = process.argv[3];
if (!artifacts || !['images', 'failure', 'timeout', 'probe'].includes(name ?? '')) throw new Error('Usage: verify-live.ts images|failure|timeout|probe <artifact-directory>');
await mkdir(artifacts, { recursive: true });
const trace = path.join(artifacts, `${name}-calls.jsonl`);
const cli: ColabCli = async (args, options) => {
  const started = Date.now();
  await appendFile(trace, JSON.stringify({ event: 'call', args: ['--auth', 'oauth2', ...args], stdin: options?.stdin, started }) + '\n');
  try {
    const result = await invokeColab(args, options);
    await appendFile(trace, JSON.stringify({ event: 'result', command: args[0], elapsedMs: Date.now() - started, ...result }) + '\n');
    return result;
  } catch (error) {
    await appendFile(trace, JSON.stringify({ event: 'error', command: args[0], elapsedMs: Date.now() - started, error: String(error) }) + '\n');
    throw error;
  }
};
const runner = new ColabRunner({ cli });
const jobs: Record<string, ColabJob> = {
  images: { script: 'scripts/colab/diffusion-cats.py', dependencies: ['diffusers==0.35.1', 'accelerate==1.10.1', 'transformers==4.57.1'], timeoutSeconds: 900, outputDir: '_qa/colab-images' },
  failure: { script: 'scripts/colab/fail.py', timeoutSeconds: 180 },
  timeout: { script: 'scripts/colab/timeout.py', timeoutSeconds: 90 },
  probe: { script: 'scripts/colab/probe.py', timeoutSeconds: 180, outputDir: '_qa/colab-probe-traced' },
};
const before = await runner.status();
if (before.account.assignments !== 0) throw new Error('Preexisting assignments: do not start verification');
const started = Date.now();
let result: unknown, error: string | undefined;
try { result = await runner.run(jobs[name!]!); }
catch (caught) { error = String(caught); }
const after = await runner.status();
const report = { name, elapsedSeconds: (Date.now() - started) / 1000, result, error, before, after,
  measuredUnits: before.account.balance - after.account.balance };
await writeFile(path.join(artifacts, `${name}-result.json`), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
if (after.account.assignments !== 0 || !after.sessions.includes('No active sessions')) throw new Error('VM cleanup not proved');
if (name === 'failure' && !error?.includes('no completion marker')) throw new Error('Failure job did not reach intentional Python error');
if (name === 'timeout' && !error?.includes('Abort')) throw new Error('Timeout did not abort running job');
if (name !== 'failure' && name !== 'timeout' && error) throw new Error(error);
