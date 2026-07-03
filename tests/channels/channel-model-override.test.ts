/**
 * Per-channel model override resolver + session store (Hermes parity:
 * session > route > persona > route-default > global). Pure — zero mocks.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  MODEL_NAME_PATTERN,
  resolveChannelModel,
  setSessionModelOverride,
  getSessionModelOverride,
  clearSessionModelOverride,
  __resetSessionModelOverridesForTests,
} from '../../src/channels/channel-model-override.js';

describe('resolveChannelModel', () => {
  const all = {
    sessionOverride: 'session-m',
    routeModel: 'route-m',
    personaModel: 'persona-m',
    routeDefaultModel: 'default-m',
    globalModel: 'global-m',
  };

  it('resolves the full priority chain with correct source labels', () => {
    expect(resolveChannelModel(all)).toEqual({ model: 'session-m', source: 'session' });
    expect(resolveChannelModel({ ...all, sessionOverride: undefined })).toEqual({ model: 'route-m', source: 'route' });
    expect(resolveChannelModel({ ...all, sessionOverride: undefined, routeModel: undefined })).toEqual({
      model: 'persona-m',
      source: 'persona',
    });
    expect(
      resolveChannelModel({ ...all, sessionOverride: undefined, routeModel: undefined, personaModel: undefined }),
    ).toEqual({ model: 'default-m', source: 'route-default' });
    expect(resolveChannelModel({ globalModel: 'global-m' })).toEqual({ model: 'global-m', source: 'global' });
  });

  it('treats empty/whitespace tiers as absent (fallthrough)', () => {
    expect(
      resolveChannelModel({
        sessionOverride: '   ',
        routeModel: '',
        personaModel: '\t',
        routeDefaultModel: undefined,
        globalModel: 'global-m',
      }),
    ).toEqual({ model: 'global-m', source: 'global' });
  });

  it('trims the winning value', () => {
    expect(resolveChannelModel({ sessionOverride: '  m1  ', globalModel: 'g' }).model).toBe('m1');
  });
});

describe('session model override store', () => {
  afterEach(() => __resetSessionModelOverridesForTests());

  it('round-trips per sessionKey with isolation', () => {
    setSessionModelOverride('a', 'model-a');
    setSessionModelOverride('b', 'model-b');
    expect(getSessionModelOverride('a')).toBe('model-a');
    expect(getSessionModelOverride('b')).toBe('model-b');
    expect(getSessionModelOverride('c')).toBeUndefined();
  });

  it('clear removes only the targeted key and reports existence', () => {
    setSessionModelOverride('a', 'model-a');
    expect(clearSessionModelOverride('a')).toBe(true);
    expect(clearSessionModelOverride('a')).toBe(false);
    expect(getSessionModelOverride('a')).toBeUndefined();
  });

  it('ignores empty keys/models and reset clears everything', () => {
    setSessionModelOverride('', 'x');
    setSessionModelOverride('a', '   ');
    expect(getSessionModelOverride('')).toBeUndefined();
    expect(getSessionModelOverride('a')).toBeUndefined();
    setSessionModelOverride('a', 'm');
    __resetSessionModelOverridesForTests();
    expect(getSessionModelOverride('a')).toBeUndefined();
  });
});

describe('MODEL_NAME_PATTERN', () => {
  it('accepts real model id shapes and rejects junk', () => {
    for (const ok of ['grok-3-latest', 'ollama/qwen2.5:7b-instruct', 'gpt-5.5', 'claude-fable-5', 'a@b']) {
      expect(MODEL_NAME_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ['', 'has space', 'back`tick', 'semi;colon', 'x'.repeat(101)]) {
      expect(MODEL_NAME_PATTERN.test(bad)).toBe(false);
    }
  });
});
