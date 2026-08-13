/**
 * Declarative channel configuration schema shared by the core and Cowork.
 *
 * The renderer receives these definitions through the `channels.*` IPC bridge
 * and renders a channel-specific form. Secret fields are metadata only: their
 * values are deliberately excluded from config patches and live in the
 * encrypted CredentialManager instead of `channels.json`.
 */

export type ChannelConfigFieldKind =
  | 'text'
  | 'url'
  | 'number'
  | 'boolean'
  | 'string-list'
  | 'select'
  | 'secret';

export type ChannelConfigFieldValue = string | number | boolean | string[];

export interface ChannelConfigFieldDefinition {
  key: string;
  label: string;
  kind: ChannelConfigFieldKind;
  location: 'root' | 'options';
  required?: boolean;
  /** Primary secrets retain the historical `channel:<type>:token` vault key. */
  primarySecret?: boolean;
  placeholder?: string;
  choices?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}

export interface ChannelConfigDefinition {
  type: string;
  label: string;
  description: string;
  fields: ChannelConfigFieldDefinition[];
}

export interface ChannelConfigPatch {
  enabled?: boolean;
  webhookUrl?: string;
  allowedUsers?: string[];
  allowedChannels?: string[];
  options?: Record<string, ChannelConfigFieldValue>;
  /** Declared non-secret options to remove from the persisted entry. */
  unsetOptions?: string[];
}

export interface ChannelConfigLike {
  type: string;
  enabled: boolean;
  token?: string;
  webhookUrl?: string;
  allowedUsers?: string[];
  allowedChannels?: string[];
  options?: Record<string, unknown>;
}

const root = (
  key: string,
  label: string,
  kind: ChannelConfigFieldKind,
  extra: Omit<ChannelConfigFieldDefinition, 'key' | 'label' | 'kind' | 'location'> = {},
): ChannelConfigFieldDefinition => ({ key, label, kind, location: 'root', ...extra });

const option = (
  key: string,
  label: string,
  kind: ChannelConfigFieldKind,
  extra: Omit<ChannelConfigFieldDefinition, 'key' | 'label' | 'kind' | 'location'> = {},
): ChannelConfigFieldDefinition => ({ key, label, kind, location: 'options', ...extra });

const secret = (
  key: string,
  label: string,
  primarySecret = false,
  required = false,
): ChannelConfigFieldDefinition => option(key, label, 'secret', { primarySecret, required });

