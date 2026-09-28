/** Literal, value-free package fixtures that do not justify protecting a repo. */
import fs from 'node:fs';
import path from 'node:path';
import { getHomeCredentialRoots } from './secret-files.js';

const PUBLIC_REDIS_ENV = new Set(['REDIS_HOST=127.0.0.1', 'REDIS_PORT=6379']);
const NPM_TOKEN_PLACEHOLDER = '//registry.npmjs.org/:_authToken=${NPM_TOKEN}';

function inside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

/** Git inventory still protects matching paths when they are tracked. */
export function isPublicDependencyConfig(file: string): boolean {
  const segments = path.normalize(file).split(path.sep);
  if (!segments.includes('node_modules')) return false;
  const basename = path.basename(file).toLowerCase();
  const envConfig = /^(?:\.env(?:\..+)?|.+\.env)$/.test(basename);
  if (!envConfig && basename !== '.npmrc') return false;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4_096) return false;
    const real = fs.realpathSync(file);
    if (getHomeCredentialRoots().some((root) => inside(real, root))) return false;
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('\uFFFD') || content.includes('\0')) return false;
    const lines = content.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return false;
    if (basename === '.npmrc') return lines.length === 1 && lines[0] === NPM_TOKEN_PLACEHOLDER;
    return lines.length === PUBLIC_REDIS_ENV.size &&
      new Set(lines).size === PUBLIC_REDIS_ENV.size &&
      lines.every((line) => PUBLIC_REDIS_ENV.has(line));
  } catch { return false; }
}
