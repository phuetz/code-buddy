/**
 * Declared SSH sandbox hosts.
 *
 * Logical name → connection metadata. Never stores a passphrase, password, or
 * private-key body — only an optional path to an existing identity file, plus
 * the SSH agent.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join } from 'path';
import { logger } from '../utils/logger.js';

const LOGICAL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const USER_RE = /^[A-Za-z_][A-Za-z0-9._-]*$/;
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SECRET_FIELDS = new Set([
  'password',
  'passphrase',
  'privatekey',
  'private_key',
  'secret',
  'key',
  'identity',
]);

const ALLOWED_STRICT_HOST_KEY = new Set(['yes', 'accept-new']);

export interface SshHostDefinition {
  /** DNS name or address passed to ssh (not the logical catalogue name). */
  host: string;
  user?: string;
  port?: number;
  /** Remote working directory (POSIX path). */
  workDir?: string;
  /** Existing identity file on this machine. Never a key body. */
  identityFile?: string;
  /** Host-key policy. `no` is rejected. Default `yes`. */
  strictHostKeyChecking?: 'yes' | 'accept-new';
  /** SSH ConnectTimeout in seconds. */
  connectTimeoutSec?: number;
}

export interface SshHostCatalog {
  hosts: Record<string, SshHostDefinition>;
}

export class SshHostConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SshHostConfigError';
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function rejectSecretFields(raw: Record<string, unknown>, logicalName: string): void {
  for (const key of Object.keys(raw)) {
    if (SECRET_FIELDS.has(key.toLowerCase())) {
      throw new SshHostConfigError(
        'secret_in_config',
        `SSH host '${logicalName}' declares a secret field; only an existing identityFile path is allowed`,
      );
    }
  }
}

function parsePort(value: unknown, logicalName: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const port = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SshHostConfigError('invalid_port', `SSH host '${logicalName}' has an invalid port`);
  }
  return port;
}

function parseConnectTimeout(value: unknown, logicalName: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const seconds = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) {
    throw new SshHostConfigError(
      'invalid_connect_timeout',
      `SSH host '${logicalName}' has an invalid connectTimeoutSec`,
    );
  }
  return seconds;
}

function parseIdentityFile(value: unknown, logicalName: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new SshHostConfigError('invalid_identity', `SSH host '${logicalName}' identityFile must be a path`);
  }
  const trimmed = value.trim();
  if (trimmed.includes('\0') || trimmed.includes('\n') || /BEGIN [A-Z ]*PRIVATE KEY/.test(trimmed)) {
    throw new SshHostConfigError(
      'invalid_identity',
      `SSH host '${logicalName}' identityFile must be an existing file path, not a key body`,
    );
  }
  if (!isAbsolute(trimmed)) {
    throw new SshHostConfigError(
      'invalid_identity',
      `SSH host '${logicalName}' identityFile must be an absolute path`,
    );
  }
  try {
    if (!existsSync(trimmed) || !statSync(trimmed).isFile()) {
      throw new SshHostConfigError(
        'identity_missing',
        `SSH host '${logicalName}' identityFile does not exist`,
      );
    }
  } catch (error) {
    if (error instanceof SshHostConfigError) throw error;
    throw new SshHostConfigError(
      'identity_missing',
      `SSH host '${logicalName}' identityFile does not exist`,
    );
  }
  return trimmed;
}

