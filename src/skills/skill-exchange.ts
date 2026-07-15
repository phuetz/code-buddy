/**
 * Signed, local-only exchange for Code Buddy skills.
 *
 * Exchange operations are explicitly opt-in and fail closed. Package content is
 * copied and scanned as data; no package script is ever executed.
 *
 * @module skills/skill-exchange
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import * as yaml from 'yaml';
import { scanSkillFirewall } from '../security/skill-scanner.js';
import { logger } from '../utils/logger.js';
import { getBundledSkillsPath } from './index.js';
import { parseSkillFile } from './parser.js';
import {
  getPublicKey,
  getPublicKeyId,
  publicKeyId,
  signManifest,
  verifyManifest,
} from './skill-signing.js';

export const SKILL_EXCHANGE_ENV = 'CODEBUDDY_SKILL_EXCHANGE';
export const EXCHANGE_MANIFEST_FILE = 'exchange-manifest.json';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface ExchangeManifestFile {
  path: string;
  sha256: string;
}

export interface UnsignedExchangeManifest {
  name: string;
  version: string;
  createdAt: string;
  author: string;
  files: ExchangeManifestFile[];
  publicKey: string;
}

export interface ExchangeManifest extends UnsignedExchangeManifest {
  signature: string;
}

export interface TrustedExchangeKey {
  id: string;
  publicKey: string;
  trustedAt: string;
}

interface TrustedKeysFile {
  schemaVersion: 1;
  keys: TrustedExchangeKey[];
}

export interface InstallSkillOptions {
  /** Explicit trust-on-first-use approval for an unknown, valid author key. */
  trust?: boolean;
  /** Destination root override, primarily for embedded hosts and tests. */
  destRoot?: string;
}

export interface InstallSkillResult {
  author: string;
  installedAt: string;
  name: string;
  path: string;
  trustedOnFirstUse: boolean;
  version: string;
}

export interface VerifySkillResult {
  author: string;
  manifest: ExchangeManifest;
  name: string;
  trusted: boolean;
  version: string;
}

interface AuditEntry {
  action: 'install' | 'refus' | 'verify';
  at: string;
  author?: string;
  name?: string;
  operation?: 'install' | 'verify';
  reason?: string;
  version?: string;
}

