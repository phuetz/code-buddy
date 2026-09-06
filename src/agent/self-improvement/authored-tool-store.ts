/**
 * Authored-tool store — durable persistence for tools the agent has authored and
 * kept (auto-apply). Without this, authored tools live only for the session; with
 * it, they are reloaded into both registries at startup so a self-improvement
 * survives a restart. A flat JSON file alongside the evolutionary archive.
 *
 * @module agent/self-improvement/authored-tool-store
 */

import fs from 'fs';
import path from 'path';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';

import type { AuthoredToolSpec } from './authored-tool-runtime.js';

export const AUTHORED_TOOL_STORE_SCHEMA_VERSION = 1;

interface StoreFile {
  schemaVersion: number;
  tools: AuthoredToolSpec[];
}

export interface AuthoredToolStoreOptions {
  workDir?: string;
}

export class AuthoredToolStore {
  private readonly filePath: string;

  constructor(options: AuthoredToolStoreOptions = {}) {
    const root = options.workDir ?? process.cwd();
    this.filePath = path.join(root, '.codebuddy', 'self-improvement', 'authored-tools.json');
  }

  get path(): string {
    return this.filePath;
  }

  private read(): StoreFile {
    try {
      const parsed = readJsonAtomicSync<Partial<StoreFile>>(this.filePath, {}, { mode: 0o600 });
      if (Array.isArray(parsed.tools)) {
        return { schemaVersion: AUTHORED_TOOL_STORE_SCHEMA_VERSION, tools: parsed.tools };
      }
    } catch {
      /* no store yet */
    }
    return { schemaVersion: AUTHORED_TOOL_STORE_SCHEMA_VERSION, tools: [] };
  }

  private write(file: StoreFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeJsonAtomicSync(this.filePath, file, { mode: 0o600 });
  }

  list(): AuthoredToolSpec[] {
    return this.read().tools;
  }

  /** Upsert a spec by name (a re-authored tool replaces the prior version). */
  add(spec: AuthoredToolSpec): void {
    const file = this.read();
    file.tools = file.tools.filter((t) => t.name !== spec.name);
    file.tools.push(spec);
    this.write(file);
  }

  remove(name: string): boolean {
    const file = this.read();
    const before = file.tools.length;
    file.tools = file.tools.filter((t) => t.name !== name);
    if (file.tools.length === before) return false;
    this.write(file);
    return true;
  }
}