const CHANNEL_CONFIG_DEFINITIONS: readonly ChannelConfigDefinition[] = [
  {
    type: 'telegram',
    label: 'Telegram',
    description: 'Bot API via polling or webhook.',
    fields: [
      secret('token', 'Bot token', true, true),
      root('webhookUrl', 'Webhook URL', 'url'),
      secret('webhookSecret', 'Webhook secret'),
      option('botUsername', 'Bot username', 'text', { placeholder: 'without @' }),
      option('pollingTimeout', 'Polling timeout (seconds)', 'number', { min: 1, max: 120 }),
      option('defaultParseMode', 'Parse mode', 'select', {
        choices: ['Markdown', 'MarkdownV2', 'HTML'].map((value) => ({ value, label: value })),
      }),
      option('disableNotification', 'Silent notifications', 'boolean'),
    ],
  },
  {
    type: 'discord',
    label: 'Discord',
    description: 'Discord bot and optional guild-scoped commands.',
    fields: [
      secret('token', 'Bot token', true, true),
      option('applicationId', 'Application ID', 'text'),
      option('guildIds', 'Guild IDs', 'string-list'),
      option('adminUsers', 'Admin user IDs', 'string-list'),
      option('mentionOnly', 'Reply to mentions only', 'boolean'),
    ],
  },
  {
    type: 'slack',
    label: 'Slack',
    description: 'Slack bot using Socket Mode or the Events API.',
    fields: [
      secret('token', 'Bot token (xoxb-…)', true, true),
      secret('appToken', 'App token (xapp-…)'),
      secret('signingSecret', 'Signing secret'),
      option('socketMode', 'Socket Mode', 'boolean'),
      option('defaultChannel', 'Default channel', 'text'),
      option('adminUsers', 'Admin user IDs', 'string-list'),
    ],
  },
  {
    type: 'whatsapp',
    label: 'WhatsApp',
    description: 'Linked-device connection using an interactive QR code.',
    fields: [
      option('phoneNumber', 'Phone number', 'text', { placeholder: '+33123456789' }),
      option('sessionDataPath', 'Session data directory', 'text'),
      option('qrTimeout', 'QR timeout (ms)', 'number', { min: 5_000, max: 600_000 }),
      option('printQrInTerminal', 'Print QR in terminal', 'boolean'),
      option('browserName', 'Linked-device name', 'text'),
      option('markOnlineOnConnect', 'Mark online on connect', 'boolean'),
    ],
  },
  {
    type: 'signal',
    label: 'Signal',
    description: 'signal-cli REST API bridge.',
    fields: [
      option('phoneNumber', 'Phone number', 'text', { required: true, placeholder: '+33123456789' }),
      option('apiUrl', 'signal-cli API URL', 'url'),
      option('pollInterval', 'Poll interval (ms)', 'number', { min: 250, max: 300_000 }),
      option('trustAllIdentities', 'Trust all identities', 'boolean'),
    ],
  },
  {
    type: 'matrix',
    label: 'Matrix',
    description: 'Matrix homeserver bot with optional end-to-end encryption.',
    fields: [
      option('homeserverUrl', 'Homeserver URL', 'url', { required: true }),
      option('userId', 'User ID', 'text', { required: true, placeholder: '@buddy:matrix.org' }),
      secret('accessToken', 'Access token', true, true),
      option('deviceId', 'Device ID', 'text'),
      option('initialRooms', 'Initial room IDs', 'string-list'),
      option('autoJoin', 'Auto-join invitations', 'boolean'),
      option('enableEncryption', 'Enable encryption', 'boolean'),
      option('storePath', 'Crypto store path', 'text'),
    ],
  },
  {
    type: 'google-chat',
    label: 'Google Chat',
    description: 'Google Chat service-account integration.',
    fields: [
      option('serviceAccountPath', 'Service-account JSON path', 'text', { required: true }),
      option('spaceId', 'Default space ID', 'text'),
      root('webhookUrl', 'Webhook URL', 'url'),
      secret('verificationToken', 'Verification token', true),
      option('projectNumber', 'Google Cloud project number', 'text'),
    ],
  },
  {
    type: 'teams',
    label: 'Microsoft Teams',
    description: 'Azure Bot Framework integration.',
    fields: [
      option('appId', 'Application ID', 'text', { required: true }),
      secret('appPassword', 'Application password', true, true),
      option('tenantId', 'Tenant ID', 'text'),
      option('oauthAuthority', 'OAuth authority URL', 'url'),
    ],
  },
  {
    type: 'webchat',
    label: 'Web chat',
    description: 'Built-in WebSocket chat server.',
    fields: [
      option('host', 'Bind host', 'text'),
      option('port', 'Port', 'number', { min: 1, max: 65_535 }),
      option('corsOrigins', 'CORS origins', 'string-list'),
      option('title', 'Chat title', 'text'),
      option('maxMessageLength', 'Maximum message length', 'number', { min: 1, max: 1_000_000 }),
      secret('authToken', 'WebSocket auth token', true),
    ],
  },
  {
    type: 'dingtalk',
    label: 'DingTalk',
    description: 'DingTalk custom robot webhook.',
    fields: [
      secret('accessToken', 'Access token', true, true),
      secret('secret', 'Signing secret'),
      option('msgType', 'Message type', 'select', {
        choices: ['text', 'markdown'].map((value) => ({ value, label: value })),
      }),
      option('title', 'Markdown title', 'text'),
      option('atMobiles', 'Mentioned mobiles', 'string-list'),
      option('atUserIds', 'Mentioned user IDs', 'string-list'),
      option('isAtAll', 'Mention everyone', 'boolean'),
    ],
  },
  {
    type: 'wecom',
    label: 'WeCom',
    description: 'WeCom group robot webhook.',
    fields: [
      secret('key', 'Robot key', true, true),
      option('msgType', 'Message type', 'select', {
        choices: ['text', 'markdown'].map((value) => ({ value, label: value })),
      }),
      option('mentionedList', 'Mentioned user IDs', 'string-list'),
      option('mentionedMobileList', 'Mentioned mobiles', 'string-list'),
    ],
  },
  {
    type: 'weixin',
    label: 'Weixin',
    description: 'WeChat Official Account customer-service API.',
    fields: [
      secret('accessToken', 'Access token', true, true),
      option('apiBaseUrl', 'API base URL', 'url'),
      root('webhookUrl', 'Webhook URL', 'url'),
      option('kfAccount', 'Customer-service account', 'text'),
    ],
  },
  {
    type: 'qq',
    label: 'QQ / OneBot',
    description: 'OneBot v11-compatible HTTP gateway.',
    fields: [
      option('baseUrl', 'OneBot base URL', 'url', { required: true }),
      secret('accessToken', 'Access token', true),
      option('defaultMessageType', 'Default target type', 'select', {
        choices: [
          { value: 'private', label: 'Private' },
          { value: 'group', label: 'Group' },
        ],
      }),
      option('autoEscape', 'Auto-escape messages', 'boolean'),
    ],
  },
  {
    type: 'line',
    label: 'LINE',
    description: 'LINE Messaging API webhook.',
    fields: [
      secret('channelAccessToken', 'Channel access token', true, true),
      secret('channelSecret', 'Channel secret', false, true),
      option('port', 'Webhook port', 'number', { min: 1, max: 65_535 }),
    ],
  },
  {
    type: 'nostr',
    label: 'Nostr',
    description: 'Encrypted direct messages over Nostr relays.',
    fields: [
      secret('privateKey', 'Private key', true, true),
      option('relays', 'Relay URLs', 'string-list', { required: true }),
      option('maxRetries', 'Maximum retries', 'number', { min: 0, max: 100 }),
      option('reconnectDelayMs', 'Reconnect delay (ms)', 'number', { min: 0, max: 600_000 }),
      option('publishTimeoutMs', 'Publish timeout (ms)', 'number', { min: 100, max: 600_000 }),
    ],
  },
  {
    type: 'zalo',
    label: 'Zalo',
    description: 'Zalo bot or personal messaging API.',
    fields: [
      option('appId', 'Application ID', 'text', { required: true }),
      secret('secretKey', 'Secret key', true, true),
      option('mode', 'Mode', 'select', {
        required: true,
        choices: [
          { value: 'bot', label: 'Bot' },
          { value: 'personal', label: 'Personal' },
        ],
      }),
    ],
  },
  {
    type: 'mattermost',
    label: 'Mattermost',
    description: 'Mattermost REST and WebSocket bot.',
    fields: [
      option('url', 'Server URL', 'url', { required: true }),
      secret('token', 'Access token', true, true),
      option('teamId', 'Team ID', 'text'),
      option('maxRetries', 'Maximum retries', 'number', { min: 0, max: 100 }),
      option('retryDelay', 'Retry delay (ms)', 'number', { min: 0, max: 600_000 }),
    ],
  },
  {
    type: 'nextcloud-talk',
    label: 'Nextcloud Talk',
    description: 'Nextcloud Talk long-poll transport.',
    fields: [
      option('url', 'Nextcloud URL', 'url', { required: true }),
      option('username', 'Username', 'text', { required: true }),
      secret('password', 'App password', true, true),
      secret('bearer', 'Bearer token'),
      option('roomToken', 'Conversation token', 'text'),
      option('pollTimeoutSecs', 'Long-poll timeout (seconds)', 'number', { min: 1, max: 300 }),
      option('maxRetries', 'Maximum retries', 'number', { min: 0, max: 100 }),
      option('retryDelayMs', 'Retry delay (ms)', 'number', { min: 0, max: 600_000 }),
    ],
  },
  {
    type: 'twilio-voice',
    label: 'Twilio Voice',
    description: 'Outbound and webhook-driven Twilio calls.',
    fields: [
      option('accountSid', 'Account SID', 'text', { required: true }),
      secret('authToken', 'Auth token', true, true),
      option('phoneNumber', 'Twilio phone number', 'text', { required: true }),
      root('webhookUrl', 'Webhook URL', 'url'),
    ],
  },
  {
    type: 'imessage',
    label: 'iMessage / BlueBubbles',
    description: 'BlueBubbles REST server and inbound polling.',
    fields: [
      option('serverUrl', 'BlueBubbles server URL', 'url', { required: true }),
      secret('password', 'Server password', true, true),
      option('port', 'Port', 'number', { min: 1, max: 65_535 }),
      option('pollingInterval', 'Polling interval (ms)', 'number', { min: 100, max: 600_000 }),
      option('maxRetries', 'Maximum retries', 'number', { min: 0, max: 100 }),
      option('retryDelay', 'Retry delay (ms)', 'number', { min: 0, max: 600_000 }),
    ],
  },
  {
    type: 'irc',
    label: 'IRC',
    description: 'IRC or IRC-over-TLS client.',
    fields: [
      option('server', 'IRC server', 'text', { required: true }),
      option('port', 'Port', 'number', { min: 1, max: 65_535 }),
      option('nick', 'Nickname', 'text', { required: true }),
      option('username', 'Username', 'text'),
      option('realname', 'Real name', 'text'),
      secret('password', 'Server / SASL password', true),
      option('channels', 'Channels', 'string-list', { required: true, placeholder: '#codebuddy' }),
      option('useTLS', 'Use TLS', 'boolean'),
      option('sasl', 'Use SASL', 'boolean'),
      option('connectTimeoutMs', 'Connect timeout (ms)', 'number', { min: 100, max: 600_000 }),
      option('maxRetries', 'Maximum retries', 'number', { min: 0, max: 100 }),
      option('retryDelayMs', 'Retry delay (ms)', 'number', { min: 0, max: 600_000 }),
    ],
  },
  {
    type: 'feishu',
    label: 'Feishu / Lark',
    description: 'Feishu application bot and event webhook.',
    fields: [
      option('appId', 'Application ID', 'text', { required: true }),
      secret('appSecret', 'Application secret', true, true),
      secret('verificationToken', 'Verification token'),
      secret('encryptKey', 'Encrypt key'),
      option('port', 'Webhook port', 'number', { min: 1, max: 65_535 }),
    ],
  },
  {
    type: 'synology-chat',
    label: 'Synology Chat',
    description: 'Synology Chat incoming and outgoing webhooks.',
    fields: [
      secret('incomingWebhookUrl', 'Incoming webhook URL', true, true),
      secret('outgoingWebhookToken', 'Outgoing webhook token'),
      option('botName', 'Bot name', 'text'),
      option('port', 'Webhook port', 'number', { min: 1, max: 65_535 }),
    ],
  },
  {
    type: 'ntfy',
    label: 'ntfy',
    description: 'Publish notifications to an ntfy topic.',
    fields: [
      option('serverUrl', 'Server URL', 'url'),
      secret('token', 'Access token', true),
      option('topic', 'Topic', 'text', { required: true }),
      option('title', 'Notification title', 'text'),
      option('priority', 'Priority', 'text'),
      option('tags', 'Tags', 'string-list'),
    ],
  },
] as const;

