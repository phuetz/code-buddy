import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceQualifier } from '../../src/sensory/voice-qualification.js';
import { createResponseDecider } from '../../src/sensory/respond-decider.js';

const env = { CODEBUDDY_VOICE_JEV_MODE: 'shadow', TYPESAFE_API_KEY: 'test-only-key' };
const candidate = { transcript: 'En Python', sessionStartedAt: 1_000, remainingMs: 10_000 };
const answer = {
  answers: { relationship: { type: 'choice', choice: 'continuation', confidence: 0.8,
    probabilities: { direct_address: 0.01, continuation: 0.9, ambient: 0.01, uncertain: 0.08 } } },
};
function fixture(overrides: Parameters<typeof createVoiceQualifier>[0] = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(answer)));
  const observed = vi.fn();
  const q = createVoiceQualifier({ env, fetch, now: () => 2_000, onObservation: observed, ...overrides });
  q.noteSpoken('Quel langage souhaites-tu utiliser ?');
  return { q, fetch, observed };
}
afterEach(() => vi.useRealTimers());

describe('voice qualification shadow transport', () => {
  it.each([{}, { ...env, CODEBUDDY_VOICE_JEV_MODE: 'off' }, { CODEBUDDY_VOICE_JEV_MODE: 'shadow' }])(
    'does not call a provider without explicit mode and credentials', async config => {
      const { q, fetch } = fixture({ env: config });
      await q.observe(candidate, () => true);
      expect(fetch).not.toHaveBeenCalled();
    });
  it('sends bounded reported speech and typed criteria, emits metadata only', async () => {
    const { q, fetch, observed } = fixture();
    await q.observe(candidate, () => true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(String(init!.body));
    expect(body.state.lastAssistantReportedSpoken).toContain('Quel langage');
    expect(body.state.transcript).toBe('En Python');
    expect(body.questions.relationship.type).toBe('choice');
    expect(init!.redirect).toBe('error');
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'continuation', confidence: 0.8 }));
    expect(JSON.stringify(observed.mock.calls)).not.toContain('Python');
  });
  it('supports a local OpenJev server without forwarding the cloud key', async () => {
    const { q, fetch } = fixture({ env: { ...env, CODEBUDDY_VOICE_JEV_PROVIDER: 'openjev' } });
    await q.observe(candidate, () => true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8080/v1/systemone');
    expect(init!.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(String(init!.body)).model).toBe('openjev-latest');
  });
  it.each(['https://example.com', 'http://127.0.0.1@evil.example', 'http://localhost/path', 'http://localhost?key=x'])(
    'rejects a non-local or ambiguous local endpoint: %s', async url => {
      const { q, fetch } = fixture({ env: { ...env, CODEBUDDY_VOICE_JEV_PROVIDER: 'openjev', CODEBUDDY_VOICE_OPENJEV_URL: url } });
      await q.observe(candidate, () => true);
      expect(fetch).not.toHaveBeenCalled();
    });
  it('bounds the deadline and concurrency even if the transport ignores cancellation', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => {}));
    const { q, observed } = fixture({ fetch });
    const pending = q.observe(candidate, () => true);
    await vi.advanceTimersByTimeAsync(1001);
    await pending;
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'timeout' }));
    expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    await q.observe(candidate, () => true);
    expect(fetch).toHaveBeenCalledTimes(1);
    q.dispose();
  });
  it('never retries HTTP errors or logs their body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('private error', { status: 429 }));
    const { q, observed } = fixture({ fetch });
    await q.observe(candidate, () => true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(observed).toHaveBeenCalledWith({ outcome: 'error', durationMs: 0 });
  });
  it.each([{}, { answers: { relationship: { ...answer.answers.relationship, confidence: 8 } } },
    { answers: { relationship: { ...answer.answers.relationship, probabilities: { continuation: 1 } } } }])(
    'rejects malformed model results', async body => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
      const { q, observed } = fixture({ fetch });
      await q.observe(candidate, () => true);
      expect(observed).toHaveBeenCalledWith({ outcome: 'invalid', durationMs: 0 });
    });
  it('discards results invalidated by a newer turn', async () => {
    let current = true;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      current = false;
      return new Response(JSON.stringify(answer));
    });
    const { q, observed } = fixture({ fetch });
    await q.observe(candidate, () => current);
    expect(observed).toHaveBeenCalledWith({ outcome: 'stale', durationMs: 0 });
  });
  it('does not reuse speech from an earlier session', async () => {
    const { q, fetch } = fixture();
    await q.observe({ ...candidate, sessionStartedAt: 3_000 }, () => true);
    expect(fetch).not.toHaveBeenCalled();
    q.dispose();
    await q.observe(candidate, () => true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('response gate observation wiring', () => {
  it('observes an ambiguous addressed follow-up without changing the local decision', async () => {
    const observeAmbiguous = vi.fn();
    const gate = createResponseDecider({ robotName: 'Lisa', now: () => 1_000, observeAmbiguous });
    await gate.decide('Lisa, aide-moi');
    expect(await gate.decide('En Python')).toEqual({ respond: false, reason: 'ambient-in-window' });
    expect(observeAmbiguous).toHaveBeenCalledTimes(1);
    const [turn, current] = observeAmbiguous.mock.calls[0]!;
    expect(turn.transcript).toBe('En Python');
    expect(current()).toBe(true);
    gate.close();
    expect(current()).toBe(false);
  });
  it('does not send ambient speech or tentative arrival follow-ups to the observer', async () => {
    const observeAmbiguous = vi.fn();
    const gate = createResponseDecider({ robotName: 'Lisa', now: () => 1_000, observeAmbiguous });
    await gate.decide('La deuxième option');
    gate.markEngaged('arrival');
    await gate.decide('La deuxième option');
    expect(observeAmbiguous).not.toHaveBeenCalled();
  });
  it('keeps the local gate working if observation throws', async () => {
    const gate = createResponseDecider({ robotName: 'Lisa', now: () => 1_000,
      observeAmbiguous: () => { throw new Error('observer failure'); } });
    await gate.decide('Lisa, aide-moi');
    expect(await gate.decide('En Python')).toEqual({ respond: false, reason: 'ambient-in-window' });
  });
});


describe('active semantic rescue', () => {
  it('accepts contextual continuation and closes stale results', async () => {
    const qualify = vi.fn().mockResolvedValue({ outcome: 'continuation', confidence: 0.98,
      probabilities: { continuation: 0.99 } });
    const gate = createResponseDecider({ robotName: 'Lisa', now: () => 1000, qualifyAmbiguous: qualify });
    await gate.decide('Lisa, aide-moi');
    expect(await gate.decide('En Python')).toMatchObject({ respond: true, reason: 'jev-continuation' });
    qualify.mockImplementation(async () => { gate.close(); return { outcome: 'continuation', confidence: 1, probabilities: { continuation: 1 } }; });
    expect(await gate.decide('La deuxième option')).toMatchObject({ respond: false, reason: 'qualification-stale' });
  });
  it.each(['timeout', 'error', 'budget'])(
    'keeps local fallback on %s', async outcome => {
      const gate = createResponseDecider({ robotName: 'Lisa', now: () => 1000,
        qualifyAmbiguous: async () => ({ outcome: outcome as 'timeout', durationMs: 0 }) });
      await gate.decide('Lisa, aide-moi');
      expect(await gate.decide('En Python')).toEqual({ respond: false, reason: 'ambient-in-window' });
    });
  it('does not call the model for direct address, outside a session or for yes', async () => {
    const qualifyAmbiguous = vi.fn();
    const gate = createResponseDecider({ robotName: 'Lisa', now: () => 1000, qualifyAmbiguous });
    await gate.decide('En Python');
    await gate.decide('Lisa, aide-moi');
    await gate.decide('Oui');
    expect(qualifyAmbiguous).not.toHaveBeenCalled();
  });
  it('does not accept a low-confidence continuation', async () => {
    const gate = createResponseDecider({ robotName: 'Lisa', now: () => 1000,
      qualifyAmbiguous: async () => ({ outcome: 'continuation', durationMs: 0, confidence: 0.3,
        probabilities: { continuation: 0.9, ambient: 0.1, uncertain: 0, direct_address: 0 } }) });
    await gate.decide('Lisa, aide-moi');
    expect((await gate.decide('En Python')).respond).toBe(false);
  });
});


it('lets a confident ambient decision veto an imperative aimed at a third party', async () => {
  const gate = createResponseDecider({ robotName: 'Lisa', now: () => 1000,
    qualifyAmbiguous: async () => ({ outcome: 'ambient', durationMs: 0, confidence: 0.99,
      probabilities: { ambient: 0.99, continuation: 0.01, direct_address: 0, uncertain: 0 } }) });
  await gate.decide('Lisa, aide-moi');
  expect(await gate.decide('Paul, choisis la deuxième pour toi')).toEqual({ respond: false, reason: 'jev-ambient' });
});


it('does not allow a local imperative to override an uncertain semantic judgment', async () => {
  const gate = createResponseDecider({ robotName: 'Lisa', now: () => 1000,
    qualifyAmbiguous: async () => ({ outcome: 'continuation', durationMs: 0, confidence: 0.61,
      probabilities: { ambient: 0.24, continuation: 0.72, direct_address: 0.04, uncertain: 0 } }) });
  await gate.decide('Lisa, aide-moi');
  expect(await gate.decide('Paul, choisis la deuxième pour toi')).toEqual({ respond: false, reason: 'jev-uncertain' });
});
