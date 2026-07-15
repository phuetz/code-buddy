/**
 * Local Ed25519 signing for skill-exchange manifests.
 *
 * The private key is generated lazily and never leaves the local signing
 * directory. Manifests are signed over deterministic, recursively sorted JSON.
 *
 * @module skills/skill-signing
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'crypto';

const PRIVATE_KEY_FILE = 'key.pem';
const PUBLIC_KEY_FILE = 'key.pub';

function signingDir(): string {
  return path.join(os.homedir(), '.codebuddy', 'skill-signing');
}

function privateKeyPath(): string {
  return path.join(signingDir(), PRIVATE_KEY_FILE);
}

function publicKeyPath(): string {
  return path.join(signingDir(), PUBLIC_KEY_FILE);
}

function ensureLocalKeyPair(): void {
  const privatePath = privateKeyPath();
  const publicPath = publicKeyPath();
  const privateExists = fs.existsSync(privatePath);
  const publicExists = fs.existsSync(publicPath);

  if (privateExists !== publicExists) {
    throw new Error('Incomplete local skill-signing key pair; refusing to replace it');
  }
  if (privateExists) {
    const privateStat = fs.lstatSync(privatePath);
    const publicStat = fs.lstatSync(publicPath);
    if (
      privateStat.isSymbolicLink()
      || publicStat.isSymbolicLink()
      || !privateStat.isFile()
      || !publicStat.isFile()
    ) {
      throw new Error('Local skill-signing keys must be regular files, not symbolic links');
    }
    fs.chmodSync(privatePath, 0o600);
    const derivedPublic = createPublicKey(fs.readFileSync(privatePath, 'utf-8'))
      .export({ type: 'spki', format: 'pem' })
      .toString();
    if (derivedPublic !== fs.readFileSync(publicPath, 'utf-8')) {
      throw new Error('Local skill-signing public and private keys do not match');
    }
    return;
  }

  fs.mkdirSync(signingDir(), { recursive: true, mode: 0o700 });
  const pair = generateKeyPairSync('ed25519');
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });

  fs.writeFileSync(privatePath, privatePem, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  fs.writeFileSync(publicPath, publicPem, { encoding: 'utf-8', mode: 0o644, flag: 'wx' });
  fs.chmodSync(privatePath, 0o600);
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) sorted[key] = sortForCanonicalJson(child);
    }
    return sorted;
  }
  return value;
}

/** Produce the stable byte representation used for signing and verification. */
export function canonicalizeManifest(manifest: unknown): string {
  return JSON.stringify(sortForCanonicalJson(manifest));
}

/** Return this installation's public key, generating the key pair if needed. */
export function getPublicKey(): string {
  ensureLocalKeyPair();
  return fs.readFileSync(publicKeyPath(), 'utf-8');
}

/** Return a short, stable SHA-256 identifier for a public key. */
export function publicKeyId(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('base64url').slice(0, 12);
}

/** Return this installation's public-key identifier. */
export function getPublicKeyId(): string {
  return publicKeyId(getPublicKey());
}

/** Sign a manifest with the local private key and return a base64url signature. */
export function signManifest(manifest: unknown): string {
  ensureLocalKeyPair();
  const data = Buffer.from(canonicalizeManifest(manifest), 'utf-8');
  return sign(null, data, fs.readFileSync(privateKeyPath(), 'utf-8')).toString('base64url');
}

/** Verify a manifest signature. Malformed keys/signatures fail closed. */
export function verifyManifest(manifest: unknown, signature: string, publicKey: string): boolean {
  try {
    const data = Buffer.from(canonicalizeManifest(manifest), 'utf-8');
    return verify(null, data, publicKey, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}