const DEFINITIONS_BY_TYPE = new Map(
  CHANNEL_CONFIG_DEFINITIONS.map((definition) => [definition.type, definition]),
);

export function getChannelConfigDefinitions(): ChannelConfigDefinition[] {
  return CHANNEL_CONFIG_DEFINITIONS.map((definition) => ({
    ...definition,
    fields: definition.fields.map((field) => ({
      ...field,
      ...(field.choices ? { choices: field.choices.map((choice) => ({ ...choice })) } : {}),
    })),
  }));
}

export function getChannelConfigDefinition(type: string): ChannelConfigDefinition | undefined {
  return DEFINITIONS_BY_TYPE.get(type);
}

export function getChannelSecretFields(type: string): ChannelConfigFieldDefinition[] {
  return (DEFINITIONS_BY_TYPE.get(type)?.fields ?? []).filter((field) => field.kind === 'secret');
}

export function channelSecretStorageName(field: ChannelConfigFieldDefinition): string {
  return field.primarySecret ? 'token' : field.key;
}

function normalizeStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(0, 256);
}

function validateFieldValue(
  field: ChannelConfigFieldDefinition,
  value: unknown,
): { ok: true; value: ChannelConfigFieldValue } | { ok: false; error: string } {
  if (field.kind === 'boolean') {
    return typeof value === 'boolean'
      ? { ok: true, value }
      : { ok: false, error: `${field.label} must be a boolean` };
  }
  if (field.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, error: `${field.label} must be an integer` };
    }
    if (field.min !== undefined && value < field.min) {
      return { ok: false, error: `${field.label} must be at least ${field.min}` };
    }
    if (field.max !== undefined && value > field.max) {
      return { ok: false, error: `${field.label} must be at most ${field.max}` };
    }
    return { ok: true, value };
  }
  if (field.kind === 'string-list') {
    const normalized = normalizeStringList(value);
    return normalized
      ? { ok: true, value: normalized }
      : { ok: false, error: `${field.label} must be a list of strings` };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: `${field.label} must be a string` };
  }
  const normalized = value.trim();
  if (normalized.length > 4_096) {
    return { ok: false, error: `${field.label} is too long` };
  }
  if (field.kind === 'url' && normalized) {
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
    } catch {
      return { ok: false, error: `${field.label} must be an http(s) URL` };
    }
  }
  if (field.kind === 'select' && normalized && !field.choices?.some((choice) => choice.value === normalized)) {
    return { ok: false, error: `${field.label} has an unsupported value` };
  }
  return { ok: true, value: normalized };
}

