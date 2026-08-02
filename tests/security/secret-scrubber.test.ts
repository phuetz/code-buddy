/**
 * Tests for src/security/secret-scrubber.ts + its wiring into the logger and
 * the telemetry export boundaries (Sentry, OTEL).
 *
 * The scrubber is a hygiene/security control: a token that leaks into a log
 * line or a Sentry/OTEL export is a reputation risk for a published, fleet-wide
 * tool. These tests pin three properties that matter most:
 *   1. Every known secret shape is redacted.
 *   2. Ordinary prose is returned UNCHANGED (no false positives — this also
 *      exercises the fast-path sentinel and the `sk-` word-boundary guard).
 *   3. The redaction actually happens at the egress points (log output +
 *      telemetry export bodies), not just in the pure function.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { scrubSecrets, scrubValue } from '../../src/security/secret-scrubber.js';
import { createLogger } from '../../src/utils/logger.js';
import { SentryIntegration } from '../../src/integrations/sentry-integration.js';
import { OtelTracer } from '../../src/telemetry/otel-tracer.js';

// ---------------------------------------------------------------------------
// Sample secrets — realistic shapes, not real credentials.
// ---------------------------------------------------------------------------
const SECRETS: Record<string, string> = {
  openai: 'sk-' + 'a'.repeat(48),
  openrouter: 'sk-or-v1-' + 'o'.repeat(64),
  xai: 'xai-' + 'x'.repeat(48),
  groq: 'gsk_' + 'q'.repeat(48),
  npm: 'npm_' + 'n'.repeat(36),
  anthropic: 'sk-ant-api03-' + 'b'.repeat(90),
  github_pat: 'ghp_' + 'c'.repeat(36),
  github_fine: 'github_pat_' + 'd'.repeat(82),
  aws: 'AKIA' + 'E'.repeat(16),
  slack: 'xoxb-' + '1234567890-ABCDEFGHIJ',
  slack_app: 'xoxa-' + '1234567890-ABCDEFGHIJ',
  stripe: 'sk_live_' + 'f'.repeat(24),
  gitlab: 'glpat-' + 'g'.repeat(20),
  google: 'AIza' + 'h'.repeat(35),
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz',
  pem:
    '-----BEGIN RSA PRIVATE KEY-----\n' +
    'MIIBigKCAQEA' + 'k'.repeat(40) + '\n' +
    '-----END RSA PRIVATE KEY-----',
  bearer: 'Bearer ' + 'z'.repeat(40),
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ===========================================================================
// scrubSecrets — core function
// ===========================================================================
describe('scrubSecrets', () => {
  for (const [name, secret] of Object.entries(SECRETS)) {
    it(`redacts a ${name} secret embedded in a string`, () => {
      const input = `before ${secret} after`;
      const out = scrubSecrets(input);
      expect(out).not.toContain(secret);
      expect(out).toContain('[REDACTED:');
      // Surrounding prose is preserved.
      expect(out.startsWith('before ')).toBe(true);
      expect(out.endsWith(' after')).toBe(true);
    });
  }

  it('keeps the "Bearer " scheme but drops the credential', () => {
    const out = scrubSecrets(SECRETS.bearer!);
    expect(out).toBe('Bearer [REDACTED:bearer_token]');
  });

  it('redacts the ENTIRE PEM block, not just the header line', () => {
    const out = scrubSecrets(SECRETS.pem!);
    expect(out).toBe('[REDACTED:private_key]');
    expect(out).not.toContain('MIIBigKCAQEA');
  });

  it('labels OpenAI vs Anthropic keys distinctly', () => {
    expect(scrubSecrets(SECRETS.openai!)).toBe('[REDACTED:openai_key]');
    expect(scrubSecrets(SECRETS.anthropic!)).toBe('[REDACTED:anthropic_key]');
  });

  it('leaves a normal string with NO secret byte-for-byte identical (no false positive)', () => {
    // Deliberately packed with sentinel look-alikes that must NOT trip:
    //  - "task-", "risk-", "disk-", "asks-" all contain the substring "sk-"
    //  - "theyJumped" contains "eyJ"
    //  - "Bearer of" has the "Bearer " prefix but no 20+ char token
    const normal =
      'The task-management-system handles risk-based-assessment for ' +
      'disk-usage-monitoring and asks-questions. theyJumped over. ' +
      'Bearer of good news. AKIAA is too short. Nothing to redact here.';
    expect(scrubSecrets(normal)).toBe(normal);
  });

  it('does not mistake ordinary npm lifecycle variables for access tokens', () => {
    expect(scrubSecrets('npm_package_dependencies_typescript'))
      .toBe('npm_package_dependencies_typescript');
    const tokenLikeVariable = `npm_${'a'.repeat(36)}_suffix`;
    expect(scrubSecrets(tokenLikeVariable)).toBe(tokenLikeVariable);
    expect(scrubSecrets(SECRETS.npm!)).toBe('[REDACTED:npm_token]');
  });

  it('returns an empty string unchanged (fast path)', () => {
    expect(scrubSecrets('')).toBe('');
  });

  it('is idempotent: scrub(scrub(x)) === scrub(x)', () => {
    for (const secret of Object.values(SECRETS)) {
      const input = `k=${secret};next=${secret}`;
      const once = scrubSecrets(input);
      const twice = scrubSecrets(once);
      expect(twice).toBe(once);
      expect(once).not.toContain(secret);
    }
  });

  it('redacts EVERY occurrence in a string (global)', () => {
    const s = SECRETS.aws!;
    const out = scrubSecrets(`${s} and again ${s}`);
    expect(out).not.toContain(s);
    expect(out.match(/\[REDACTED:aws_key\]/g)?.length).toBe(2);
  });

  it('never throws on non-string / odd input', () => {
    expect(() => scrubSecrets(undefined as unknown as string)).not.toThrow();
    expect(() => scrubSecrets(null as unknown as string)).not.toThrow();
    expect(scrubSecrets(undefined as unknown as string)).toBe(undefined);
  });
});

// ===========================================================================
// scrubValue — recursive
// ===========================================================================
describe('scrubValue', () => {
  it('scrubs strings nested inside objects and arrays', () => {
    const obj = {
      note: 'ok',
      auth: `token ${SECRETS.github_pat}`,
      nested: { deep: [SECRETS.aws, 'clean'] },
    };
    const out = scrubValue(obj) as typeof obj;
    expect(out.auth).not.toContain(SECRETS.github_pat);
    expect(out.auth).toContain('[REDACTED:github_token]');
    expect(out.nested.deep[0]).toContain('[REDACTED:aws_key]');
    expect(out.nested.deep[1]).toBe('clean');
    // Original object is NOT mutated.
    expect(obj.auth).toContain(SECRETS.github_pat);
  });

  it('returns the SAME reference when there is nothing to redact', () => {
    const obj = { a: 'hello', b: { c: 'world', d: [1, 2, 'three'] } };
    expect(scrubValue(obj)).toBe(obj);
  });

  it('passes primitives through unchanged', () => {
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(true)).toBe(true);
    expect(scrubValue(null)).toBe(null);
    expect(scrubValue(undefined)).toBe(undefined);
  });

  it('never throws on a cyclic object (depth-bounded)', () => {
    const cyclic: Record<string, unknown> = { token: SECRETS.stripe };
    cyclic.self = cyclic;
    expect(() => scrubValue(cyclic)).not.toThrow();
  });
});

// ===========================================================================
// Logger wiring
// ===========================================================================
describe('logger secret scrubbing', () => {
  it('redacts a secret in the rendered log output', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger({
      silent: false,
      level: 'debug',
      enableColors: false,
      logFile: undefined,
    });

    log.info(`connecting with key=${SECRETS.openai}`);

    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('[REDACTED:openai_key]');
    expect(printed).not.toContain(SECRETS.openai);
  });

  it('scrubs secrets held in structured context', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger({
      silent: false,
      level: 'debug',
      enableColors: false,
      logFile: undefined,
    });

    log.warn('provider auth', { apiKey: SECRETS.anthropic, safe: 'value' });

    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('[REDACTED:anthropic_key]');
    expect(printed).not.toContain(SECRETS.anthropic);
    // Non-secret context survives.
    expect(printed).toContain('value');
    // History is also scrubbed (defense in depth for exportLogsAsJSON).
    const last = log.getHistory().at(-1);
    expect(JSON.stringify(last)).not.toContain(SECRETS.anthropic);
  });

  it('leaves a normal message unchanged (no false positive / no regression)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger({
      silent: false,
      level: 'debug',
      enableColors: false,
      logFile: undefined,
    });

    const msg = 'task-runner finished the risk-assessment without errors';
    log.info(msg);

    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain(msg);
  });
});

// ===========================================================================
// Telemetry export wiring
// ===========================================================================
describe('Sentry export scrubbing', () => {
  it('redacts a secret in the message before the event is sent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const sentry = new SentryIntegration({ dsn: 'https://pub@sentry.example.com/1' });
    sentry.captureMessage(`crash while using ${SECRETS.github_pat}`, 'error', {
      extra: { header: `Authorization: ${SECRETS.bearer}` },
    });
    await sentry.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String(fetchMock.mock.calls[0]![1]!.body);
    expect(body).not.toContain(SECRETS.github_pat);
    expect(body).not.toContain('z'.repeat(40));
    expect(body).toContain('[REDACTED:github_token]');
    expect(body).toContain('[REDACTED:bearer_token]');
  });
});

describe('OTEL span export scrubbing', () => {
  it('redacts a secret in a span attribute before export', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const tracer = new OtelTracer({
      endpoint: 'http://localhost:4318/v1/traces',
      flushIntervalMs: 10_000_000,
    });
    const span = tracer.startSpan('db.query', {
      'db.statement': `SELECT token='${SECRETS.stripe}'`,
    });
    tracer.endSpan(span);
    await tracer.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String(fetchMock.mock.calls[0]![1]!.body);
    expect(body).not.toContain(SECRETS.stripe);
    expect(body).toContain('[REDACTED:stripe_key]');

    await tracer.dispose();
  });
});
