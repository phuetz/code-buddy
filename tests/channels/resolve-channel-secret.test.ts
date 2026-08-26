/**
 * Channel secret resolution (Phase 5b).
 *
 * The Cowork GUI stores a channel's token ENCRYPTED in the CredentialManager
 * under `channel:<type>:token`, leaving `channels.json` without a plaintext
 * token. The core channel loader must resolve that encrypted secret, otherwise
 * a GUI-configured channel starts unauthenticated.
 *
 * These tests exercise the REAL CredentialManager (real AES-256-GCM crypto,
 * real disk in a throwaway temp dir) — no mocks — per the repo's no-mocks rule.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveChannelSecret,
  channelSecretKey,
} from '../../src/channels/resolve-channel-secret.js';
import { CredentialManager } from '../../src/security/credential-manager.js';
import { instantiateChannel } from '../../src/commands/handlers/channel-handlers.js';
import { logger } from '../../src/utils/logger.js';

// A realistic Telegram token shape: "<botId>:<secret>". TelegramChannel.botId
// is the part before the colon, so we can prove the resolved token reached the
// constructed channel WITHOUT ever asserting on the secret half.
const BOT_ID = '123456789';
const STORED_TOKEN = `${BOT_ID}:STORED-secret-abcXYZ`;
const LITERAL_TOKEN = '987654321:LITERAL-secret-defGHI';

describe('resolveChannelSecret / channel token from the encrypted store', () => {
  let tmpDir: string;
  let credsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-channel-secret-'));
    credsPath = path.join(tmpDir, 'credentials.enc');
    // Point the singleton the loader will use at our throwaway encrypted store.
    CredentialManager.resetInstance();
    CredentialManager.getInstance({ credentialsPath: credsPath });
  });

  afterEach(() => {
    CredentialManager.resetInstance();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      /* best-effort temp cleanup */
    }
    vi.restoreAllMocks();
  });

  it('exposes the exact key the Cowork GUI writes', () => {
    // Must stay in lockstep with cowork/src/main/ipc/channels-ipc.ts.
    expect(channelSecretKey('telegram')).toBe('channel:telegram:token');
    expect(channelSecretKey('discord')).toBe('channel:discord:token');
  });

  it('resolves the encrypted token when the config has no literal token', () => {
    const creds = CredentialManager.getInstance();
    creds.setCredential(channelSecretKey('telegram'), STORED_TOKEN);

    const resolved = resolveChannelSecret('telegram', {});
    expect(resolved).toBe(STORED_TOKEN);
  });

  it('prefers a literal token and never reads the store (backwards compat)', () => {
    const creds = CredentialManager.getInstance();
    // A DIFFERENT token sits in the store; the literal must win regardless.
    creds.setCredential(channelSecretKey('telegram'), STORED_TOKEN);
    const hasSpy = vi.spyOn(creds, 'hasCredential');
    const getSpy = vi.spyOn(creds, 'getCredential');

    const resolved = resolveChannelSecret('telegram', { token: LITERAL_TOKEN });

    expect(resolved).toBe(LITERAL_TOKEN);
    // The encrypted store is never even consulted when a literal is present.
    expect(hasSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('returns undefined when neither a literal nor a stored secret exists', () => {
    expect(resolveChannelSecret('telegram', {})).toBeUndefined();
  });

  it('never throws when the CredentialManager blows up (falls back to no token)', () => {
    const creds = CredentialManager.getInstance();
    vi.spyOn(creds, 'hasCredential').mockImplementation(() => {
      throw new Error('credential store unavailable');
    });

    expect(() => resolveChannelSecret('telegram', {})).not.toThrow();
    expect(resolveChannelSecret('telegram', {})).toBeUndefined();
  });

  it('never logs the resolved secret value', () => {
    const creds = CredentialManager.getInstance();
    creds.setCredential(channelSecretKey('telegram'), STORED_TOKEN);

    // Spy AFTER setCredential so we only capture the resolution path.
    const debug = vi.spyOn(logger, 'debug');
    const info = vi.spyOn(logger, 'info');
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');

    const resolved = resolveChannelSecret('telegram', {});
    expect(resolved).toBe(STORED_TOKEN);

    for (const spy of [debug, info, warn, error]) {
      for (const call of spy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(STORED_TOKEN);
        // Not even the secret half of the token may leak.
        expect(serialized).not.toContain('STORED-secret-abcXYZ');
      }
    }
  });
});

describe('instantiateChannel wires the resolved token into the channel', () => {
  let tmpDir: string;
  let credsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-channel-inst-'));
    credsPath = path.join(tmpDir, 'credentials.enc');
    CredentialManager.resetInstance();
    CredentialManager.getInstance({ credentialsPath: credsPath });
  });

  afterEach(() => {
    CredentialManager.resetInstance();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      /* best-effort temp cleanup */
    }
    vi.restoreAllMocks();
  });

  it('gives a GUI-configured Telegram channel its encrypted token (no plaintext in channels.json)', async () => {
    const creds = CredentialManager.getInstance();
    creds.setCredential(channelSecretKey('telegram'), STORED_TOKEN);

    // channels.json entry carries NO token — only enabled/type, exactly like a
    // channel configured purely through the Cowork GUI.
    const channel = await instantiateChannel({ type: 'telegram', enabled: true });
    expect(channel).not.toBeNull();
    // botId is derived from the token; matching it proves the resolved token
    // reached the constructed channel — without exposing the secret half.
    expect((channel as unknown as { botId: string }).botId).toBe(BOT_ID);
    await channel?.disconnect();
  });

  it('lets a literal token in channels.json win over the store', async () => {
    const creds = CredentialManager.getInstance();
    creds.setCredential(channelSecretKey('telegram'), STORED_TOKEN);

    const channel = await instantiateChannel({
      type: 'telegram',
      enabled: true,
      token: LITERAL_TOKEN,
    });
    expect(channel).not.toBeNull();
    expect((channel as unknown as { botId: string }).botId).toBe('987654321');
    await channel?.disconnect();
  });
});