function parseWorkDir(value: unknown, logicalName: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !value.startsWith('/')) {
    throw new SshHostConfigError(
      'invalid_workdir',
      `SSH host '${logicalName}' workDir must be an absolute POSIX path`,
    );
  }
  if (value.includes('\0') || value.includes('\n') || /[;`|&$<>]/.test(value)) {
    throw new SshHostConfigError(
      'invalid_workdir',
      `SSH host '${logicalName}' workDir contains unsafe characters`,
    );
  }
  return value;
}

function parseStrictHostKey(value: unknown, logicalName: string): 'yes' | 'accept-new' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'no' || normalized === 'off' || normalized === 'false') {
    throw new SshHostConfigError(
      'insecure_host_key',
      `SSH host '${logicalName}' cannot disable StrictHostKeyChecking`,
    );
  }
  if (!ALLOWED_STRICT_HOST_KEY.has(normalized)) {
    throw new SshHostConfigError(
      'invalid_host_key',
      `SSH host '${logicalName}' strictHostKeyChecking must be 'yes' or 'accept-new'`,
    );
  }
  return normalized as 'yes' | 'accept-new';
}

export function parseSshHostDefinition(
  logicalName: string,
  raw: unknown,
): SshHostDefinition {
  if (!LOGICAL_NAME_RE.test(logicalName)) {
    throw new SshHostConfigError('invalid_name', `Invalid SSH host name '${logicalName}'`);
  }
  const record = asRecord(raw);
  if (!record) {
    throw new SshHostConfigError('invalid_host', `SSH host '${logicalName}' must be an object`);
  }
  rejectSecretFields(record, logicalName);

  const host = typeof record.host === 'string' ? record.host.trim() : '';
  if (!host || !HOST_RE.test(host) || host.includes('/')) {
    throw new SshHostConfigError(
      'invalid_host',
      `SSH host '${logicalName}' is missing a valid host address`,
    );
  }

  let user: string | undefined;
  if (record.user !== undefined && record.user !== null && record.user !== '') {
    const value = String(record.user).trim();
    if (!USER_RE.test(value)) {
      throw new SshHostConfigError('invalid_user', `SSH host '${logicalName}' has an invalid user`);
    }
    user = value;
  }

  const definition: SshHostDefinition = { host };
  if (user) definition.user = user;
  const port = parsePort(record.port, logicalName);
  if (port !== undefined) definition.port = port;
  const workDir = parseWorkDir(record.workDir ?? record.workdir, logicalName);
  if (workDir) definition.workDir = workDir;
  const identityFile = parseIdentityFile(
    record.identityFile ?? record.identity_file,
    logicalName,
  );
  if (identityFile) definition.identityFile = identityFile;
  const strict = parseStrictHostKey(
    record.strictHostKeyChecking ?? record.strict_host_key_checking,
    logicalName,
  );
  if (strict) definition.strictHostKeyChecking = strict;
  const connectTimeoutSec = parseConnectTimeout(
    record.connectTimeoutSec ?? record.connect_timeout_sec,
    logicalName,
  );
  if (connectTimeoutSec !== undefined) definition.connectTimeoutSec = connectTimeoutSec;
  return definition;
}

export function parseSshHostCatalog(raw: unknown): SshHostCatalog {
  const record = asRecord(raw);
  if (!record) {
    throw new SshHostConfigError('invalid_catalog', 'SSH host catalog must be an object');
  }
  const hostsRaw = asRecord(record.hosts) ?? record;
  const hosts: Record<string, SshHostDefinition> = {};
  for (const [name, value] of Object.entries(hostsRaw)) {
    if (name === 'hosts') continue;
    try {
      hosts[name] = parseSshHostDefinition(name, value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Ignoring SSH host '${name}': ${message}`);
    }
  }
  return { hosts };
}

function readJsonFile(path: string): unknown | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    logger.warn(`Failed to read SSH host catalog ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function mergeCatalogs(...catalogs: SshHostCatalog[]): SshHostCatalog {
  const hosts: Record<string, SshHostDefinition> = {};
  for (const catalog of catalogs) {
    Object.assign(hosts, catalog.hosts);
  }
  return { hosts };
}

export function loadSshHostCatalog(
  env: NodeJS.ProcessEnv = process.env,
  options: { homeDir?: string; cwd?: string } = {},
): SshHostCatalog {
  const homeDir = options.homeDir ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const catalogs: SshHostCatalog[] = [];

  const userFile = join(homeDir, '.codebuddy', 'ssh-hosts.json');
  const userJson = readJsonFile(userFile);
  if (userJson) catalogs.push(parseSshHostCatalog(userJson));

  const projectFile = join(cwd, '.codebuddy', 'ssh-hosts.json');
  const projectJson = readJsonFile(projectFile);
  if (projectJson) catalogs.push(parseSshHostCatalog(projectJson));

  const fileOverride = env.CODEBUDDY_SSH_HOSTS_FILE?.trim();
  if (fileOverride) {
    const overrideJson = readJsonFile(fileOverride);
    if (overrideJson) catalogs.push(parseSshHostCatalog(overrideJson));
  }

  const inline = env.CODEBUDDY_SSH_HOSTS?.trim();
  if (inline) {
    try {
      catalogs.push(parseSshHostCatalog(JSON.parse(inline) as unknown));
    } catch (error) {
      logger.warn(`CODEBUDDY_SSH_HOSTS is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return mergeCatalogs(...catalogs);
}

export function lookupSshHost(
  catalog: SshHostCatalog,
  logicalName: string | undefined,
): SshHostDefinition | null {
  if (!logicalName) return null;
  return catalog.hosts[logicalName] ?? null;
}

export function isSafeEnvKey(key: string): boolean {
  return ENV_KEY_RE.test(key) && key !== 'IFS';
}

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