function exchangeEnabled(): boolean {
  const value = process.env[SKILL_EXCHANGE_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/** Whether the opt-in exchange feature is currently enabled. */
export function isSkillExchangeEnabled(): boolean {
  return exchangeEnabled();
}

function assertExchangeEnabled(): void {
  if (!exchangeEnabled()) {
    throw new Error(`Skill exchange is disabled; set ${SKILL_EXCHANGE_ENV}=true to opt in`);
  }
}

function signingDir(): string {
  return path.join(os.homedir(), '.codebuddy', 'skill-signing');
}

function trustedKeysPath(): string {
  return path.join(signingDir(), 'trusted-keys.json');
}

function auditLogPath(): string {
  return path.join(os.homedir(), '.codebuddy', 'skill-exchange-log.jsonl');
}

function defaultDestRoot(): string {
  return path.join(os.homedir(), '.codebuddy', 'skills', 'managed');
}

function appendAudit(entry: AuditEntry): void {
  try {
    const file = auditLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch (error) {
    logger.warn('Failed to append skill-exchange audit entry', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function refusal(operation: 'install' | 'verify', error: unknown): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  appendAudit({ action: 'refus', at: new Date().toISOString(), operation, reason: normalized.message });
  logger.warn(`Skill exchange ${operation} refused`, { reason: normalized.message });
  return normalized;
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function isInside(parentDir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafeRelativePath(relativePath: string): void {
  if (
    relativePath.length === 0
    || relativePath.includes('\\')
    || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath === '..'
    || relativePath.startsWith('../')
    || relativePath.split('/').includes('..')
  ) {
    throw new Error(`Unsafe package path: ${relativePath}`);
  }
}

function listRegularFiles(root: string, options: { excludeManifest?: boolean } = {}): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      assertSafeRelativePath(relative);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in exchange packages: ${relative}`);
      }
      if (stat.isDirectory()) {
        walk(absolute);
      } else if (stat.isFile()) {
        if (!(options.excludeManifest && relative === EXCHANGE_MANIFEST_FILE)) files.push(relative);
      } else {
        throw new Error(`Unsupported filesystem entry in skill: ${relative}`);
      }
    }
  };
  walk(root);
  return files.sort();
}

function copyFiles(sourceRoot: string, destinationRoot: string, files: readonly string[]): void {
  for (const relative of files) {
    assertSafeRelativePath(relative);
    const source = path.join(sourceRoot, ...relative.split('/'));
    const destination = path.join(destinationRoot, ...relative.split('/'));
    if (!isInside(sourceRoot, source) || !isInside(destinationRoot, destination)) {
      throw new Error(`Path traversal refused: ${relative}`);
    }
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Only regular files may be copied: ${relative}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function validateSkillName(name: string): void {
  if (!SAFE_NAME_RE.test(name)) throw new Error(`Invalid skill name: ${name}`);
}

function findLocalSkill(name: string): string {
  validateSkillName(name);
  const workspaceSkills = path.join(process.cwd(), '.codebuddy', 'skills');
  const authoredName = name.startsWith('authored-') ? name : `authored-${name}`;
  const candidates = [
    path.join(workspaceSkills, authoredName),
    path.join(getBundledSkillsPath(), name),
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'SKILL.md'))
      && fs.lstatSync(candidate).isDirectory()
      && !fs.lstatSync(candidate).isSymbolicLink()
    ) {
      return candidate;
    }
  }
  throw new Error(`Skill not found: ${name}`);
}

function unsignedManifest(manifest: ExchangeManifest): UnsignedExchangeManifest {
  return {
    name: manifest.name,
    version: manifest.version,
    createdAt: manifest.createdAt,
    author: manifest.author,
    files: manifest.files,
    publicKey: manifest.publicKey,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function parseManifest(packageDir: string): ExchangeManifest {
  const manifestPath = path.join(packageDir, EXCHANGE_MANIFEST_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as unknown;
  } catch (error) {
    throw new Error(`Malformed exchange manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(raw) || !exactKeys(raw, ['name', 'version', 'createdAt', 'author', 'files', 'publicKey', 'signature'])) {
    throw new Error('Malformed exchange manifest: unexpected or missing fields');
  }
  if (
    typeof raw.name !== 'string'
    || typeof raw.version !== 'string'
    || typeof raw.createdAt !== 'string'
    || typeof raw.author !== 'string'
    || typeof raw.publicKey !== 'string'
    || typeof raw.signature !== 'string'
    || !Array.isArray(raw.files)
  ) {
    throw new Error('Malformed exchange manifest: invalid field types');
  }
  validateSkillName(raw.name);
  if (!raw.version.trim() || !Number.isFinite(Date.parse(raw.createdAt)) || raw.author.length !== 12) {
    throw new Error('Malformed exchange manifest: invalid name, version, date, or author');
  }
  const seen = new Set<string>();
  const files: ExchangeManifestFile[] = raw.files.map((entry): ExchangeManifestFile => {
    if (!isRecord(entry) || !exactKeys(entry, ['path', 'sha256']) || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
      throw new Error('Malformed exchange manifest: invalid file entry');
    }
    assertSafeRelativePath(entry.path);
    if (entry.path === EXCHANGE_MANIFEST_FILE || seen.has(entry.path) || !SHA256_RE.test(entry.sha256)) {
      throw new Error(`Malformed exchange manifest: invalid or duplicate file ${entry.path}`);
    }
    seen.add(entry.path);
    return { path: entry.path, sha256: entry.sha256 };
  });
  if (!seen.has('SKILL.md')) throw new Error('Malformed exchange manifest: SKILL.md is not signed');
  return {
    name: raw.name,
    version: raw.version,
    createdAt: raw.createdAt,
    author: raw.author,
    files,
    publicKey: raw.publicKey,
    signature: raw.signature,
  };
}

function readTrustedKeys(): TrustedKeysFile {
  const file = trustedKeysPath();
  if (!fs.existsSync(file)) return { schemaVersion: 1, keys: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
  } catch (error) {
    throw new Error(`Malformed trusted-key store: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.keys)) {
    throw new Error('Malformed trusted-key store');
  }
  const keys: TrustedExchangeKey[] = raw.keys.map((entry) => {
    if (
      !isRecord(entry)
      || !exactKeys(entry, ['id', 'publicKey', 'trustedAt'])
      || typeof entry.id !== 'string'
      || typeof entry.publicKey !== 'string'
      || typeof entry.trustedAt !== 'string'
      || entry.id !== publicKeyId(entry.publicKey)
    ) {
      throw new Error('Malformed trusted-key store entry');
    }
    return { id: entry.id, publicKey: entry.publicKey, trustedAt: entry.trustedAt };
  });
  return { schemaVersion: 1, keys };
}

function writeTrustedKeys(store: TrustedKeysFile): void {
  fs.mkdirSync(signingDir(), { recursive: true, mode: 0o700 });
  const destination = trustedKeysPath();
  const temporary = `${destination}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(temporary, destination);
}

/** List explicitly trusted exchange author keys. */
export function listTrustedKeys(): TrustedExchangeKey[] {
  assertExchangeEnabled();
  return readTrustedKeys().keys;
}

function validatePackage(packageDir: string): { manifest: ExchangeManifest; trusted: boolean } {
  const resolvedDir = path.resolve(packageDir);
  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    throw new Error(`Exchange package directory not found: ${packageDir}`);
  }

  // Required verification order: shape, signature, hashes, firewall.
  const manifest = parseManifest(resolvedDir);
  if (publicKeyId(manifest.publicKey) !== manifest.author) {
    throw new Error('Manifest author does not match the embedded public key');
  }
  if (!verifyManifest(unsignedManifest(manifest), manifest.signature, manifest.publicKey)) {
    throw new Error('Invalid exchange manifest signature');
  }

  const actualFiles = listRegularFiles(resolvedDir, { excludeManifest: true });
  const declaredFiles = manifest.files.map((file) => file.path).sort();
  if (actualFiles.length !== declaredFiles.length || actualFiles.some((file, index) => file !== declaredFiles[index])) {
    throw new Error('Package contains missing or unsigned files');
  }
  for (const file of manifest.files) {
    const absolute = path.join(resolvedDir, ...file.path.split('/'));
    if (!isInside(resolvedDir, absolute) || sha256File(absolute) !== file.sha256) {
      throw new Error(`SHA-256 mismatch for ${file.path}`);
    }
  }

  let firewall;
  try {
    firewall = scanSkillFirewall(resolvedDir);
  } catch (error) {
    throw new Error(`Skill firewall scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (firewall.quarantineRequired || firewall.verdict !== 'allow') {
    throw new Error(`Skill firewall refused package (${firewall.verdict}): ${firewall.summary}`);
  }

  const trustStore = readTrustedKeys();
  const matching = trustStore.keys.find((key) => key.id === manifest.author);
  if (matching && matching.publicKey !== manifest.publicKey) {
    throw new Error(`Trusted-key identifier collision for ${manifest.author}`);
  }
  return { manifest, trusted: matching !== undefined };
}

/** Export an authored or bundled local skill as a signed directory package. */
export function exportSkill(name: string, outDir: string): ExchangeManifest {
  assertExchangeEnabled();
  const sourceDir = findLocalSkill(name);
  const destination = path.resolve(outDir, name);
  if (isInside(sourceDir, destination)) {
    throw new Error('Export destination cannot be inside the source skill directory');
  }
  const files = listRegularFiles(sourceDir);
  if (files.includes(EXCHANGE_MANIFEST_FILE)) {
    throw new Error(`Source skill contains reserved file ${EXCHANGE_MANIFEST_FILE}`);
  }
  const skillFile = path.join(sourceDir, 'SKILL.md');
  const parsed = parseSkillFile(fs.readFileSync(skillFile, 'utf-8'), skillFile, 'workspace');
  const temporary = `${destination}.${randomUUID()}.tmp`;

  try {
    fs.mkdirSync(temporary, { recursive: true });
    copyFiles(sourceDir, temporary, files);
    const unsigned: UnsignedExchangeManifest = {
      name,
      version: parsed.metadata.version ?? '0.0.0',
      createdAt: new Date().toISOString(),
      author: getPublicKeyId(),
      files: files.map((relative) => ({ path: relative, sha256: sha256File(path.join(sourceDir, ...relative.split('/'))) })),
      publicKey: getPublicKey(),
    };
    const manifest: ExchangeManifest = { ...unsigned, signature: signManifest(unsigned) };
    fs.writeFileSync(path.join(temporary, EXCHANGE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(temporary, destination);
    logger.info('Skill exported to signed exchange package', { name, path: destination, version: manifest.version });
    return manifest;
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

/** Verify signature, hashes and firewall verdict without installing or trusting. */
export function verifySkill(dir: string): VerifySkillResult {
  assertExchangeEnabled();
  try {
    const validation = validatePackage(dir);
    const result: VerifySkillResult = {
      author: validation.manifest.author,
      manifest: validation.manifest,
      name: validation.manifest.name,
      trusted: validation.trusted,
      version: validation.manifest.version,
    };
    appendAudit({
      action: 'verify',
      at: new Date().toISOString(),
      author: result.author,
      name: result.name,
      version: result.version,
    });
    return result;
  } catch (error) {
    throw refusal('verify', error);
  }
}

function importedName(name: string): string {
  const base = name.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return base.startsWith('imported-') ? base : `imported-${base}`;
}

function isExistingExchangeSkill(destination: string): boolean {
  const skillFile = path.join(destination, 'SKILL.md');
  if (!fs.existsSync(skillFile)) return false;
  const match = fs.readFileSync(skillFile, 'utf-8').match(FRONTMATTER_RE);
  if (!match) return false;
  try {
    const metadata = yaml.parse(match[1] ?? '') as unknown;
    return isRecord(metadata) && metadata.exchange === true;
  } catch {
    return false;
  }
}

function writeExchangeProvenance(skillFile: string, name: string, author: string, installedAt: string): void {
  const content = fs.readFileSync(skillFile, 'utf-8');
  const match = content.match(FRONTMATTER_RE);
  if (!match) throw new Error('Installed SKILL.md is missing frontmatter');
  const parsed = yaml.parse(match[1] ?? '') as unknown;
  if (!isRecord(parsed)) throw new Error('Installed SKILL.md frontmatter is malformed');
  const metadata: Record<string, unknown> = {
    ...parsed,
    name,
    imported: true,
    source: 'exchange',
    exchange: true,
    author,
    installedAt,
    pinned: true,
  };
  fs.writeFileSync(skillFile, `---\n${yaml.stringify(metadata)}---\n\n${(match[2] ?? '').trim()}\n`, 'utf-8');
}

/** Verify and install a signed skill package under the managed imported namespace. */
export function installSkill(dir: string, options: InstallSkillOptions = {}): InstallSkillResult {
  assertExchangeEnabled();
  try {
    const validation = validatePackage(dir);
    const manifest = validation.manifest;
    const name = importedName(manifest.name);
    const destinationRoot = path.resolve(options.destRoot ?? defaultDestRoot());
    const destination = path.join(destinationRoot, name);

    // Collision check follows shape/signature/hash/firewall verification.
    if (fs.existsSync(destination) && !isExistingExchangeSkill(destination)) {
      throw new Error(`Refusing to overwrite non-exchange skill: ${name}`);
    }
    if (!validation.trusted && options.trust !== true) {
      throw new Error(`Unknown exchange author ${manifest.author}; pass --trust for explicit TOFU approval`);
    }

    const store = readTrustedKeys();
    const trustedOnFirstUse = !validation.trusted;
    if (trustedOnFirstUse) {
      store.keys.push({ id: manifest.author, publicKey: manifest.publicKey, trustedAt: new Date().toISOString() });
      writeTrustedKeys(store);
    }

    const temporary = path.join(destinationRoot, `.${name}.${randomUUID()}.tmp`);
    const backup = path.join(destinationRoot, `.${name}.${randomUUID()}.backup`);
    const installedAt = new Date().toISOString();
    let movedExisting = false;
    try {
      fs.mkdirSync(temporary, { recursive: true });
      copyFiles(path.resolve(dir), temporary, manifest.files.map((file) => file.path));
      writeExchangeProvenance(path.join(temporary, 'SKILL.md'), name, manifest.author, installedAt);
      fs.mkdirSync(destinationRoot, { recursive: true });
      if (fs.existsSync(destination)) {
        fs.renameSync(destination, backup);
        movedExisting = true;
      }
      fs.renameSync(temporary, destination);
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      if (movedExisting && !fs.existsSync(destination) && fs.existsSync(backup)) {
        fs.renameSync(backup, destination);
      }
      if (trustedOnFirstUse) {
        try {
          writeTrustedKeys({ ...store, keys: store.keys.filter((key) => key.id !== manifest.author) });
        } catch (rollbackError) {
          logger.warn('Failed to roll back exchange trust after installation error', {
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        }
      }
      throw error;
    }

    const result: InstallSkillResult = {
      author: manifest.author,
      installedAt,
      name,
      path: destination,
      trustedOnFirstUse,
      version: manifest.version,
    };
    appendAudit({ action: 'install', at: installedAt, author: manifest.author, name, version: manifest.version });
    logger.info('Signed exchange skill installed', { author: manifest.author, name, version: manifest.version });
    void (async () => {
      try {
        const { getSkillRegistry } = await import('./registry.js');
        await getSkillRegistry().reloadAll();
      } catch (error) {
        logger.debug('Skill reload after exchange installation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return result;
  } catch (error) {
    throw refusal('install', error);
  }
}
