import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { assertFoodProfile } from './profile-validator.js';
import type { FoodProfile } from './types.js';

const STORE_FORMAT = 'codebuddy-food-profile';
const STORE_SCHEMA_VERSION = 1 as const;
const ALGORITHM = 'aes-256-gcm' as const;
const KDF = 'scrypt' as const;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const MIN_ENV_SECRET_LENGTH = 16;
const MIN_LOCAL_SECRET_LENGTH = 32;

export type FoodProfileKeySource = 'environment' | 'local-key-file';

interface EncryptedFoodProfileEnvelope {
  format: typeof STORE_FORMAT;
  schemaVersion: typeof STORE_SCHEMA_VERSION;
  savedAt: string;
  encryption: {
    algorithm: typeof ALGORITHM;
    keyDerivation: typeof KDF;
    keySource: FoodProfileKeySource;
    salt: string;
    iv: string;
    authTag: string;
  };
  ciphertext: string;
}

export interface FoodProfileStoreOptions {
  storePath?: string;
  localKeyPath?: string;
  /**
   * Test/integration override. undefined reads CODEBUDDY_LIFE_ENCRYPTION_KEY;
   * null explicitly selects the private local-key fallback.
   */
  encryptionKey?: string | null;
  now?: () => Date;
}

export interface FoodProfileSaveResult {
  storePath: string;
  keySource: FoodProfileKeySource;
  savedAt: string;
}

export const LOCAL_KEY_FALLBACK_POLICY = Object.freeze({
  environmentVariable: 'CODEBUDDY_LIFE_ENCRYPTION_KEY',
  algorithm: ALGORITHM,
  keyDerivation: KDF,
  directoryMode: 0o700,
  fileMode: 0o600,
  plaintextFallback: false,
  machineDerivedFallback: false,
});

export class FoodProfileKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoodProfileKeyError';
  }
}

export class FoodProfileDecryptionError extends Error {
  constructor(message = 'Unable to authenticate or decrypt the encrypted food profile.') {
    super(message);
    this.name = 'FoodProfileDecryptionError';
  }
}

export class FoodProfilePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoodProfilePersistenceError';
  }
}

export function getDefaultFoodProfilePath(home = homedir()): string {
  return path.join(home, '.codebuddy', 'life', 'food-profile.enc.json');
}

export function getDefaultFoodProfileKeyPath(home = homedir()): string {
  return path.join(home, '.codebuddy', 'life', 'meals.key');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKeySource(value: unknown): value is FoodProfileKeySource {
  return value === 'environment' || value === 'local-key-file';
}

function parseEnvelope(raw: string): EncryptedFoodProfileEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new FoodProfilePersistenceError('Food profile store does not contain valid JSON.');
  }
  if (!isRecord(value)
    || value.format !== STORE_FORMAT
    || value.schemaVersion !== STORE_SCHEMA_VERSION
    || typeof value.savedAt !== 'string'
    || !isRecord(value.encryption)
    || value.encryption.algorithm !== ALGORITHM
    || value.encryption.keyDerivation !== KDF
    || !isKeySource(value.encryption.keySource)
    || typeof value.encryption.salt !== 'string'
    || typeof value.encryption.iv !== 'string'
    || typeof value.encryption.authTag !== 'string'
    || typeof value.ciphertext !== 'string') {
    throw new FoodProfilePersistenceError('Unsupported or malformed encrypted food profile envelope.');
  }
  const envelope = value as unknown as EncryptedFoodProfileEnvelope;
  if (Buffer.from(envelope.encryption.iv, 'base64').length !== IV_BYTES
    || Buffer.from(envelope.encryption.authTag, 'base64').length !== AUTH_TAG_BYTES
    || Buffer.from(envelope.encryption.salt, 'base64').length !== SALT_BYTES) {
    throw new FoodProfilePersistenceError('Encrypted food profile contains invalid cryptographic parameters.');
  }
  return envelope;
}

function envelopeAad(envelope: Pick<EncryptedFoodProfileEnvelope, 'format' | 'schemaVersion' | 'savedAt' | 'encryption'>): Buffer {
  return Buffer.from(JSON.stringify({
    format: envelope.format,
    schemaVersion: envelope.schemaVersion,
    savedAt: envelope.savedAt,
    algorithm: envelope.encryption.algorithm,
    keyDerivation: envelope.encryption.keyDerivation,
    keySource: envelope.encryption.keySource,
    salt: envelope.encryption.salt,
  }), 'utf8');
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

async function assertRegularPrivateFile(filePath: string): Promise<void> {
  const info = await lstat(filePath);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new FoodProfileKeyError(`Refusing non-regular local meal key file: ${filePath}`);
  }
  await chmod(filePath, 0o600);
}

async function readLocalSecret(keyPath: string): Promise<string> {
  try {
    await assertRegularPrivateFile(keyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FoodProfileKeyError(`Local meal key is missing: ${keyPath}`);
    }
    throw error;
  }
  const secret = (await readFile(keyPath, 'utf8')).trim();
  if (secret.length < MIN_LOCAL_SECRET_LENGTH) {
    throw new FoodProfileKeyError('Local meal key is invalid or too short.');
  }
  return secret;
}

