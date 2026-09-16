/**
 * Fleet rooms — member key file.
 *
 * A Buzz agent is identified by its own keypair (`BUZZ_PRIVATE_KEY`); a fleet
 * room member likewise owns a secp256k1 key stored in a 0600 JSON file,
 * `$CODEBUDDY_FLEET_ROOMS_IDENTITY` or `<CODEBUDDY_HOME>/fleet/rooms-identity.json`.
 * The file is only created on explicit request and never overwritten silently;
 * on POSIX a file readable by group or others is refused, like an SSH key.
 * The secret never leaves this module except as the signing input.
 *
 * @module fleet/rooms/room-identity
 */

import fs from 'fs';
import path from 'path';

import { getCodeBuddyPath } from '../../utils/codebuddy-home.js';
import { deriveRoomPublicKey, generateRoomSecretKey, isHex64 } from './room-event.js';

export interface RoomIdentity {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly path: string;
}

export class RoomIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomIdentityError';
  }
}

export function defaultRoomIdentityPath(): string {
  return process.env.CODEBUDDY_FLEET_ROOMS_IDENTITY || getCodeBuddyPath('fleet', 'rooms-identity.json');
}

/** Create a new identity file. Refuses to replace an existing one unless `force`. */
export function createRoomIdentity(filePath = defaultRoomIdentityPath(), options: { force?: boolean } = {}): RoomIdentity {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const secretKey = generateRoomSecretKey();
  const publicKey = deriveRoomPublicKey(secretKey);
  const body = `${JSON.stringify({ version: 1, publicKey, secretKey, createdAt: new Date().toISOString() }, null, 2)}\n`;
  if (options.force && fs.existsSync(filePath)) {
    fs.renameSync(filePath, `${filePath}.replaced-${Date.now()}`);
  }
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new RoomIdentityError(`identity file already exists: ${filePath} (use --force to rotate it)`);
    }
    throw error;
  }
  try {
    fs.writeSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return Object.freeze({ publicKey, secretKey, path: filePath });
}

export function loadRoomIdentity(filePath = defaultRoomIdentityPath()): RoomIdentity {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new RoomIdentityError(`no fleet room identity at ${filePath}; run \`buddy fleet rooms identity init\``);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new RoomIdentityError(`identity file ${filePath} is readable by other users; chmod 600 it`);
  }
  if (stat.size > 4_096) throw new RoomIdentityError(`identity file ${filePath} is not a room identity`);
  let parsed: { version?: unknown; publicKey?: unknown; secretKey?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new RoomIdentityError(`identity file ${filePath} is not valid JSON`);
  }
  if (parsed.version !== 1 || !isHex64(parsed.secretKey) || !isHex64(parsed.publicKey)) {
    throw new RoomIdentityError(`identity file ${filePath} is not a room identity`);
  }
  if (deriveRoomPublicKey(parsed.secretKey) !== parsed.publicKey) {
    throw new RoomIdentityError(`identity file ${filePath} is inconsistent (public key mismatch)`);
  }
  return Object.freeze({ publicKey: parsed.publicKey, secretKey: parsed.secretKey, path: filePath });
}
