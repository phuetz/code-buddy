import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  AgentBaseCodeBuddyImportCandidate,
  AgentBaseCodeBuddyImportSource,
} from '../../shared/agentbase-types';
import type { MCPServerConfig } from './mcp-manager';

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_SERVERS = 128;
const MAX_NAME = 100;
const MAX_COMMAND = 4096;
const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT = 8192;
const ENV_KEY = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const SECRET_KEY = /(token|secret|password|api.?key|authorization|cookie|credential)/iu;
const ENV_REFERENCE = /^\$\{([A-Z_][A-Z0-9_]*)\}$/u;
const SAFE_LITERAL_ENV_KEY = /^(?:LOG_LEVEL|NODE_ENV|DEBUG|NO_COLOR|FORCE_COLOR|PUBCOMMANDER_MCP_MODULES|TEST_ENV)$/u;
const SECRET_ARGUMENT_KEY = /(token|secret|password|passphrase|api.?key|authorization|cookie|credential)/iu;
const SECRET_ASSIGNMENT = /(^|[?&;,\s])([^?&;,\s=:/]*(?:token|secret|password|passphrase|api.?key|authorization|cookie|credential)[^?&;,\s=:]*)\s*[:=]\s*([^\s,;&]+)/iu;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/iu;

interface ScannedCandidate {
  preview: AgentBaseCodeBuddyImportCandidate;
  config?: MCPServerConfig;
}

export interface CodeBuddyMcpDiscoveryOptions {
  workspaceRoots: string[];
  homeDir: string;
  configuredServers: MCPServerConfig[];
}

export interface CodeBuddyMcpDiscovery {
  candidates: AgentBaseCodeBuddyImportCandidate[];
  warnings: string[];
}

/**
 * Discover existing Code Buddy MCP entries without executing them or exposing
 * environment values to the renderer. Project entries win over user entries,
 * matching the core CLI's configuration priority.
 */
export function discoverCodeBuddyMcpImports(
  options: CodeBuddyMcpDiscoveryOptions,
): CodeBuddyMcpDiscovery {
  const scanned = scan(options);
  return {
    candidates: scanned.candidates.map((candidate) => candidate.preview),
    warnings: scanned.warnings,
  };
}

/** Re-scan at import time so the renderer can never supply a command/config. */
export function materializeCodeBuddyMcpImport(
  options: CodeBuddyMcpDiscoveryOptions,
  candidateId: string,
): MCPServerConfig {
  if (typeof candidateId !== 'string' || candidateId.length > 160) {
    throw new Error('Code Buddy MCP import id is invalid.');
  }
  const candidate = scan(options).candidates.find((entry) => entry.preview.id === candidateId);
  if (!candidate) throw new Error('Code Buddy MCP import candidate no longer exists.');
  if (!candidate.preview.importable || !candidate.config) {
    throw new Error(candidate.preview.issue ?? 'Code Buddy MCP entry cannot be imported safely.');
  }
  if (candidate.preview.alreadyConfigured) {
    throw new Error('This MCP connector is already configured in Cowork.');
  }
  // Imported project commands are always disabled. The user must inspect and
  // enable them through the existing MCP settings before a child process or
  // network connection can start.
  return structuredClone({ ...candidate.config, enabled: false });
}

function scan(options: CodeBuddyMcpDiscoveryOptions): {
  candidates: ScannedCandidate[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const existingNames = new Set(
    options.configuredServers.map((server) => server.name.trim().toLocaleLowerCase()),
  );
  const seenNames = new Set<string>();
  const candidates: ScannedCandidate[] = [];
  const sources: Array<{ root: string; source: AgentBaseCodeBuddyImportSource }> = [];

  for (const workspaceRoot of options.workspaceRoots) {
    if (typeof workspaceRoot === 'string' && workspaceRoot.trim()) {
      sources.push({ root: workspaceRoot, source: 'project' });
    }
  }
  sources.push({ root: options.homeDir, source: 'user' });

  for (const source of sources) {
    const file = readSafeConfig(source.root, source.source, warnings);
    if (!file) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.contents) as unknown;
    } catch {
      warnings.push(`${source.source}: configuration MCP illisible ou JSON invalide.`);
      continue;
    }
    const record = asRecord(parsed);
    const rawServers = asRecord(record?.mcpServers) ?? asRecord(record?.servers);
    if (!rawServers) {
      warnings.push(`${source.source}: aucune table mcpServers/servers valide.`);
      continue;
    }
    const entries = Object.entries(rawServers).slice(0, MAX_SERVERS);
    if (Object.keys(rawServers).length > MAX_SERVERS) {
      warnings.push(`${source.source}: seuls les ${MAX_SERVERS} premiers serveurs sont affichés.`);
    }
    for (const [entryName, raw] of entries) {
      const name = cleanText(asRecord(raw)?.name ?? entryName, MAX_NAME);
      if (!name) continue;
      const key = name.toLocaleLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      candidates.push(parseCandidate({
        raw,
        name,
        root: source.root,
        source: source.source,
        existing: existingNames.has(key),
      }));
    }
  }
  return { candidates, warnings };
}