async function getOrCreateLocalSecret(keyPath: string): Promise<string> {
  try {
    return await readLocalSecret(keyPath);
  } catch (error) {
    if (!(error instanceof FoodProfileKeyError) || !error.message.startsWith('Local meal key is missing:')) {
      throw error;
    }
  }

  await ensurePrivateDirectory(path.dirname(keyPath));
  const secret = randomBytes(KEY_BYTES).toString('base64url');
  try {
    const handle = await open(keyPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${secret}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(keyPath, 0o600);
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return readLocalSecret(keyPath);
    }
    throw new FoodProfileKeyError(`Unable to create private local meal key: ${String(error)}`);
  }
}

async function atomicPrivateWrite(target: string, content: string): Promise<void> {
  await ensurePrivateDirectory(path.dirname(target));
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class FoodProfileStore {
  readonly storePath: string;
  readonly localKeyPath: string;
  private readonly encryptionKeyOverride: string | null | undefined;
  private readonly now: () => Date;

  constructor(options: FoodProfileStoreOptions = {}) {
    this.storePath = path.resolve(options.storePath ?? getDefaultFoodProfilePath());
    this.localKeyPath = path.resolve(options.localKeyPath ?? getDefaultFoodProfileKeyPath());
    this.encryptionKeyOverride = options.encryptionKey;
    this.now = options.now ?? (() => new Date());
  }

  private environmentSecret(): string | null {
    const raw = this.encryptionKeyOverride === undefined
      ? process.env.CODEBUDDY_LIFE_ENCRYPTION_KEY
      : this.encryptionKeyOverride;
    const secret = raw?.trim() ?? '';
    if (!secret) return null;
    if (secret.length < MIN_ENV_SECRET_LENGTH) {
      throw new FoodProfileKeyError(
        `CODEBUDDY_LIFE_ENCRYPTION_KEY must contain at least ${MIN_ENV_SECRET_LENGTH} characters.`,
      );
    }
    return secret;
  }

  private async keyForSave(): Promise<{ source: FoodProfileKeySource; secret: string }> {
    const environment = this.environmentSecret();
    if (environment) return { source: 'environment', secret: environment };
    return { source: 'local-key-file', secret: await getOrCreateLocalSecret(this.localKeyPath) };
  }

  private async keyForLoad(source: FoodProfileKeySource): Promise<string> {
    if (source === 'environment') {
      const environment = this.environmentSecret();
      if (!environment) {
        throw new FoodProfileKeyError(
          'This food profile requires CODEBUDDY_LIFE_ENCRYPTION_KEY; local fallback is intentionally not substituted.',
        );
      }
      return environment;
    }
    // Never create a replacement key while decrypting existing local data.
    return readLocalSecret(this.localKeyPath);
  }

  async save(profile: FoodProfile): Promise<FoodProfileSaveResult> {
    assertFoodProfile(profile);
    const keyMaterial = await this.keyForSave();
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const savedAt = this.now().toISOString();
    const envelope: EncryptedFoodProfileEnvelope = {
      format: STORE_FORMAT,
      schemaVersion: STORE_SCHEMA_VERSION,
      savedAt,
      encryption: {
        algorithm: ALGORITHM,
        keyDerivation: KDF,
        keySource: keyMaterial.source,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        authTag: '',
      },
      ciphertext: '',
    };
    const key = scryptSync(keyMaterial.secret, salt, KEY_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(envelopeAad(envelope));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(profile), 'utf8'),
      cipher.final(),
    ]);
    envelope.encryption.authTag = cipher.getAuthTag().toString('base64');
    envelope.ciphertext = ciphertext.toString('base64');

    try {
      await atomicPrivateWrite(this.storePath, `${JSON.stringify(envelope, null, 2)}\n`);
    } catch (error) {
      logger.warn('[meals] encrypted food profile save failed', {
        storePath: this.storePath,
        error: String(error),
      });
      throw new FoodProfilePersistenceError(`Unable to save encrypted food profile: ${String(error)}`);
    }
    return { storePath: this.storePath, keySource: keyMaterial.source, savedAt };
  }

  async load(): Promise<FoodProfile | null> {
    let raw: string;
    try {
      const info = await lstat(this.storePath);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new FoodProfilePersistenceError('Refusing non-regular encrypted food profile store.');
      }
      raw = await readFile(this.storePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof FoodProfilePersistenceError) throw error;
      throw new FoodProfilePersistenceError(`Unable to read encrypted food profile: ${String(error)}`);
    }

    const envelope = parseEnvelope(raw);
    const secret = await this.keyForLoad(envelope.encryption.keySource);
    let plaintext: string;
    try {
      const key = scryptSync(
        secret,
        Buffer.from(envelope.encryption.salt, 'base64'),
        KEY_BYTES,
      );
      const decipher = createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(envelope.encryption.iv, 'base64'),
      );
      decipher.setAAD(envelopeAad(envelope));
      decipher.setAuthTag(Buffer.from(envelope.encryption.authTag, 'base64'));
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      logger.warn('[meals] encrypted food profile authentication failed', {
        storePath: this.storePath,
        keySource: envelope.encryption.keySource,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      throw new FoodProfileDecryptionError();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      throw new FoodProfilePersistenceError('Decrypted food profile payload is not valid JSON.');
    }
    assertFoodProfile(parsed);
    return parsed;
  }
}
