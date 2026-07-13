import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  getCompanionContinuityStatus,
  type CompanionContinuityManifest,
  type CompanionContinuityOptions,
  type ContinuityScope,
} from './continuity.js';

export const COMPANION_MIGRATION_SCHEMA_VERSION = 1 as const;

interface MigrationArtifact {
  id: string;
  scope: ContinuityScope;
  relativePath: string;
  sensitive: boolean;
  bytes: number;
  sha256: string;
  contentBase64: string;
}

interface CompanionMigrationPayload {
  schemaVersion: typeof COMPANION_MIGRATION_SCHEMA_VERSION;
  lineageId: string;
  companionName: string;
  humanName: string;
  createdAt: string;
  sourceManifest: CompanionContinuityManifest;
  artifacts: MigrationArtifact[];
}

export interface CompanionMigrationEnvelope {
  format: 'codebuddy-companion-migration';
  schemaVersion: typeof COMPANION_MIGRATION_SCHEMA_VERSION;
  lineageId: string;
  companionName: string;
  createdAt: string;
  encryption: {
    algorithm: 'aes-256-gcm';
    keyDerivation: 'scrypt';
    salt: string;
    iv: string;
    authTag: string;
  };
  ciphertext: string;
}

export interface CompanionMigrationOptions extends CompanionContinuityOptions {
  passphrase: string;
  bundlePath?: string;
  now?: Date;
}

export interface CompanionMigrationExportResult {
  bundlePath: string;
  lineageId: string;
  companionName: string;
  artifactCount: number;
  plaintextBytes: number;
  encryptedBytes: number;
}

export interface CompanionMigrationRestoreOptions extends CompanionMigrationOptions {
  apply?: boolean;
  overwrite?: boolean;
}

export interface CompanionMigrationRestoreResult {
  bundlePath: string;
  lineageId: string;
  companionName: string;
  valid: boolean;
  applied: boolean;
  writable: boolean;
  planned: string[];
  restored: string[];
  unchanged: string[];
  conflicts: string[];
  errors: string[];
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function resolvedRoots(options: CompanionContinuityOptions): { cwd: string; homeDir: string } {
  return {
    cwd: path.resolve(options.cwd ?? process.cwd()),
    homeDir: path.resolve(options.homeDir ?? homedir()),
  };
}

function artifactPath(
  artifact: Pick<MigrationArtifact, 'scope' | 'relativePath'>,
  roots: { cwd: string; homeDir: string },
): string {
  const root = artifact.scope === 'project' ? roots.cwd : roots.homeDir;
  const target = path.resolve(root, artifact.relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Migration artifact escapes its ${artifact.scope} root: ${artifact.relativePath}`);
  }
  return target;
}

function envelopeAad(envelope: Pick<CompanionMigrationEnvelope, 'format' | 'schemaVersion' | 'lineageId' | 'companionName' | 'createdAt'>): Buffer {
  return Buffer.from(JSON.stringify({
    format: envelope.format,
    schemaVersion: envelope.schemaVersion,
    lineageId: envelope.lineageId,
    companionName: envelope.companionName,
    createdAt: envelope.createdAt,
  }), 'utf8');
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < 16) {
    throw new Error('The companion migration passphrase must contain at least 16 characters.');
  }
}

function readEnvelope(bundlePath: string): CompanionMigrationEnvelope {
  const parsed = JSON.parse(readFileSync(bundlePath, 'utf8')) as CompanionMigrationEnvelope;
  if (parsed.format !== 'codebuddy-companion-migration') {
    throw new Error('Not a Code Buddy companion migration bundle.');
  }
  if (parsed.schemaVersion !== COMPANION_MIGRATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported companion migration schema: ${String(parsed.schemaVersion)}.`);
  }
  if (parsed.encryption?.algorithm !== 'aes-256-gcm' || parsed.encryption.keyDerivation !== 'scrypt') {
    throw new Error('Unsupported companion migration encryption parameters.');
  }
  return parsed;
}