/**
 * Validate and whitelist a renderer-supplied patch. Secret-looking or unknown
 * keys are dropped, so they cannot be smuggled into plaintext `channels.json`.
 */
export function validateChannelConfigPatch(
  type: string,
  input: unknown,
): { ok: true; patch: ChannelConfigPatch } | { ok: false; error: string } {
  const definition = DEFINITIONS_BY_TYPE.get(type);
  if (!definition) return { ok: false, error: `unsupported channel type: ${type}` };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'invalid channel config patch' };
  }

  const raw = input as Record<string, unknown>;
  const patch: ChannelConfigPatch = {};
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean' };
    patch.enabled = raw.enabled;
  }

  for (const commonKey of ['allowedUsers', 'allowedChannels'] as const) {
    if (raw[commonKey] === undefined) continue;
    const normalized = normalizeStringList(raw[commonKey]);
    if (!normalized) return { ok: false, error: `${commonKey} must be a list of strings` };
    patch[commonKey] = normalized;
  }

  const nonSecretFields = definition.fields.filter((field) => field.kind !== 'secret');
  for (const field of nonSecretFields.filter((candidate) => candidate.location === 'root')) {
    if (raw[field.key] === undefined) continue;
    const checked = validateFieldValue(field, raw[field.key]);
    if (!checked.ok) return checked;
    if (field.key === 'webhookUrl' && typeof checked.value === 'string') {
      patch.webhookUrl = checked.value;
    }
  }

  if (raw.options !== undefined) {
    if (!raw.options || typeof raw.options !== 'object' || Array.isArray(raw.options)) {
      return { ok: false, error: 'options must be an object' };
    }
    const rawOptions = raw.options as Record<string, unknown>;
    const options: Record<string, ChannelConfigFieldValue> = {};
    const unsetOptions: string[] = [];
    for (const field of nonSecretFields.filter((candidate) => candidate.location === 'options')) {
      if (rawOptions[field.key] === undefined) continue;
      if (rawOptions[field.key] === null) {
        unsetOptions.push(field.key);
        continue;
      }
      const checked = validateFieldValue(field, rawOptions[field.key]);
      if (!checked.ok) return checked;
      options[field.key] = checked.value;
    }
    if (Object.keys(options).length > 0) patch.options = options;
    if (unsetOptions.length > 0) patch.unsetOptions = unsetOptions;
  }

  return { ok: true, patch };
}

function hasRequiredValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

/** Validate the complete merged entry immediately before enabling it. */
export function validateChannelForEnable(
  type: string,
  entry: ChannelConfigLike,
  secretPresence: Record<string, boolean>,
): { ok: true } | { ok: false; error: string } {
  const definition = DEFINITIONS_BY_TYPE.get(type);
  if (!definition) return { ok: false, error: `unsupported channel type: ${type}` };
  for (const field of definition.fields) {
    if (!field.required) continue;
    if (field.kind === 'secret') {
      const legacyValue = field.primarySecret
        ? entry.token ?? entry.options?.[field.key]
        : entry.options?.[field.key];
      if (!secretPresence[field.key] && !hasRequiredValue(legacyValue)) {
        return { ok: false, error: `${field.label} is required before enabling ${definition.label}` };
      }
      continue;
    }
    const value = field.location === 'root'
      ? field.key === 'webhookUrl' ? entry.webhookUrl : undefined
      : entry.options?.[field.key];
    if (!hasRequiredValue(value)) {
      return { ok: false, error: `${field.label} is required before enabling ${definition.label}` };
    }
  }
  return { ok: true };
}
