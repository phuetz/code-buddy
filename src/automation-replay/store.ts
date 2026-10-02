import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeJsonAtomic } from '../utils/atomic-write.js';
import type { Recording } from './types.js';

export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Refuse symlinked control directories, including a project's .codebuddy.
async function directory(root: string, name: string): Promise<string> {
  const target = path.join(root, name);
  await fs.mkdir(target, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  if (!(await fs.lstat(target)).isDirectory()) throw new Error('Replay directory must be a real directory');
  return target;
}

export class ReplayStore {
  constructor(private project = process.cwd(), private home = os.homedir()) {}

  private async locations(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid replay key');
    const root = await fs.realpath(this.project);
    const dir = await directory(await directory(root, '.codebuddy'), 'action-recordings');
    const trust = await directory(await directory(await fs.realpath(this.home), '.codebuddy'), 'replay-trust');
    const secretPath = path.join(trust, 'key');
    try {
      await fs.writeFile(secretPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = await fs.lstat(secretPath);
    if (!stat.isFile() || stat.size !== 32) throw new Error('Invalid replay trust key');
    return { file: path.join(dir, `${key}.json`), secret: await fs.readFile(secretPath), project: digest(root) };
  }

  async read(key: string): Promise<Recording | undefined> {
    try {
      const { file, secret, project } = await this.locations(key);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 128_000) return;
      const envelope = JSON.parse(await fs.readFile(file, 'utf8'));
      const mac = createHmac('sha256', secret).update(JSON.stringify({ key, project, recording: envelope.recording })).digest('hex');
      if (typeof envelope.mac !== 'string' || envelope.mac.length !== mac.length ||
          !timingSafeEqual(Buffer.from(mac), Buffer.from(envelope.mac))) return;
      // Only locally signed records can reach the executor. Version changes invalidate old grammars.
      const recording = envelope.recording as Recording;
      if (recording.version !== 1 || !Array.isArray(recording.steps) || recording.steps.length > 20) return;
      return recording;
    } catch { return undefined; }
  }

  async write(key: string, recording: Recording): Promise<void> {
    const { file, secret, project } = await this.locations(key);
    const mac = createHmac('sha256', secret).update(JSON.stringify({ key, project, recording })).digest('hex');
    await writeJsonAtomic(file, { recording, mac });
  }
}