function parseCandidate(input: {
  raw: unknown;
  name: string;
  root: string;
  source: AgentBaseCodeBuddyImportSource;
  existing: boolean;
}): ScannedCandidate {
  const raw = asRecord(input.raw);
  const transportRecord = asRecord(raw?.transport) ?? raw;
  const rawType = cleanText(transportRecord?.type ?? raw?.type, 40)?.toLocaleLowerCase();
  const type = normalizeTransport(rawType);
  const id = `codebuddy-mcp:${createHash('sha256')
    .update(`${input.source}\0${resolve(input.root)}\0${input.name}\0${JSON.stringify(raw)}`)
    .digest('hex')
    .slice(0, 24)}`;
  const description = cleanText(raw?.description, 500);
  const enabledInSource = raw?.enabled !== false;
  const argsResult = cleanArgs(transportRecord?.args ?? raw?.args);
  const envResult = cleanEnvironment(transportRecord?.env ?? raw?.env);
  const basePreview = {
    id,
    name: input.name,
    ...(description ? { description: redactSecretText(description).value } : {}),
    source: input.source,
    transport: type,
    args: argsResult.previewArgs,
    envKeys: envResult.envKeys,
    secretEnvKeys: envResult.secretEnvKeys,
    enabledInSource,
    alreadyConfigured: input.existing,
  } satisfies Omit<AgentBaseCodeBuddyImportCandidate, 'importable'>;

  if (!raw || argsResult.error || envResult.error || argsResult.containsSecret) {
    const issue = argsResult.error
      ?? envResult.error
      ?? (argsResult.containsSecret
        ? 'Des arguments contiennent une valeur secrète littérale ; utilise une variable d’environnement avant import.'
        : 'Entrée MCP invalide.');
    return { preview: { ...basePreview, importable: false, issue } };
  }
  if (type !== 'stdio') {
    const url = cleanUrl(transportRecord?.url ?? raw.url);
    return {
      preview: {
        ...basePreview,
        ...(url ? { url } : {}),
        importable: false,
        issue: 'Les transports réseau doivent être configurés dans Cowork avec leur OAuth ou leurs en-têtes relus.',
      },
    };
  }
  const command = cleanText(transportRecord?.command ?? raw.command, MAX_COMMAND);
  if (!command) {
    return {
      preview: { ...basePreview, importable: false, issue: 'Commande stdio absente ou invalide.' },
    };
  }
  const commandPreview = redactSecretText(command);
  if (commandPreview.containsSecret) {
    return {
      preview: {
        ...basePreview,
        command: commandPreview.value,
        importable: false,
        issue: 'La commande contient une valeur secrète littérale et ne peut pas être importée.',
      },
    };
  }
  const cwd = cleanCwd(transportRecord?.cwd ?? raw.cwd, input.root);
  if (cwd.error) {
    return {
      preview: { ...basePreview, command, importable: false, issue: cwd.error },
    };
  }
  const config: MCPServerConfig = {
    id: `codebuddy-${slug(input.name)}-${id.slice(-8)}`,
    name: input.name,
    type: 'stdio',
    command,
    args: argsResult.args,
    ...(Object.keys(envResult.safeEnv).length > 0 ? { env: envResult.safeEnv } : {}),
    ...(cwd.value ? { cwd: cwd.value } : {}),
    enabled: false,
  };
  return {
    preview: { ...basePreview, command, importable: true },
    config,
  };
}

