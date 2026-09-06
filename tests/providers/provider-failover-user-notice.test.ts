import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { notifyProviderFallback, notifyProviderReturn } from '../../src/providers/provider-failover-notify.js';
import {
  consumeUserFacingFailoverNotice,
  peekUserFacingFailoverNotice,
  prependUserFacingFailoverNotice,
  resetUserFacingFailoverNoticeForTests,
  USER_FALLBACK_LINE,
  USER_RETURN_LINE,
} from '../../src/providers/provider-failover-user-notice.js';
import {
  resetProviderHealthStoreForTests,
  setProviderHealthPathForTests,
} from '../../src/providers/provider-health.js';
import { resetEventBus } from '../../src/events/event-bus.js';
import { buildGatewayStatus } from '../../src/server/websocket/handler.js';
import { buildMobileStatus } from '../../src/server/mobile/status.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const envKeys = ['CODEBUDDY_PROVIDER_FALLBACK'];

describe('user-facing failover notice', () => {
  let tmp: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tmp = makeTmpDir('fb-notice-');
    previousHome = process.env.HOME;
    process.env.HOME = tmp;
    setProviderHealthPathForTests(path.join(tmp, '.codebuddy', 'provider-health.json'));
    resetProviderHealthStoreForTests();
    resetEventBus();
    resetUserFacingFailoverNoticeForTests();
    for (const key of envKeys) delete process.env[key];
  });

  afterEach(() => {
    resetUserFacingFailoverNoticeForTests();
    resetProviderHealthStoreForTests();
    setProviderHealthPathForTests(undefined);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    for (const key of envKeys) delete process.env[key];
    resetEventBus();
    removeTmpDir(tmp);
  });

  it('is silent when CODEBUDDY_PROVIDER_FALLBACK is off', () => {
    delete process.env.CODEBUDDY_PROVIDER_FALLBACK;
    notifyProviderFallback({
      fromProvider: 'chatgpt',
      toProvider: 'ollama',
      toModel: 'qwen3:4b-instruct',
      kind: 'quota_exhausted',
    });
    expect(peekUserFacingFailoverNotice()).toBeNull();
    expect(consumeUserFacingFailoverNotice('telegram')).toBeNull();
    expect(prependUserFacingFailoverNotice('salut', 'telegram')).toBe('salut');
  });

  it('emits the local-brain line once per switch then once on return', () => {
    process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
    notifyProviderFallback({
      fromProvider: 'chatgpt',
      toProvider: 'ollama',
      toModel: 'qwen3:4b-instruct',
      kind: 'quota_exhausted',
    });
    expect(peekUserFacingFailoverNotice()?.text).toBe(USER_FALLBACK_LINE);
    expect(consumeUserFacingFailoverNotice('telegram')).toBe(USER_FALLBACK_LINE);
    expect(consumeUserFacingFailoverNotice('telegram')).toBeNull();
    expect(prependUserFacingFailoverNotice('salut', 'telegram')).toBe('salut');
    expect(prependUserFacingFailoverNotice('salut', 'pwa')).toBe(`${USER_FALLBACK_LINE}\nsalut`);

    notifyProviderReturn('chatgpt');
    expect(peekUserFacingFailoverNotice()?.text).toBe(USER_RETURN_LINE);
    expect(consumeUserFacingFailoverNotice('telegram')).toBe(USER_RETURN_LINE);
    expect(consumeUserFacingFailoverNotice('telegram')).toBeNull();
  });

  it('surfaces the line on PWA status and the WS status payload', async () => {
    process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
    notifyProviderFallback({
      fromProvider: 'chatgpt',
      toProvider: 'ollama',
      toModel: 'qwen3:4b-instruct',
      kind: 'quota_exhausted',
    });
    const mobile = await buildMobileStatus();
    expect(mobile.failoverNotice).toBe(USER_FALLBACK_LINE);
    expect(mobile.failoverNoticeKind).toBe('fallback');

    const ws = buildGatewayStatus({
      connection: {
        connectionId: 'ws_1',
        authenticated: true,
        scopes: ['chat'],
        streaming: false,
        lastActivity: 1_700_000_000_000,
      },
      server: { version: '1.0.0-test', protocolVersion: 2, uptimeMs: 5_000, pairingRequired: false },
      connections: { total: 1, authenticated: 1, streaming: 0 },
    });
    const payload = ws.payload as { failoverNotice?: string; failoverNoticeKind?: string };
    expect(payload.failoverNotice).toBe(USER_FALLBACK_LINE);
    expect(payload.failoverNoticeKind).toBe('fallback');
  });
});
