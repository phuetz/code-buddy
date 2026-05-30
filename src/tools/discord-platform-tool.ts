export type DiscordAction = 'fetch_messages' | 'search_members' | 'create_thread';

export interface DiscordToolOptions {
  token?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface DiscordToolExecutionResult {
  kind: 'discord_result';
  ok: boolean;
  action: DiscordAction;
  data?: unknown;
  request?: {
    method: 'GET' | 'POST';
    path: string;
  };
  error?: string;
}

interface DiscordRequestOptions {
  token: string;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_THREAD_ARCHIVE_DURATIONS = new Set([60, 1440, 4320, 10080]);

export async function executeDiscordTool(
  input: Record<string, unknown>,
  options: DiscordToolOptions = {},
): Promise<DiscordToolExecutionResult> {
  const action = parseAction(input.action);
  const token = options.token ?? process.env.DISCORD_BOT_TOKEN ?? process.env.CODEBUDDY_DISCORD_BOT_TOKEN;
  if (!token?.trim()) {
    return {
      kind: 'discord_result',
      ok: false,
      action,
      error: 'DISCORD_BOT_TOKEN is required for discord tool access',
    };
  }

  const apiBaseUrl = (options.apiBaseUrl ?? process.env.CODEBUDDY_DISCORD_API_BASE_URL ?? DISCORD_API_BASE).trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      kind: 'discord_result',
      ok: false,
      action,
      error: 'fetch is not available in this runtime',
    };
  }

  try {
    switch (action) {
      case 'fetch_messages':
        return await fetchMessages(input, { token, apiBaseUrl, fetchImpl });
      case 'search_members':
        return await searchMembers(input, { token, apiBaseUrl, fetchImpl });
      case 'create_thread':
        return await createThread(input, { token, apiBaseUrl, fetchImpl });
    }
  } catch (error) {
    return {
      kind: 'discord_result',
      ok: false,
      action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchMessages(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const channelId = requiredString(input, 'channel_id');
  const limit = normalizeLimit(input.limit, 50);
  const query: Record<string, string> = { limit: String(limit) };
  const before = optionalString(input, 'before');
  const after = optionalString(input, 'after');
  if (before) query.before = before;
  if (after) query.after = after;

  const path = `/channels/${encodeURIComponent(channelId)}/messages`;
  const data = await discordRequest<unknown[]>({
    ...context,
    method: 'GET',
    path,
    query,
  });

  const messages = Array.isArray(data) ? data.map(normalizeMessage) : [];
  return okResult('fetch_messages', { messages, count: messages.length }, 'GET', path);
}

async function searchMembers(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const guildId = requiredString(input, 'guild_id');
  const queryText = requiredString(input, 'query');
  const limit = normalizeLimit(input.limit, 20);
  const path = `/guilds/${encodeURIComponent(guildId)}/members/search`;
  const data = await discordRequest<unknown[]>({
    ...context,
    method: 'GET',
    path,
    query: {
      query: queryText,
      limit: String(limit),
    },
  });

  const members = Array.isArray(data) ? data.map(normalizeMember) : [];
  return okResult('search_members', { members, count: members.length }, 'GET', path);
}

async function createThread(
  input: Record<string, unknown>,
  context: Pick<DiscordRequestOptions, 'token' | 'apiBaseUrl' | 'fetchImpl'>,
): Promise<DiscordToolExecutionResult> {
  const channelId = requiredString(input, 'channel_id');
  const name = requiredString(input, 'name');
  const messageId = optionalString(input, 'message_id');
  const autoArchiveDuration = normalizeArchiveDuration(input.auto_archive_duration);
  const path = messageId
    ? `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/threads`
    : `/channels/${encodeURIComponent(channelId)}/threads`;
  const body: Record<string, unknown> = {
    name,
    auto_archive_duration: autoArchiveDuration,
  };
  if (!messageId) {
    body.type = 11;
  }

  const data = await discordRequest<Record<string, unknown>>({
    ...context,
    method: 'POST',
    path,
    body,
  });

  return okResult(
    'create_thread',
    {
      success: true,
      thread_id: typeof data.id === 'string' ? data.id : undefined,
      name: typeof data.name === 'string' ? data.name : name,
    },
    'POST',
    path,
  );
}

async function discordRequest<T>(options: DiscordRequestOptions): Promise<T> {
  const url = new URL(options.path, normalizeBaseUrl(options.apiBaseUrl));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await options.fetchImpl(url, {
    method: options.method,
    headers: {
      Authorization: `Bot ${options.token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const raw = await response.text();
  const body = raw ? parseJson(raw) : null;
  if (!response.ok) {
    const reason = typeof body === 'object' && body && 'message' in body
      ? String((body as { message?: unknown }).message)
      : raw || response.statusText;
    throw new Error(`Discord API error ${response.status}: ${reason}`);
  }
  return body as T;
}

function okResult(
  action: DiscordAction,
  data: unknown,
  method: 'GET' | 'POST',
  path: string,
): DiscordToolExecutionResult {
  return {
    kind: 'discord_result',
    ok: true,
    action,
    data,
    request: { method, path },
  };
}

function normalizeMessage(message: unknown): Record<string, unknown> {
  const record = asRecord(message);
  const author = asRecord(record.author);
  const attachments = Array.isArray(record.attachments)
    ? record.attachments.map((attachment) => {
        const item = asRecord(attachment);
        return {
          filename: item.filename,
          url: item.url,
          size: item.size,
        };
      })
    : [];
  const reactions = Array.isArray(record.reactions)
    ? record.reactions.map((reaction) => {
        const item = asRecord(reaction);
        const emoji = asRecord(item.emoji);
        return {
          emoji: emoji.name,
          count: item.count ?? 0,
        };
      })
    : [];

  return {
    id: record.id,
    content: typeof record.content === 'string' ? record.content : '',
    author: {
      id: author.id,
      username: author.username,
      display_name: author.global_name,
      bot: author.bot === true,
    },
    timestamp: record.timestamp,
    edited_timestamp: record.edited_timestamp,
    attachments,
    reactions,
    pinned: record.pinned === true,
  };
}

function normalizeMember(member: unknown): Record<string, unknown> {
  const record = asRecord(member);
  const user = asRecord(record.user);
  return {
    user_id: user.id,
    username: user.username,
    display_name: user.global_name,
    nickname: record.nick,
    bot: user.bot === true,
    roles: Array.isArray(record.roles) ? record.roles : [],
  };
}

function parseAction(value: unknown): DiscordAction {
  if (value === 'fetch_messages' || value === 'search_members' || value === 'create_thread') {
    return value;
  }
  throw new Error('action must be one of: fetch_messages, search_members, create_thread');
}

function normalizeLimit(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error('limit must be an integer between 1 and 100');
  }
  return parsed;
}

function normalizeArchiveDuration(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 1440;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !DISCORD_THREAD_ARCHIVE_DURATIONS.has(parsed)) {
    throw new Error('auto_archive_duration must be one of: 60, 1440, 4320, 10080');
  }
  return parsed;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
