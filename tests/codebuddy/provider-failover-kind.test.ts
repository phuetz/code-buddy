import { describe, expect, it } from 'vitest';
import { classifyProviderError } from '../../src/codebuddy/provider-error-classifier.js';
import {
  classifyFailoverKind,
  extractResetsInSeconds,
} from '../../src/codebuddy/provider-failover-kind.js';

function sdkError(opts: {
  status?: number;
  code?: string;
  type?: string;
  message?: string;
  resets_in_seconds?: number;
}): Error {
  const err = new Error(opts.message ?? `HTTP ${opts.status ?? ''}`) as Error & {
    status?: number;
    code?: string;
    type?: string;
    resets_in_seconds?: number;
  };
  if (opts.status !== undefined) err.status = opts.status;
  if (opts.code !== undefined) err.code = opts.code;
  if (opts.type !== undefined) err.type = opts.type;
  if (opts.resets_in_seconds !== undefined) err.resets_in_seconds = opts.resets_in_seconds;
  return err;
}

describe('classifyProviderError — ChatGPT usage_limit_reached', () => {
  it('429 + type usage_limit_reached → FATAL quota_exhausted', () => {
    const c = classifyProviderError(
      sdkError({
        status: 429,
        type: 'usage_limit_reached',
        message: 'ChatGPT Responses backend error (429): {"type":"usage_limit_reached","resets_in_seconds":68400}',
      }),
    );
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
    expect(c.reason).toBe('quota_exhausted');
  });
});

describe('classifyFailoverKind', () => {
  it('maps usage_limit_reached to quota_exhausted with resetsAt from resets_in_seconds', () => {
    const now = 1_700_000_000_000;
    const c = classifyFailoverKind(
      sdkError({
        status: 429,
        type: 'usage_limit_reached',
        message: '{"type":"usage_limit_reached","resets_in_seconds":68400}',
        resets_in_seconds: 68400,
      }),
      now,
    );
    expect(c.kind).toBe('quota_exhausted');
    expect(c.shouldFailover).toBe(true);
    expect(c.resetsAt).toBe(now + 68400 * 1000);
  });

  it('maps 503 / overloaded_error to overloaded with 60 s bench', () => {
    const now = 1_700_000_000_000;
    const c = classifyFailoverKind(sdkError({ status: 503, type: 'overloaded_error' }), now);
    expect(c.kind).toBe('overloaded');
    expect(c.shouldFailover).toBe(true);
    expect(c.resetsAt).toBe(now + 60_000);
  });

  it('maps ECONNREFUSED to unreachable with 5 min bench', () => {
    const now = 1_700_000_000_000;
    const err = new Error('connect ECONNREFUSED 127.0.0.1:11434') as Error & { code: string };
    err.code = 'ECONNREFUSED';
    const c = classifyFailoverKind(err, now);
    expect(c.kind).toBe('unreachable');
    expect(c.shouldFailover).toBe(true);
    expect(c.resetsAt).toBe(now + 5 * 60_000);
  });

  it('does not failover on 401', () => {
    const c = classifyFailoverKind(sdkError({ status: 401, message: '401 Unauthorized' }));
    expect(c.kind).toBe('auth');
    expect(c.shouldFailover).toBe(false);
  });

  it('does not failover on a 400 invalid request', () => {
    const c = classifyFailoverKind(sdkError({ status: 400, message: 'invalid request' }));
    expect(c.kind).toBe('other');
    expect(c.shouldFailover).toBe(false);
  });

  it('extracts resets_in_seconds from an embedded JSON body', () => {
    expect(extractResetsInSeconds(
      new Error('ChatGPT Responses backend error (429): {"type":"usage_limit_reached","resets_in_seconds":68400}'),
    )).toBe(68400);
  });
});
