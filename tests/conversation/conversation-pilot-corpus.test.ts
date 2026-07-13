import { chmodSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  conversationPilotCorpusFingerprint,
  createBuiltinConversationPilotCorpus,
  initializeConversationPilotCorpus,
  readConversationPilotCorpus,
  validateConversationPilotCorpus,
} from '../../src/conversation/conversation-pilot-corpus.js';

describe('Lisa private pilot corpus', () => {
  it('creates a versioned annotated corpus with a content-stable fingerprint', () => {
    const first = createBuiltinConversationPilotCorpus(new Date('2026-07-13T10:00:00.000Z'));
    const second = createBuiltinConversationPilotCorpus(new Date('2026-07-14T10:00:00.000Z'));

    expect(first.privacy).toBe('local-private');
    expect(first.scenarios.length).toBeGreaterThanOrEqual(6);
    expect(first.scenarios.every((scenario) => scenario.annotation.criteria.length > 0)).toBe(true);
    expect(first.scenarios.some((scenario) => scenario.annotation.riskLevel === 'high')).toBe(true);
    expect(conversationPilotCorpusFingerprint(first)).toBe(
      conversationPilotCorpusFingerprint(second)
    );
  });

  it('writes and preserves the corpus as a private 0600 file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'lisa-pilot-corpus-'));
    const path = join(home, 'nested', 'pilot.json');
    initializeConversationPilotCorpus(path, {
      now: new Date('2026-07-13T10:00:00.000Z'),
    });

    expect(readConversationPilotCorpus(path).id).toBe('lisa-pilot-v1');
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    const original = readFileSync(path, 'utf8');
    await expect(() => initializeConversationPilotCorpus(path)).toThrow(/already exists/);
    expect(readFileSync(path, 'utf8')).toBe(original);

    if (process.platform !== 'win32') chmodSync(path, 0o644);
    initializeConversationPilotCorpus(path, { force: true });
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects malformed private scenarios without echoing their content', () => {
    const corpus = createBuiltinConversationPilotCorpus();
    const privateSentence = 'SECRET_PRIVATE_SENTENCE_42';
    corpus.scenarios[0]!.turns = [
      { role: 'user', content: privateSentence },
      { role: 'assistant', content: 'Réponse qui ne termine pas par un tour utilisateur.' },
    ];

    let message = '';
    try {
      validateConversationPilotCorpus(corpus);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('must end with a user turn');
    expect(message).not.toContain(privateSentence);
  });
});
