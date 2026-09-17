/**
 * Secrets Management Command
 *
 * Secure management of API keys, tokens, and credentials.
 * Advanced enterprise architecture for `Native Engine secrets` CLI.
 *
 * Usage:
 *   buddy secrets list
 *   buddy secrets set <name> <value>
 *   buddy secrets get <name>
 *   buddy secrets remove <name>
 *   buddy secrets rotate <name>
 *   buddy secrets audit
 */

import type { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// ============================================================================
// Secrets Store
// ============================================================================

interface SecretEntry {
  name: string;
  value: string;
  createdAt: string;
  updatedAt: string;
  rotatedAt?: string;
  source: 'manual' | 'env' | 'import';
}

interface SecretsStore {
  version: number;
  secrets: Record<string, SecretEntry>;
}

const SECRETS_DIR = path.join(homedir(), '.codebuddy', 'secrets');
const SECRETS_FILE = path.join(SECRETS_DIR, 'vault.enc');
const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 32;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

function encrypt(text: string, passphrase: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decrypt(data: string, passphrase: string): string {
  const [saltHex, ivHex, tagHex, encrypted] = data.split(':');
  if (
    saltHex === undefined ||
    ivHex === undefined ||
    tagHex === undefined ||
    encrypted === undefined
  ) {
    throw new Error('Malformed encrypted vault data');
  }
  const salt = Buffer.from(saltHex, 'hex');
  const key = deriveKey(passphrase, salt);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function loadStore(passphrase: string): Promise<SecretsStore> {
  try {
    const raw = await fs.readFile(SECRETS_FILE, 'utf8');
    const decrypted = decrypt(raw, passphrase);
    return JSON.parse(decrypted);
  } catch {
    return { version: 1, secrets: {} };
  }
}

async function saveStore(store: SecretsStore, passphrase: string): Promise<void> {
  await fs.mkdir(SECRETS_DIR, { recursive: true });
  const encrypted = encrypt(JSON.stringify(store), passphrase);
  await fs.writeFile(SECRETS_FILE, encrypted, { mode: 0o600 });
}

function getPassphrase(): string {
  const key = process.env.CODEBUDDY_VAULT_KEY;
  if (!key) {
    throw new Error(
      'CODEBUDDY_VAULT_KEY environment variable is not set.\n' +
      'Set it before using the secrets vault:\n' +
      '  export CODEBUDDY_VAULT_KEY="your-secure-passphrase"'
    );
  }
  return key;
}

// ============================================================================
// Well-Known Secrets
// ============================================================================

const KNOWN_SECRETS = [
  'GROK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
  'MORPH_API_KEY', 'BRAVE_API_KEY', 'EXA_API_KEY', 'PERPLEXITY_API_KEY',
  'OPENROUTER_API_KEY', 'JWT_SECRET', 'PICOVOICE_ACCESS_KEY', 'SENTRY_DSN',
  'DISCORD_BOT_TOKEN', 'SLACK_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN',
  'WHATSAPP_API_TOKEN', 'SIGNAL_API_TOKEN',
  'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'NETLIFY_AUTH_TOKEN',
];

/**
 * Read a named secret from env, then the encrypted vault when
 * CODEBUDDY_VAULT_KEY is set. Never logs the value.
 */
export async function peekSecret(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const fromEnv = env[name];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const key = env.CODEBUDDY_VAULT_KEY;
  if (!key) return null;
  try {
    const store = await loadStore(key);
    return store.secrets[name]?.value ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerSecretsCommands(program: Command): void {
  const secrets = program
    .command('secrets')
    .description('Manage API keys and credentials (encrypted vault)');

  secrets
    .command('list')
    .description('List all stored secrets (names only)')
    .action(async () => {
      const store = await loadStore(getPassphrase());
      const names = Object.keys(store.secrets);
      if (names.length === 0) {
        console.log('No secrets stored. Use `buddy secrets set <name> <value>` to add one.');
        return;
      }
      console.log(`\nStored Secrets (${names.length}):\n`);
      for (const name of names.sort()) {
        const entry = store.secrets[name];
        if (!entry) continue;
        const masked = entry.value.slice(0, 4) + '****' + entry.value.slice(-4);
        console.log(`  ${name}: ${masked}  (${entry.source}, updated ${entry.updatedAt})`);
      }
    });

  secrets
    .command('set')
    .description('Set a secret value')
    .argument('<name>', 'Secret name (e.g., GROK_API_KEY)')
    .argument('<value>', 'Secret value')
    .action(async (name, value) => {
      const pp = getPassphrase();
      const store = await loadStore(pp);
      const now = new Date().toISOString();
      const existing = store.secrets[name];
      store.secrets[name] = {
        name,
        value,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        source: 'manual',
      };
      await saveStore(store, pp);
      console.log(`Secret '${name}' saved.`);
    });

  secrets
    .command('get')
    .description('Get a secret value')
    .argument('<name>', 'Secret name')
    .action(async (name) => {
      const store = await loadStore(getPassphrase());
      const entry = store.secrets[name];
      if (!entry) {
        console.error(`Secret '${name}' not found.`);
        process.exit(1);
      }
      console.log(entry.value);
    });

  secrets
    .command('remove')
    .description('Remove a secret')
    .argument('<name>', 'Secret name')
    .action(async (name) => {
      const pp = getPassphrase();
      const store = await loadStore(pp);
      if (!store.secrets[name]) {
        console.error(`Secret '${name}' not found.`);
        process.exit(1);
      }
      delete store.secrets[name];
      await saveStore(store, pp);
      console.log(`Secret '${name}' removed.`);
    });

  secrets
    .command('rotate')
    .description('Mark a secret as rotated (update timestamp)')
    .argument('<name>', 'Secret name')
    .argument('<value>', 'New secret value')
    .action(async (name, value) => {
      const pp = getPassphrase();
      const store = await loadStore(pp);
      const existing = store.secrets[name];
      if (!existing) {
        console.error(`Secret '${name}' not found. Use 'set' to create it.`);
        process.exit(1);
      }
      const now = new Date().toISOString();
      store.secrets[name] = {
        ...existing,
        value,
        updatedAt: now,
        rotatedAt: now,
      };
      await saveStore(store, pp);
      console.log(`Secret '${name}' rotated.`);
    });

  secrets
    .command('audit')
    .description('Audit secrets — check for missing, old, or env-only keys')
    .action(async () => {
      const store = await loadStore(getPassphrase());
      console.log('\n=== Secrets Audit ===\n');

      // Check env vars
      let envCount = 0;
      for (const key of KNOWN_SECRETS) {
        const inVault = !!store.secrets[key];
        const inEnv = !!process.env[key];
        if (inEnv && !inVault) {
          console.log(`  ⚠ ${key}: found in env but not in vault (consider 'buddy secrets set')`);
          envCount++;
        } else if (inVault && !inEnv) {
          console.log(`  ✓ ${key}: in vault (not in env — vault takes priority)`);
        } else if (inVault && inEnv) {
          console.log(`  ✓ ${key}: in both vault and env`);
        }
      }

      // Check staleness
      const now = Date.now();
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      for (const [name, entry] of Object.entries(store.secrets)) {
        const age = now - new Date(entry.updatedAt).getTime();
        if (age > THIRTY_DAYS) {
          console.log(`  ⏰ ${name}: last updated ${Math.floor(age / (24 * 60 * 60 * 1000))} days ago — consider rotating`);
        }
      }

      if (envCount === 0 && Object.keys(store.secrets).length === 0) {
        console.log('  No secrets configured. Run `buddy secrets set <name> <value>` to get started.');
      }

      console.log('\n=== End Audit ===');
    });

  secrets
    .command('import-env')
    .description('Import secrets from current environment variables')
    .action(async () => {
      const pp = getPassphrase();
      const store = await loadStore(pp);
      const now = new Date().toISOString();
      let imported = 0;
      for (const key of KNOWN_SECRETS) {
        const value = process.env[key];
        if (value && !store.secrets[key]) {
          store.secrets[key] = {
            name: key,
            value,
            createdAt: now,
            updatedAt: now,
            source: 'env',
          };
          imported++;
        }
      }
      await saveStore(store, pp);
      console.log(`Imported ${imported} secret(s) from environment.`);
    });
}
