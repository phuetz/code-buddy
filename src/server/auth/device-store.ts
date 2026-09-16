import { createHash, randomBytes, randomInt, randomUUID, webcrypto } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { auditLogger } from '../../security/audit-logger.js';
import { readDeviceStoreFile, updateDeviceStoreFile } from '../../utils/device-store-file.js';
import { generateToken } from './jwt.js';

export const PAIRING_TTL_MS = 10 * 60_000;
export const DEVICE_NONCE_TTL_MS = 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const publicKeySchema = z.object({
  kty: z.literal('EC'), crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const nameSchema = z.string().trim().min(1).max(80).regex(/^[^\p{Cc}\p{Cf}<>]*$/u);
const deviceSchema = z.object({
  deviceId: z.string().uuid(), deviceName: nameSchema,
  publicKeyJwk: publicKeySchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  lastVerifiedAt: z.string().datetime().optional(), revokedAt: z.string().datetime().optional(),
});
const authDataSchema = z.object({
  devices: z.array(deviceSchema),
  pairings: z.array(z.object({ hash: z.string(), expiresAt: z.number() })),
});
export type AuthDevice = z.infer<typeof deviceSchema>;
type AuthData = z.infer<typeof authDataSchema>;
export type DeviceAudit = (action: 'device_register' | 'device_verify' | 'device_revoke', allowed: boolean) => void;

export class DeviceAuthError extends Error {
  constructor(public readonly status: number) {
    super(status === 400 ? 'Invalid pairing request' : status === 401 ? 'Authentication failed' : 'Device authentication unavailable');
  }
}

function authData(envelope: Record<string, unknown>): AuthData {
  if (envelope.deviceAuth === undefined) return { devices: [], pairings: [] };
  const parsed = authDataSchema.safeParse(envelope.deviceAuth);
  if (!parsed.success) throw new DeviceAuthError(503);
  return parsed.data;
}

function pairingHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Accept JOSE/P1363 and Android's native, minimally encoded ASN.1 DER. */
function signatureCandidates(encoded: string): Buffer[] {
  if (encoded.length > 100 || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(encoded)) throw new DeviceAuthError(401);
  const bytes = Buffer.from(encoded, 'base64url');
  const normalized = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (bytes.toString('base64url') !== normalized) throw new DeviceAuthError(401);
  const candidates: Buffer[] = bytes.length === 64 ? [bytes] : [];
  // P-256 DER always uses short lengths (at most 72 bytes in total).
  if (bytes.length < 8 || bytes.length > 72 || bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2) return candidates;
  let cursor = 2;
  const raw = Buffer.alloc(64);
  for (let component = 0; component < 2; component++) {
    if (bytes[cursor++] !== 0x02) return candidates;
    const length = bytes[cursor++];
    if (!length || length > 33 || cursor + length > bytes.length) return candidates;
    let integer = bytes.subarray(cursor, cursor + length);
    cursor += length;
    const first = integer[0];
    if (first === undefined || (first & 0x80) !== 0) return candidates;
    if (integer.length > 1 && first === 0) {
      const second = integer[1];
      if (second === undefined || (second & 0x80) === 0) return candidates;
      integer = integer.subarray(1);
    }
    if (integer.length > 32) return candidates;
    integer.copy(raw, (component + 1) * 32 - integer.length);
  }
  if (cursor === bytes.length) candidates.push(raw);
  return candidates;
}

/** Only public keys persist; nonces are bounded, process-local and lost on restart. */
export class DeviceAuthStore {
  private readonly nonces = new Map<string, { nonce: string; expiresAt: number }>();
  private readonly audit: DeviceAudit;

  constructor(
    readonly file = join(homedir(), '.codebuddy', 'devices.json'),
    private readonly now: () => number = Date.now,
    audit?: DeviceAudit,
  ) {
    if (audit) this.audit = audit;
    else {
      auditLogger.init({ logDir: join(dirname(file), 'audit') });
      this.audit = (action, allowed) => auditLogger.log({
        action, decision: allowed ? 'allow' : 'block', source: 'device-auth',
      });
    }
  }

  private update<T>(fn: (data: AuthData) => T): T {
    return updateDeviceStoreFile(this.file, envelope => {
      const data = authData(envelope);
      const result = fn(data);
      envelope.deviceAuth = data;
      return result;
    });
  }

  list(): AuthDevice[] {
    return authData(readDeviceStoreFile(this.file)).devices;
  }

  isActive(deviceId: string): boolean {
    try {
      return this.list().some(device => device.deviceId === deviceId && !device.revokedAt);
    } catch {
      return false;
    }
  }

  /** Local CLI only. There is deliberately no HTTP endpoint for issuing codes. */
  createPairing(): { pairingCode: string; expiresAt: string } {
    return this.update(data => {
      data.pairings = data.pairings.filter(code => code.expiresAt > this.now());
      if (data.pairings.length >= 20) throw new DeviceAuthError(503);
      let pairingCode: string;
      do {
        pairingCode = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      } while (data.pairings.some(code => code.hash === pairingHash(pairingCode)));
      const expiresAt = this.now() + PAIRING_TTL_MS;
      data.pairings.push({ hash: pairingHash(pairingCode), expiresAt });
      return { pairingCode, expiresAt: new Date(expiresAt).toISOString() };
    });
  }

  async register(pairingCode: unknown, deviceName: unknown, publicKeyJwk: unknown): Promise<{ deviceId: string }> {
    let allowed = false;
    try {
      const name = nameSchema.safeParse(deviceName);
      const key = publicKeySchema.safeParse(publicKeyJwk);
      if (typeof pairingCode !== 'string' || !/^[A-HJ-NP-Z2-9]{8}$/.test(pairingCode)
        || !name.success || !key.success || (publicKeyJwk && typeof publicKeyJwk === 'object' && 'd' in publicKeyJwk)) {
        throw new DeviceAuthError(400);
      }
      try {
        await webcrypto.subtle.importKey('jwk', key.data, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      } catch {
        throw new DeviceAuthError(400);
      }
      const result = this.update(data => {
        const index = data.pairings.findIndex(code => code.hash === pairingHash(pairingCode) && code.expiresAt > this.now());
        if (index < 0) throw new DeviceAuthError(400);
        data.pairings.splice(index, 1);
        const deviceId = randomUUID();
        const date = new Date(this.now()).toISOString();
        data.devices.push({ deviceId, deviceName: name.data, publicKeyJwk: key.data, createdAt: date, updatedAt: date });
        return { deviceId };
      });
      allowed = true;
      return result;
    } finally {
      this.audit('device_register', allowed);
    }
  }

  challenge(deviceId: unknown): { nonce: string; expiresAt: string } {
    if (typeof deviceId !== 'string' || !this.isActive(deviceId)) throw new DeviceAuthError(401);
    for (const [id, entry] of this.nonces) if (entry.expiresAt <= this.now()) this.nonces.delete(id);
    if (this.nonces.size >= 1000 && !this.nonces.has(deviceId)) throw new DeviceAuthError(503);
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + DEVICE_NONCE_TTL_MS;
    this.nonces.set(deviceId, { nonce, expiresAt });
    return { nonce, expiresAt: new Date(expiresAt).toISOString() };
  }

  async verify(deviceId: unknown, nonce: unknown, signature: unknown, secret: string): Promise<{ token: string }> {
    let allowed = false;
    try {
      if (typeof deviceId !== 'string' || typeof nonce !== 'string' || typeof signature !== 'string') throw new DeviceAuthError(401);
      const challenge = this.nonces.get(deviceId);
      if (!challenge || challenge.nonce !== nonce) throw new DeviceAuthError(401);
      // Consume before any async crypto work, including failed signature attempts.
      this.nonces.delete(deviceId);
      if (challenge.expiresAt <= this.now()) throw new DeviceAuthError(401);
      const candidates = signatureCandidates(signature);
      const device = this.list().find(item => item.deviceId === deviceId && !item.revokedAt);
      if (!device) throw new DeviceAuthError(401);
      const key = await webcrypto.subtle.importKey('jwk', device.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      let valid = false;
      for (const candidate of candidates) {
        if (await webcrypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' }, key, candidate, Buffer.from(`${deviceId}.${nonce}`, 'utf8'),
        )) {
          valid = true;
          break;
        }
      }
      if (!valid) throw new DeviceAuthError(401);
      if (!secret || secret === 'change-me-in-production') throw new DeviceAuthError(503);
      // Re-read inside the transaction: revoke may have run during verification.
      const token = this.update(data => {
        const current = data.devices.find(item => item.deviceId === deviceId && !item.revokedAt);
        if (!current) throw new DeviceAuthError(401);
        current.lastVerifiedAt = new Date(this.now()).toISOString();
        return generateToken({
          sub: deviceId, type: 'user', scopes: ['chat', 'chat:stream', 'sessions', 'tools'],
          amr: ['biometric', 'device'], profile: 'agent', identity: 'owner',
        }, secret, '1h');
      });
      allowed = true;
      return { token };
    } finally {
      this.audit('device_verify', allowed);
    }
  }

  revoke(deviceId: string): void {
    let allowed = false;
    try {
      this.update(data => {
        const device = data.devices.find(item => item.deviceId === deviceId);
        if (!device) throw new DeviceAuthError(401);
        device.revokedAt ??= new Date(this.now()).toISOString();
        device.updatedAt = device.revokedAt;
      });
      this.nonces.delete(deviceId);
      allowed = true;
    } finally {
      this.audit('device_revoke', allowed);
    }
  }

  rename(deviceId: string, deviceName: string): void {
    const name = nameSchema.safeParse(deviceName);
    if (!name.success) throw new DeviceAuthError(400);
    this.update(data => {
      const device = data.devices.find(item => item.deviceId === deviceId);
      if (!device) throw new DeviceAuthError(401);
      device.deviceName = name.data;
      device.updatedAt = new Date(this.now()).toISOString();
    });
  }
}

let store: DeviceAuthStore | undefined;
export function getDeviceAuthStore(): DeviceAuthStore {
  return store ??= new DeviceAuthStore();
}
