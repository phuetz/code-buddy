import { TelegramChannel } from '../../src/channels/telegram/index.js';
import type { TelegramConfig } from '../../src/channels/telegram/index.js';
import { buildChannelStatusReport } from '../../src/commands/handlers/channel-handlers.js';
import { logger } from '../../src/utils/logger.js';

const BASE_TIME = new Date('2026-09-02T13:00:00.000Z');

function telegramResponse(result: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result }),
  } as Response;
}

function methodFrom(input: string | URL | Request): string {
  return String(input).split('/').at(-1) ?? '';
}

function createChannel(pollingTimeout: number): TelegramChannel {
  const config: TelegramConfig = {
    type: 'telegram',
    enabled: true,
    token: '123456:test-token',
    pollingTimeout,
    enhancedCommands: false,
  };
  const channel = new TelegramChannel(config);
  channel.on('error', () => undefined);
  return channel;
}

describe('TelegramChannel polling resilience', () => {
  let channel: TelegramChannel | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });

  afterEach(async () => {
    await channel?.disconnect();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('times out a getUpdates request that never settles and starts another poll', async () => {
    const pollSignals: AbortSignal[] = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const method = methodFrom(input);
        if (method === 'getMe') {
          return telegramResponse({ id: 123456, is_bot: true, first_name: 'Lisa' });
        }
        if (method === 'deleteWebhook') return telegramResponse(true);
        if (method === 'getUpdates') {
          pollSignals.push(init?.signal as AbortSignal);
          return await new Promise<Response>(() => undefined);
        }
        throw new Error(`Unexpected Telegram method: ${method}`);
      },
    );
    global.fetch = fetchMock as typeof fetch;
    const warnSpy = vi.spyOn(logger, 'warn');
    channel = createChannel(10);

    await channel.connect();
    expect(pollSignals).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(pollSignals[0]?.aborted).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Telegram getUpdates failed'),
      expect.objectContaining({ retryInMs: 2_000 }),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    expect(pollSignals).toHaveLength(2);
  });

  it('warns and retries every rejection with bounded exponential backoff', async () => {
    const pollAttemptTimes: number[] = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        const method = methodFrom(input);
        if (method === 'getMe') {
          return telegramResponse({ id: 123456, is_bot: true, first_name: 'Lisa' });
        }
        if (method === 'deleteWebhook') return telegramResponse(true);
        if (method === 'getUpdates') {
          pollAttemptTimes.push(Date.now());
          throw Object.assign(new Error('socket reset'), { code: 'ECONNRESET' });
        }
        throw new Error(`Unexpected Telegram method: ${method}`);
      },
    );
    global.fetch = fetchMock as typeof fetch;
    const warnSpy = vi.spyOn(logger, 'warn');
    channel = createChannel(100);

    await channel.connect();
    await vi.advanceTimersByTimeAsync(182_000);

    expect(pollAttemptTimes.slice(0, 8).map((time) => time - BASE_TIME.getTime())).toEqual([
      0,
      2_000,
      6_000,
      14_000,
      30_000,
      62_000,
      122_000,
      182_000,
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(8);
    expect(warnSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('Telegram getUpdates failed'),
      expect.objectContaining({ error: 'socket reset', retryInMs: 60_000 }),
    );
  });

  it('logs an error and replaces a stalled poll after three long-poll delays', async () => {
    let pollCalls = 0;
    const fetchMock = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        const method = methodFrom(input);
        if (method === 'getMe') {
          return telegramResponse({ id: 123456, is_bot: true, first_name: 'Lisa' });
        }
        if (method === 'deleteWebhook') return telegramResponse(true);
        if (method === 'getUpdates') {
          pollCalls++;
          return await new Promise<Response>(() => undefined);
        }
        throw new Error(`Unexpected Telegram method: ${method}`);
      },
    );
    global.fetch = fetchMock as typeof fetch;
    const errorSpy = vi.spyOn(logger, 'error');
    channel = createChannel(1);

    await channel.connect();
    expect(pollCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Telegram polling watchdog'),
      expect.objectContaining({ staleForMs: 3_000 }),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    expect(pollCalls).toBe(2);
    expect(channel.getStatus()).toMatchObject({
      connected: false,
      error: expect.stringContaining('watchdog'),
    });
  });

  it('records the timestamp of the latest successful getUpdates request', async () => {
    let pollCalls = 0;
    const fetchMock = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        const method = methodFrom(input);
        if (method === 'getMe') {
          return telegramResponse({ id: 123456, is_bot: true, first_name: 'Lisa' });
        }
        if (method === 'deleteWebhook') return telegramResponse(true);
        if (method === 'getUpdates') {
          pollCalls++;
          return pollCalls === 1
            ? telegramResponse([])
            : await new Promise<Response>(() => undefined);
        }
        throw new Error(`Unexpected Telegram method: ${method}`);
      },
    );
    global.fetch = fetchMock as typeof fetch;
    channel = createChannel(10);

    await channel.connect();
    await vi.advanceTimersByTimeAsync(0);

    const status = channel.getStatus();
    expect(status.lastSuccessfulPoll).toEqual(BASE_TIME);
    const report = buildChannelStatusReport(
      { telegram: status },
      `${process.cwd()}/.missing-r19-channel-config.json`,
      BASE_TIME.toISOString(),
    );
    expect(report.runtime.channels[0]?.lastSuccessfulPoll).toBe(BASE_TIME.toISOString());
  });
});