function decryptPayload(envelope: CompanionMigrationEnvelope, passphrase: string): CompanionMigrationPayload {
  assertPassphrase(passphrase);
  const key = scryptSync(passphrase, Buffer.from(envelope.encryption.salt, 'base64'), 32);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.encryption.iv, 'base64'),
  );
  decipher.setAAD(envelopeAad(envelope));
  decipher.setAuthTag(Buffer.from(envelope.encryption.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  const payload = JSON.parse(plaintext.toString('utf8')) as CompanionMigrationPayload;
  if (payload.schemaVersion !== COMPANION_MIGRATION_SCHEMA_VERSION || payload.lineageId !== envelope.lineageId) {
    throw new Error('Companion migration payload metadata does not match its authenticated envelope.');
  }
  return payload;
}

function defaultBundlePath(cwd: string, companionName: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  const safeName = companionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'companion';
  return path.join(cwd, '.codebuddy', 'companion', 'migrations', `${safeName}-${stamp}.cbm`);
}

function atomicWrite(target: string, content: string | Buffer): void {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, target);
}

export function getCompanionMigrationKeyPath(homeDir = homedir()): string {
  return path.join(path.resolve(homeDir), '.codebuddy', 'companion', 'migration.key');
}

export function getOrCreateCompanionMigrationPassphrase(homeDir = homedir()): {
  passphrase: string;
  keyPath: string;
  created: boolean;
} {
  const keyPath = getCompanionMigrationKeyPath(homeDir);
  if (existsSync(keyPath)) {
    return { passphrase: readFileSync(keyPath, 'utf8').trim(), keyPath, created: false };
  }
  const passphrase = randomBytes(32).toString('base64url');
  atomicWrite(keyPath, `${passphrase}\n`);
  return { passphrase, keyPath, created: true };
}

export function readCompanionMigrationPassphrase(options: { homeDir?: string; keyFile?: string } = {}): {
  passphrase: string;
  keyPath: string | null;
} {
  const fromEnvironment = process.env.CODEBUDDY_COMPANION_MIGRATION_KEY?.trim();
  if (fromEnvironment) return { passphrase: fromEnvironment, keyPath: null };
  const keyPath = path.resolve(options.keyFile ?? getCompanionMigrationKeyPath(options.homeDir));
  if (!existsSync(keyPath)) {
    throw new Error(`Companion migration key not found: ${keyPath}`);
  }
  return { passphrase: readFileSync(keyPath, 'utf8').trim(), keyPath };
}

