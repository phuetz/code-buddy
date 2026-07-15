/**
 * Skill sources — a small "referential" of named places skills can be imported
 * from. A source is a local directory or a git repo. Persisted to
 * `~/.codebuddy/skill-sources.json`. The importer resolves a source to a local
 * directory (cloning/pulling a git source into a cache) and then runs the same
 * firewall-gated import path.
 *
 * @module skills/skill-sources
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { logger } from '../utils/logger.js';

export interface SkillSource {
  name: string;
  /** Exchange registries are local directories in P0 (no network access). */
  type: 'dir' | 'exchange' | 'git';
  location: string;
}

interface SourcesFile {
  schemaVersion: 1;
  sources: SkillSource[];
}

function configPath(): string {
  return path.join(os.homedir(), '.codebuddy', 'skill-sources.json');
}

function cacheRoot(): string {
  return path.join(os.homedir(), '.codebuddy', 'skills', '.sources-cache');
}

/** Best-effort: locate the OpenClaw skills dir (it lives inside the npm global package). */
function findOpenclawSkillsDir(): string | undefined {
  const candidates: string[] = [path.join(os.homedir(), '.openclaw', 'skills')];
  const nvmRoot = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    for (const v of fs.readdirSync(nvmRoot)) {
      candidates.push(path.join(nvmRoot, v, 'lib', 'node_modules', 'openclaw', 'skills'));
    }
  } catch {
    /* no nvm */
  }
  candidates.push('/usr/local/lib/node_modules/openclaw/skills', '/usr/lib/node_modules/openclaw/skills');
  return candidates.find((c) => fs.existsSync(c));
}

function read(): SourcesFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as Partial<SourcesFile>;
    if (Array.isArray(parsed.sources)) return { schemaVersion: 1, sources: parsed.sources };
  } catch {
    /* no config yet */
  }
  // Seed known local skill repos as default `dir` sources when present.
  const seed: SkillSource[] = [];
  const hermes = path.join(os.homedir(), '.hermes', 'skills');
  if (fs.existsSync(hermes)) seed.push({ name: 'hermes', type: 'dir', location: hermes });
  const openclaw = findOpenclawSkillsDir();
  if (openclaw) seed.push({ name: 'openclaw', type: 'dir', location: openclaw });
  return { schemaVersion: 1, sources: seed };
}

function write(file: SourcesFile): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(file, null, 2), 'utf-8');
}

export function listSources(): SkillSource[] {
  return read().sources;
}

export function getSource(name: string): SkillSource | undefined {
  return read().sources.find((s) => s.name === name);
}

export function addSource(
  name: string,
  location: string,
  type: 'dir' | 'exchange' | 'git' = location.endsWith('.git') || location.includes('://') ? 'git' : 'dir',
): SkillSource {
  const file = read();
  const source: SkillSource = { name, type, location };
  file.sources = file.sources.filter((s) => s.name !== name);
  file.sources.push(source);
  write(file);
  return source;
}

export function removeSource(name: string): boolean {
  const file = read();
  const before = file.sources.length;
  file.sources = file.sources.filter((s) => s.name !== name);
  if (file.sources.length === before) return false;
  write(file);
  return true;
}

/** Resolve a source to a local directory (clone/pull a git source into the cache). */
export function resolveSourceDir(source: SkillSource): string {
  if (source.type === 'dir' || source.type === 'exchange') return source.location;
  // git: shallow clone or pull into the cache.
  const dir = path.join(cacheRoot(), source.name);
  fs.mkdirSync(cacheRoot(), { recursive: true });
  try {
    if (fs.existsSync(path.join(dir, '.git'))) {
      execFileSync('git', ['-C', dir, 'pull', '--ff-only', '--depth', '1'], { stdio: 'ignore' });
    } else {
      execFileSync('git', ['clone', '--depth', '1', source.location, dir], { stdio: 'ignore' });
    }
  } catch (err) {
    logger.warn(`skill source "${source.name}": git fetch failed — ${err instanceof Error ? err.message : String(err)}`);
  }
  return dir;
}