function readSafeConfig(
  root: string,
  source: AgentBaseCodeBuddyImportSource,
  warnings: string[],
): { path: string; contents: string } | null {
  let descriptor: number | null = null;
  try {
    const canonicalRoot = realpathSync(root);
    const codeBuddyDir = join(canonicalRoot, '.codebuddy');
    const file = join(codeBuddyDir, 'mcp.json');
    let dirInfo;
    let fileInfo;
    try {
      dirInfo = lstatSync(codeBuddyDir);
      fileInfo = lstatSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) {
      throw new Error('.codebuddy n’est pas un dossier réel');
    }
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile() || fileInfo.size > MAX_CONFIG_BYTES) {
      throw new Error('mcp.json est un lien, un fichier invalide ou dépasse 1 Mio');
    }
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const openedBefore = fstatSync(descriptor);
    if (!openedBefore.isFile() || openedBefore.size > MAX_CONFIG_BYTES) {
      throw new Error('mcp.json ouvert est invalide ou dépasse 1 Mio');
    }
    const canonicalFile = realpathSync(file);
    if (!isDescendant(canonicalRoot, canonicalFile)) {
      throw new Error('mcp.json sort de sa racine autorisée');
    }
    const currentFile = lstatSync(file);
    const currentDir = lstatSync(codeBuddyDir);
    if (currentFile.isSymbolicLink() || currentDir.isSymbolicLink()
      || !sameFileIdentity(openedBefore, currentFile)
      || !sameFileIdentity(dirInfo, currentDir)) {
      throw new Error('mcp.json ou son dossier a changé pendant la vérification');
    }
    const contents = readFileSync(descriptor, 'utf8');
    const openedAfter = fstatSync(descriptor);
    const pathAfter = lstatSync(file);
    if (Buffer.byteLength(contents) > MAX_CONFIG_BYTES
      || !sameFileIdentity(openedBefore, openedAfter)
      || !sameFileIdentity(openedAfter, pathAfter)
      || openedBefore.size !== openedAfter.size
      || openedBefore.mtimeMs !== openedAfter.mtimeMs
      || openedBefore.ctimeMs !== openedAfter.ctimeMs) {
      throw new Error('mcp.json a changé pendant sa lecture');
    }
    closeSync(descriptor);
    descriptor = null;
    return { path: canonicalFile, contents };
  } catch (error) {
    warnings.push(`${source}: ${error instanceof Error ? error.message : String(error)}.`);
    return null;
  } finally {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch { /* best effort */ }
    }
  }
}

function cleanArgs(value: unknown): {
  args: string[];
  previewArgs: string[];
  containsSecret: boolean;
  error?: string;
} {
  if (value === undefined) return { args: [], previewArgs: [], containsSecret: false };
  if (!Array.isArray(value) || value.length > MAX_ARGUMENTS) {
    return { args: [], previewArgs: [], containsSecret: false, error: `Liste d’arguments invalide ou supérieure à ${MAX_ARGUMENTS}.` };
  }
  const args: string[] = [];
  const previewArgs: string[] = [];
  let containsSecret = false;
  let previousSecretFlag = false;
  for (const entry of value) {
    if (typeof entry !== 'string' || hasControlCharacter(entry) || entry.length > MAX_ARGUMENT) {
      return { args: [], previewArgs: [], containsSecret: false, error: 'Un argument MCP est invalide ou trop long.' };
    }
    args.push(entry);
    const secretFlag = /^--?[A-Za-z0-9_.-]+$/u.test(entry) && SECRET_ARGUMENT_KEY.test(entry);
    if (previousSecretFlag && !ENV_REFERENCE.test(entry)) {
      previewArgs.push('[REDACTED]');
      containsSecret = true;
    } else {
      const redacted = redactSecretText(entry);
      previewArgs.push(redacted.value);
      containsSecret ||= redacted.containsSecret;
    }
    previousSecretFlag = secretFlag;
  }
  return { args, previewArgs, containsSecret };
}

function cleanEnvironment(value: unknown): {
  safeEnv: Record<string, string>;
  envKeys: string[];
  secretEnvKeys: string[];
  error?: string;
} {
  if (value === undefined) return { safeEnv: {}, envKeys: [], secretEnvKeys: [] };
  const record = asRecord(value);
  if (!record || Object.keys(record).length > 128) {
    return { safeEnv: {}, envKeys: [], secretEnvKeys: [], error: 'Environnement MCP invalide.' };
  }
  const safeEnv: Record<string, string> = {};
  const envKeys: string[] = [];
  const secretEnvKeys: string[] = [];
  for (const [key, rawValue] of Object.entries(record)) {
    if (!ENV_KEY.test(key) || typeof rawValue !== 'string' || rawValue.length > MAX_ARGUMENT) {
      return { safeEnv: {}, envKeys: [], secretEnvKeys: [], error: 'Variable d’environnement MCP invalide.' };
    }
    envKeys.push(key);
    const reference = rawValue.match(ENV_REFERENCE)?.[1];
    if (SECRET_KEY.test(key) || reference || !SAFE_LITERAL_ENV_KEY.test(key) || !isSafeLiteralEnvironmentValue(key, rawValue)) {
      secretEnvKeys.push(key);
      // Cowork inherits the process/login-shell environment. Omitting a
      // ${VAR} reference avoids persisting the resolved secret in electron-store.
      continue;
    }
    safeEnv[key] = rawValue;
  }
  return { safeEnv, envKeys, secretEnvKeys };
}