export function exportCompanionMigration(
  options: CompanionMigrationOptions,
): CompanionMigrationExportResult {
  assertPassphrase(options.passphrase);
  const status = getCompanionContinuityStatus(options);
  if (!status.valid || !status.manifest) {
    throw new Error('Companion continuity must verify successfully before a migration can be exported.');
  }
  const roots = resolvedRoots(options);
  const artifacts: MigrationArtifact[] = status.manifest.components
    .filter(component => component.exists)
    .map((component) => {
      const content = readFileSync(artifactPath(component, roots));
      return {
        id: component.id,
        scope: component.scope,
        relativePath: component.relativePath,
        sensitive: component.sensitive,
        bytes: content.length,
        sha256: sha256(content),
        contentBase64: content.toString('base64'),
      };
    });
  const manifestContent = readFileSync(status.path);
  artifacts.push({
    id: 'continuity-manifest',
    scope: 'global',
    relativePath: path.relative(roots.homeDir, status.path),
    sensitive: true,
    bytes: manifestContent.length,
    sha256: sha256(manifestContent),
    contentBase64: manifestContent.toString('base64'),
  });
  const now = options.now ?? new Date();
  const payload: CompanionMigrationPayload = {
    schemaVersion: COMPANION_MIGRATION_SCHEMA_VERSION,
    lineageId: status.manifest.lineageId,
    companionName: status.manifest.companionName,
    humanName: status.manifest.humanName,
    createdAt: now.toISOString(),
    sourceManifest: status.manifest,
    artifacts,
  };
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const envelope: CompanionMigrationEnvelope = {
    format: 'codebuddy-companion-migration',
    schemaVersion: COMPANION_MIGRATION_SCHEMA_VERSION,
    lineageId: payload.lineageId,
    companionName: payload.companionName,
    createdAt: payload.createdAt,
    encryption: {
      algorithm: 'aes-256-gcm',
      keyDerivation: 'scrypt',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: '',
    },
    ciphertext: '',
  };
  const key = scryptSync(options.passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(envelopeAad(envelope));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  envelope.encryption.authTag = cipher.getAuthTag().toString('base64');
  envelope.ciphertext = ciphertext.toString('base64');
  const bundlePath = path.resolve(options.bundlePath ?? defaultBundlePath(roots.cwd, payload.companionName, now));
  atomicWrite(bundlePath, `${JSON.stringify(envelope, null, 2)}\n`);
  return {
    bundlePath,
    lineageId: payload.lineageId,
    companionName: payload.companionName,
    artifactCount: artifacts.length,
    plaintextBytes: plaintext.length,
    encryptedBytes: ciphertext.length,
  };
}

export function restoreCompanionMigration(
  options: CompanionMigrationRestoreOptions,
): CompanionMigrationRestoreResult {
  if (!options.bundlePath) throw new Error('A companion migration bundle path is required.');
  const bundlePath = path.resolve(options.bundlePath);
  const result: CompanionMigrationRestoreResult = {
    bundlePath,
    lineageId: '',
    companionName: '',
    valid: false,
    applied: false,
    writable: false,
    planned: [],
    restored: [],
    unchanged: [],
    conflicts: [],
    errors: [],
  };
  try {
    const payload = decryptPayload(readEnvelope(bundlePath), options.passphrase);
    result.lineageId = payload.lineageId;
    result.companionName = payload.companionName;
    const roots = resolvedRoots(options);
    const prepared = payload.artifacts.map((artifact) => {
      const content = Buffer.from(artifact.contentBase64, 'base64');
      if (content.length !== artifact.bytes || sha256(content) !== artifact.sha256) {
        throw new Error(`Artifact integrity failed: ${artifact.id}`);
      }
      const target = artifactPath(artifact, roots);
      if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
        throw new Error(`Refusing to restore through a symbolic link: ${target}`);
      }
      const existing = existsSync(target) ? readFileSync(target) : null;
      if (existing && sha256(existing) === artifact.sha256) result.unchanged.push(artifact.id);
      else if (existing) result.conflicts.push(artifact.id);
      const differs = !existing || sha256(existing) !== artifact.sha256;
      if (differs) result.planned.push(artifact.id);
      return { artifact, content, target, differs };
    });
    result.valid = true;
    result.writable = result.conflicts.length === 0 || options.overwrite === true;
    if (options.apply) {
      if (!result.writable) {
        result.errors.push('Existing artifacts differ. Review the dry run and use --overwrite to replace them.');
        return result;
      }
      const ordered = prepared.sort((a, b) => Number(a.artifact.id === 'continuity-manifest') - Number(b.artifact.id === 'continuity-manifest'));
      for (const item of ordered) {
        if (!item.differs) continue;
        atomicWrite(item.target, item.content);
        result.restored.push(item.artifact.id);
      }
      result.applied = true;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

export function formatCompanionMigrationResult(
  result: CompanionMigrationExportResult | CompanionMigrationRestoreResult,
  keyPath?: string | null,
): string {
  if ('artifactCount' in result) {
    return [
      'Companion migration bundle created',
      `Companion: ${result.companionName}`,
      `Lineage: ${result.lineageId}`,
      `Artifacts: ${result.artifactCount}`,
      `Bundle: ${result.bundlePath}`,
      keyPath ? `Recovery key: ${keyPath} (store separately from the bundle)` : 'Recovery key: provided by environment',
    ].join('\n');
  }
  const lines = [
    'Companion migration verification',
    `Status: ${result.valid ? 'cryptographically valid' : 'invalid'}`,
    `Mode: ${result.applied ? 'restored' : 'dry run'}`,
    `Bundle: ${result.bundlePath}`,
  ];
  if (result.lineageId) lines.push(`Lineage: ${result.lineageId}`);
  if (result.companionName) lines.push(`Companion: ${result.companionName}`);
  lines.push(
    `Conflicts: ${result.conflicts.length}`,
    result.applied ? `Restored: ${result.restored.length}` : `Would restore: ${result.planned.length}`,
  );
  if (result.conflicts.length > 0) lines.push(`Different existing artifacts: ${result.conflicts.join(', ')}`);
  if (result.errors.length > 0) lines.push(`Errors: ${result.errors.join('; ')}`);
  if (result.valid && !result.applied) {
    lines.push('', result.writable
      ? 'Dry run passed. Use --apply to restore.'
      : 'Dry run found conflicts. Review them before using --apply --overwrite.');
  }
  return lines.join('\n');
}
