import path from 'node:path';
import {
  ONE_CLICK_TARGETS,
  type OneClickDeployConfig,
  type OneClickFs,
  type OneClickTarget,
} from './one-click-types.js';

export function isOneClickTarget(value: unknown): value is OneClickTarget {
  return typeof value === 'string' && (ONE_CLICK_TARGETS as readonly string[]).includes(value);
}

export function resolveInside(root: string, rel: string): string | null {
  if (!root || root.includes('\0') || rel.includes('\0')) return null;
  const resolved = path.resolve(root, rel);
  const relative = path.relative(path.resolve(root), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
}

export async function readPackageJson(
  projectRoot: string,
  fsImpl: OneClickFs,
): Promise<PackageJsonShape | null> {
  const pkgPath = path.join(projectRoot, 'package.json');
  try {
    const raw = await fsImpl.readFile(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as PackageJsonShape;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseDeployObject(raw: unknown): Partial<OneClickDeployConfig> | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const out: Partial<OneClickDeployConfig> = {};
  if (typeof obj.target === 'string') out.target = obj.target as OneClickDeployConfig['target'];
  if (typeof obj.buildScript === 'string') out.buildScript = obj.buildScript;
  if (typeof obj.outputDir === 'string') out.outputDir = obj.outputDir;
  if (typeof obj.projectName === 'string') out.projectName = obj.projectName;
  if (typeof obj.accountId === 'string') out.accountId = obj.accountId;
  if (typeof obj.siteId === 'string') out.siteId = obj.siteId;
  if (typeof obj.skipBuild === 'boolean') out.skipBuild = obj.skipBuild;
  return out;
}

export async function loadOneClickConfig(
  projectRoot: string,
  fsImpl: OneClickFs,
): Promise<{ config?: OneClickDeployConfig; error?: string; source?: string }> {
  const deployJson = resolveInside(projectRoot, path.join('.codebuddy', 'deploy.json'));
  const settingsJson = resolveInside(projectRoot, path.join('.codebuddy', 'settings.json'));
  let parsed: Partial<OneClickDeployConfig> | null = null;
  let source: string | undefined;

  if (deployJson) {
    try {
      const raw = await fsImpl.readFile(deployJson, 'utf8');
      parsed = parseDeployObject(JSON.parse(raw));
      source = '.codebuddy/deploy.json';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return { error: 'Invalid .codebuddy/deploy.json (must be JSON object).' };
      }
    }
  }

  if (!parsed && settingsJson) {
    try {
      const raw = await fsImpl.readFile(settingsJson, 'utf8');
      const settings = asRecord(JSON.parse(raw));
      parsed = parseDeployObject(settings?.deploy);
      if (parsed) source = '.codebuddy/settings.json (deploy)';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return { error: 'Invalid .codebuddy/settings.json.' };
      }
    }
  }

  if (!parsed || parsed.target === undefined) {
    return {
      error:
        'No deploy target configured. Create .codebuddy/deploy.json with "target": "cloudflare-pages" or "netlify". Nothing was sent.',
    };
  }

  if (!isOneClickTarget(parsed.target)) {
    return {
      error: `Unknown deploy target "${String(parsed.target)}". Supported: cloudflare-pages, netlify.`,
    };
  }

  const pkg = await readPackageJson(projectRoot, fsImpl);
  const outputDir = parsed.outputDir?.trim() || 'dist';
  const buildScript = parsed.buildScript?.trim();
  if (buildScript && /\s/.test(buildScript)) {
    return { error: 'buildScript must be a package.json script name, not a shell command.' };
  }

  const projectName =
    parsed.projectName?.trim() ||
    (typeof pkg?.name === 'string' ? pkg.name.replace(/^@[^/]+\//, '') : path.basename(projectRoot));

  const config: OneClickDeployConfig = {
    target: parsed.target,
    outputDir,
    skipBuild: parsed.skipBuild === true,
    projectName,
  };
  if (buildScript) config.buildScript = buildScript;
  else if (pkg?.scripts && typeof pkg.scripts.build === 'string') config.buildScript = 'build';
  if (parsed.accountId?.trim()) config.accountId = parsed.accountId.trim();
  if (parsed.siteId?.trim()) config.siteId = parsed.siteId.trim();

  return { config, source };
}

export function sanitizeProjectName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'site';
}