function cleanCwd(value: unknown, sourceRoot: string): { value?: string; error?: string } {
  if (value === undefined) return { value: realpathSync(sourceRoot) };
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    return { error: 'Dossier de travail MCP invalide.' };
  }
  const root = realpathSync(sourceRoot);
  const requested = isAbsolute(value) ? resolve(value) : resolve(root, value);
  if (!isDescendant(root, requested)) {
    return { error: 'Le dossier de travail MCP n’existe pas ou sort de la racine de sa configuration.' };
  }
  try {
    requireNoSymlinkDescendants(root, requested);
  } catch {
    return { error: 'Le dossier de travail MCP contient un lien symbolique ou n’existe pas.' };
  }
  const canonical = realpathSync(requested);
  if (!isDescendant(root, canonical) || !lstatSync(requested).isDirectory()) {
    return { error: 'Le dossier de travail MCP sort de la racine de sa configuration.' };
  }
  return { value: canonical };
}

function normalizeTransport(value: string | undefined): AgentBaseCodeBuddyImportCandidate['transport'] {
  if (value === 'stdio' || value === 'sse' || value === 'streamable-http') return value;
  if (value === 'http') return 'streamable-http';
  return 'unsupported';
}

function cleanUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_COMMAND) return undefined;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function cleanText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string' || value.includes('\0')) return undefined;
  const cleaned = value.replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim();
  return cleaned && cleaned.length <= maximum ? cleaned : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function redactSecretText(value: string): { value: string; containsSecret: boolean } {
  let containsSecret = false;
  let redacted = value.replace(BEARER_VALUE, () => {
    containsSecret = true;
    return 'Bearer [REDACTED]';
  });
  redacted = redacted.replace(SECRET_ASSIGNMENT, (match, prefix: string, key: string, secret: string) => {
    if (ENV_REFERENCE.test(secret)) return match;
    containsSecret = true;
    return `${prefix}${key}=[REDACTED]`;
  });
  try {
    const parsed = new URL(value);
    const sensitiveQuery = [...parsed.searchParams.keys()].some((key) => SECRET_KEY.test(key));
    if (parsed.username || parsed.password || sensitiveQuery) {
      containsSecret = true;
      parsed.username = '';
      parsed.password = '';
      for (const key of [...parsed.searchParams.keys()]) {
        if (SECRET_KEY.test(key)) parsed.searchParams.set(key, '[REDACTED]');
      }
      redacted = parsed.toString();
    }
  } catch {
    /* Not a URL. */
  }
  return { value: redacted, containsSecret };
}

function isSafeLiteralEnvironmentValue(key: string, value: string): boolean {
  if (hasControlCharacter(value)) return false;
  if (key === 'LOG_LEVEL') return /^(?:trace|debug|info|warn|warning|error|fatal|silent|off)$/iu.test(value);
  if (key === 'NODE_ENV') return /^(?:development|production|test)$/u.test(value);
  if (key === 'TEST_ENV') return /^(?:development|staging|production|test)$/u.test(value);
  if (key === 'NO_COLOR' || key === 'FORCE_COLOR') return /^(?:0|1|true|false)$/iu.test(value);
  if (key === 'DEBUG') return /^[A-Za-z0-9_*,.:-]{0,256}$/u.test(value) && !SECRET_ASSIGNMENT.test(value);
  if (key === 'PUBCOMMANDER_MCP_MODULES') return /^[A-Za-z0-9_*,.:-]{0,1024}$/u.test(value);
  return false;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function sameFileIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function requireNoSymlinkDescendants(root: string, candidate: string): void {
  const child = relative(root, candidate);
  if (child === '') return;
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error('path escapes root');
  }
  let cursor = root;
  for (const segment of child.split(sep)) {
    cursor = join(cursor, segment);
    const metadata = lstatSync(cursor);
    if (metadata.isSymbolicLink()) throw new Error('path contains a symbolic link');
  }
}

function isDescendant(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .toLocaleLowerCase()
    .slice(0, 48) || 'connector';
}
