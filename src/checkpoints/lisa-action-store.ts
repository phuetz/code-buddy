/** The opt-in, durable return point shared by Lisa's file-changing actions. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface LisaFileState {
  path: string;
  existed: boolean;
  content?: string;
  mode?: number;
  hash: string;
}

export interface LisaActionCheckpoint {
  id: string;
  actionId: string;
  description: string;
  origin: string;
  root: string;
  createdAt: string;
  state: 'prepared' | 'completed' | 'restored';
  before: LisaFileState[];
  after?: LisaFileState[];
}

const MAX_FILES = 32;
const MAX_BYTES = 4 * 1024 * 1024;

export function lisaUnifiedCheckpointsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_LISA_UNIFIED_CHECKPOINTS === 'true';
}

function hash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export class LisaActionStore {
  readonly root: string;
  readonly directory: string;

  constructor(root = process.cwd(), directory = path.join(os.homedir(), '.codebuddy', 'lisa', 'checkpoints')) {
    this.root = fs.realpathSync(root);
    this.directory = directory;
  }

  private safePath(input: string): string {
    const target = path.resolve(this.root, input);
    if (!within(this.root, target)) throw new Error('Action target outside workspace');
    let parent = path.dirname(target);
    while (parent !== this.root) {
      if (fs.lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error('Action target has a symbolic-link parent');
      }
      const next = path.dirname(parent);
      if (next === parent) throw new Error('Action target outside workspace');
      parent = next;
    }
    const targetStat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (targetStat && !targetStat.isFile()) {
      throw new Error('Action target is not a regular file');
    }
    return target;
  }

  private capture(input: string): LisaFileState {
    const target = this.safePath(input);
    if (!fs.lstatSync(target, { throwIfNoEntry: false })) return { path: target, existed: false, hash: '' };
    const stat = fs.lstatSync(target);
    if (stat.size > MAX_BYTES) throw new Error('Action target exceeds checkpoint limit');
    const content = fs.readFileSync(target);
    return {
      path: target,
      existed: true,
      content: content.toString('base64'),
      mode: stat.mode & 0o777,
      hash: hash(content),
    };
  }

  private checkpointPath(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid checkpoint ID');
    return path.join(this.directory, `${id}.json`);
  }

  private save(checkpoint: LisaActionCheckpoint): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const target = this.checkpointPath(checkpoint.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(checkpoint));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  prepare(actionId: string, description: string, origin: string, files: string[]): LisaActionCheckpoint {
    const unique = [...new Set(files.map(file => this.safePath(file)))];
    if (unique.length === 0 || unique.length > MAX_FILES) throw new Error('Action needs 1–32 explicit files');
    if (origin === 'initiative') {
      for (const file of unique) {
        const relative = path.relative(this.root, file).replaceAll(path.sep, '/');
        if (/^(?:\.git|\.codebuddy|src\/security|src\/checkpoints)(?:\/|$)/.test(relative) ||
            /^(?:AGENTS\.md|CLAUDE\.md|CODEBUDDY\.md|HEARTBEAT\.md)$/.test(relative) ||
            /^src\/companion\/(?:lisa-|companion-identity)/.test(relative)) {
          throw new Error('Lisa cannot modify her guardrails');
        }
      }
    }
    const before = unique.map(file => this.capture(file));
    const checkpoint: LisaActionCheckpoint = {
      id: randomUUID(), actionId, description, origin, root: this.root,
      createdAt: new Date().toISOString(), state: 'prepared', before,
    };
    this.save(checkpoint);
    return checkpoint;
  }

  complete(id: string): LisaActionCheckpoint {
    const checkpoint = this.get(id);
    if (checkpoint.state !== 'prepared') throw new Error('Checkpoint is not prepared');
    checkpoint.after = checkpoint.before.map(file => this.capture(file.path));
    checkpoint.state = 'completed';
    this.save(checkpoint);
    return checkpoint;
  }

  get(id: string): LisaActionCheckpoint {
    const checkpoint = JSON.parse(fs.readFileSync(this.checkpointPath(id), 'utf8')) as LisaActionCheckpoint;
    if (checkpoint.id !== id || checkpoint.root !== this.root || !Array.isArray(checkpoint.before)) {
      throw new Error('Checkpoint does not belong to this workspace');
    }
    return checkpoint;
  }

  list(): LisaActionCheckpoint[] {
    if (!fs.existsSync(this.directory)) return [];
    return fs.readdirSync(this.directory)
      .filter(name => /^[0-9a-f-]{36}\.json$/.test(name))
      .flatMap(name => {
        try { return [this.get(name.slice(0, -5))]; } catch { return []; }
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  restore(id: string): { restored: string[]; safetyCheckpointId: string } {
    const checkpoint = this.get(id);
    if (checkpoint.state !== 'completed' || !checkpoint.after) {
      throw new Error('Checkpoint is not completed');
    }
    // A user edit after Lisa's action must never be silently overwritten.
    for (const expected of checkpoint.after) {
      const current = this.capture(expected.path);
      if (current.existed !== expected.existed || current.hash !== expected.hash) {
        throw new Error(`File changed after action: ${path.relative(this.root, expected.path)}`);
      }
    }
    const safety = this.prepare(`undo-${checkpoint.actionId}`, `Before undo: ${checkpoint.description}`, 'undo', checkpoint.before.map(file => file.path));
    const staged: Array<{ target: string; temporary: string }> = [];
    try {
      for (const file of checkpoint.before) {
        this.safePath(file.path);
        if (!file.existed) continue;
        const content = Buffer.from(file.content ?? '', 'base64');
        if (hash(content) !== file.hash) throw new Error('Checkpoint content hash mismatch');
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        const temporary = `${file.path}.${randomUUID()}.restore`;
        fs.writeFileSync(temporary, content, { flag: 'wx', mode: file.mode ?? 0o600 });
        staged.push({ target: file.path, temporary });
      }
      for (const file of checkpoint.before) {
        const operation = staged.find(item => item.target === file.path);
        if (operation) {
          fs.renameSync(operation.temporary, operation.target);
          fs.chmodSync(operation.target, file.mode ?? 0o600);
        } else if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
      checkpoint.state = 'restored';
      this.save(checkpoint);
      this.complete(safety.id);
      return { restored: checkpoint.before.map(file => file.path), safetyCheckpointId: safety.id };
    } catch (error) {
      // Even a partially committed restore leaves a usable return point.
      this.complete(safety.id);
      throw error;
    } finally {
      for (const operation of staged) {
        if (fs.existsSync(operation.temporary)) fs.unlinkSync(operation.temporary);
      }
    }
  }
}
