import fs from 'node:fs';
import path from 'node:path';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { publicKeyId } from '../../skills/skill-signing.js';
import { getCodeBuddyHome } from '../../utils/codebuddy-home.js';
import { assertRucheEnabled, RucheJournal, type RucheEvent, type RucheIdentity, type RucheTrust } from './journal.js';
import { RucheAuthority } from './authority.js';

function regularFile(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('RUCHE_UNSAFE_FILE');
  return true;
}

function loadIdentity(root: string, name: 'agent' | 'arbiter'): RucheIdentity {
  const privatePath = path.join(root, `${name}.key.pem`);
  const publicPath = path.join(root, `${name}.pub.pem`);
  const hasPrivate = regularFile(privatePath);
  const hasPublic = regularFile(publicPath);
  if (hasPrivate !== hasPublic) throw new Error('RUCHE_INCOMPLETE_IDENTITY');
  if (!hasPrivate) {
    const pair = generateKeyPairSync('ed25519');
    fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(publicPath, pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  }
  const privateKey = fs.readFileSync(privatePath, 'utf8');
  fs.chmodSync(privatePath, 0o600);
  const publicKey = fs.readFileSync(publicPath, 'utf8');
  const derived = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  if (derived !== publicKey) throw new Error('RUCHE_IDENTITY_MISMATCH');
  return { id: publicKeyId(publicKey), publicKey, privateKey };
}

export interface LocalRuche {
  agent: RucheJournal;
  authority: RucheAuthority;
  agentId: string;
  arbiterId: string;
  events: RucheEvent[];
  persist(): void;
}

/** Local single-host prototype. Every CLI operation holds an exclusive directory lock. */
export function withLocalRuche<T>(fn: (state: LocalRuche) => T): T {
  assertRucheEnabled();
  const root = path.join(getCodeBuddyHome(), 'ruche');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('RUCHE_UNSAFE_DIRECTORY');
  const lock = path.join(root, 'lock');
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch {
    throw new Error('RUCHE_LOCKED');
  }
  try {
    const agentIdentity = loadIdentity(root, 'agent');
    const arbiterIdentity = loadIdentity(root, 'arbiter');
    const trust = new Map<string, RucheTrust>([
      [agentIdentity.id, { publicKey: agentIdentity.publicKey, role: 'agent' }],
      [arbiterIdentity.id, { publicKey: arbiterIdentity.publicKey, role: 'arbitre' }],
    ]);
    const trustFile = path.join(root, 'trusted-keys.json');
    if (regularFile(trustFile)) {
      const entries: unknown = JSON.parse(fs.readFileSync(trustFile, 'utf8'));
      if (!Array.isArray(entries) || entries.length > 64) throw new Error('RUCHE_INVALID_TRUST_FILE');
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') throw new Error('RUCHE_INVALID_TRUST_FILE');
        const { id, publicKey, role } = entry as Record<string, unknown>;
        if (typeof id !== 'string' || typeof publicKey !== 'string'
          || publicKeyId(publicKey) !== id || (role !== 'agent' && role !== 'humain')
          || trust.has(id)) throw new Error('RUCHE_INVALID_TRUST_FILE');
        trust.set(id, { publicKey, role });
      }
    }
    const agent = new RucheJournal(agentIdentity, trust);
    const arbiterJournal = new RucheJournal(arbiterIdentity, trust);
    const file = path.join(root, 'events.jsonl');
    const existing: RucheEvent[] = regularFile(file)
      ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as RucheEvent)
      : [];
    for (const event of existing) {
      arbiterJournal.ingest(event);
      if (event.agentId === agentIdentity.id) agent.ingest(event);
    }
    const seen = new Set(existing.map((event) => event.hash));
    const persist = (): void => {
      for (const event of arbiterJournal.events()) {
        if (seen.has(event.hash)) continue;
        fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
        seen.add(event.hash);
      }
    };
    const authority = new RucheAuthority(arbiterJournal, Date.now, persist);
    return fn({ agent, authority, agentId: agentIdentity.id, arbiterId: arbiterIdentity.id, events: existing, persist });
  } finally {
    fs.rmdirSync(lock);
  }
}
