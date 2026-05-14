/**
 * Server API key management command.
 *
 * These keys authenticate the HTTP/WebSocket server used by Fleet, Cowork,
 * and remote peer tooling. Provider API keys stay under `buddy secrets`.
 */

import { Command } from 'commander';
import type { ApiScope } from '../../server/types.js';
import {
  createApiKey,
  deleteApiKey,
  getApiKeyById,
  getApiKeyStats,
  getApiKeyStorePath,
  listAllApiKeys,
  listApiKeys,
  revokeApiKey,
} from '../../server/auth/api-keys.js';

const VALID_SCOPES: ApiScope[] = [
  'read',
  'chat',
  'chat:stream',
  'tools',
  'tools:execute',
  'sessions',
  'sessions:write',
  'memory',
  'memory:write',
  'admin',
  'fleet:listen',
  'peer:invoke',
];

function collectScope(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function splitScopes(values: string[]): string[] {
  return values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
}

function toApiScopes(values: string[]): ApiScope[] {
  const scopes = splitScopes(values);
  const invalid = scopes.filter((scope) => !VALID_SCOPES.includes(scope as ApiScope));
  if (invalid.length > 0) {
    throw new Error(`Invalid scope(s): ${invalid.join(', ')}. Valid scopes: ${VALID_SCOPES.join(', ')}`);
  }
  return scopes as ApiScope[];
}

function parseExpiresIn(value?: string): number | undefined {
  if (!value) return undefined;

  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error('Invalid --expires-in value. Use a duration such as 30m, 12h, or 7d.');
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return amount * multipliers[unit];
}

function formatDate(date?: Date): string {
  return date ? date.toISOString() : '-';
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printKeyRows(keys: ReturnType<typeof listApiKeys>): void {
  if (keys.length === 0) {
    console.log('No server API keys found.');
    return;
  }

  for (const key of keys) {
    const state = key.active ? 'active' : 'revoked';
    console.log(`${key.id}  ${key.name}  ${state}`);
    console.log(`  user:    ${key.userId}`);
    console.log(`  preview: ${key.keyPreview ?? '(created before previews were stored)'}`);
    console.log(`  scopes:  ${key.scopes.join(', ')}`);
    console.log(`  created: ${formatDate(key.createdAt)}`);
    console.log(`  expires: ${formatDate(key.expiresAt)}`);
    console.log(`  used:    ${formatDate(key.lastUsedAt)}`);
  }
}

export function createApiKeyCommand(): Command {
  const command = new Command('api-key');
  command
    .alias('api-keys')
    .description('Manage Code Buddy server API keys for Fleet, Cowork, and peer tools');

  command
    .command('create')
    .description('Create a server API key')
    .option('-n, --name <name>', 'Key name', 'Local server key')
    .option('-u, --user <userId>', 'Owner/user ID', 'local')
    .option('-s, --scope <scope>', 'Scope to grant (repeatable or comma-separated)', collectScope, [])
    .option('--scopes <scopes>', 'Comma-separated scopes to grant')
    .option('--rate-limit <requests>', 'Per-key rate limit override')
    .option('--expires-in <duration>', 'Expiration duration, for example 30m, 12h, or 7d')
    .option('--json', 'Output JSON')
    .action((options: {
      name: string;
      user: string;
      scope: string[];
      scopes?: string;
      rateLimit?: string;
      expiresIn?: string;
      json?: boolean;
    }) => {
      try {
        const rawScopes = [...(options.scope ?? []), ...(options.scopes ? [options.scopes] : [])];
        const scopes = rawScopes.length > 0 ? toApiScopes(rawScopes) : undefined;
        const rateLimit = options.rateLimit ? Number.parseInt(options.rateLimit, 10) : undefined;
        if (rateLimit !== undefined && (!Number.isInteger(rateLimit) || rateLimit <= 0)) {
          throw new Error('Invalid --rate-limit value. Use a positive integer.');
        }

        const { key, apiKey } = createApiKey({
          name: options.name,
          userId: options.user,
          scopes,
          rateLimit,
          expiresIn: parseExpiresIn(options.expiresIn),
        });

        const result = {
          id: apiKey.id,
          key,
          keyPreview: apiKey.keyPreview,
          name: apiKey.name,
          userId: apiKey.userId,
          scopes: apiKey.scopes,
          active: apiKey.active,
          createdAt: apiKey.createdAt.toISOString(),
          expiresAt: apiKey.expiresAt?.toISOString(),
          store: getApiKeyStorePath(),
        };

        if (options.json) {
          printJson(result);
          return;
        }

        console.log('Server API key created. Copy it now; the full key is shown only once.');
        console.log(`  key:    ${key}`);
        console.log(`  id:     ${apiKey.id}`);
        console.log(`  scopes: ${apiKey.scopes.join(', ')}`);
        console.log(`  store:  ${getApiKeyStorePath()}`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  command
    .command('list')
    .description('List stored server API keys without revealing secrets')
    .option('-u, --user <userId>', 'Filter by owner/user ID', 'local')
    .option('--all-users', 'Show keys for all users')
    .option('--json', 'Output JSON')
    .action((options: { user: string; allUsers?: boolean; json?: boolean }) => {
      const keys = options.allUsers ? listAllApiKeys() : listApiKeys(options.user);
      if (options.json) {
        printJson({ keys, store: getApiKeyStorePath() });
        return;
      }

      printKeyRows(keys);
      console.log(`\nStore: ${getApiKeyStorePath()}`);
    });

  command
    .command('revoke')
    .description('Revoke a server API key by ID')
    .argument('<id>', 'API key ID')
    .option('--json', 'Output JSON')
    .action((id: string, options: { json?: boolean }) => {
      const revoked = revokeApiKey(id);
      if (!revoked) {
        console.error(`API key not found: ${id}`);
        process.exit(1);
      }

      if (options.json) {
        printJson({ id, revoked: true, store: getApiKeyStorePath() });
        return;
      }

      console.log(`Server API key revoked: ${id}`);
    });

  command
    .command('delete')
    .description('Permanently delete a server API key by ID')
    .argument('<id>', 'API key ID')
    .option('-u, --user <userId>', 'Owner/user ID. Defaults to the key owner if found.')
    .option('--json', 'Output JSON')
    .action((id: string, options: { user?: string; json?: boolean }) => {
      const existing = getApiKeyById(id);
      const userId = options.user ?? existing?.userId;
      if (!userId || !deleteApiKey(id, userId)) {
        console.error(`API key not found: ${id}`);
        process.exit(1);
      }

      if (options.json) {
        printJson({ id, deleted: true, store: getApiKeyStorePath() });
        return;
      }

      console.log(`Server API key deleted: ${id}`);
    });

  command
    .command('stats')
    .description('Show server API key store stats')
    .option('--json', 'Output JSON')
    .action((options: { json?: boolean }) => {
      const stats = getApiKeyStats();
      if (options.json) {
        printJson({ ...stats, store: getApiKeyStorePath() });
        return;
      }

      console.log(`total:   ${stats.total}`);
      console.log(`active:  ${stats.active}`);
      console.log(`expired: ${stats.expired}`);
      console.log(`store:   ${getApiKeyStorePath()}`);
    });

  return command;
}
