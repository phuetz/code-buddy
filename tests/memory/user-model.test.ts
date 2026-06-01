/**
 * Tests for the local user model (Hermes "deepening model of who you are").
 *
 * Two guarantees under test:
 *   1. No silent write — observing never folds into the active model; only an
 *      explicit human accept does.
 *   2. Privacy boundary — sensitive content (health/finance/relationships/
 *      credentials) is refused at observe AND at accept (edited content).
 *
 * Each test uses a unique temp workDir so the per-workDir singleton never
 * bleeds.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../../src/agent/types.js';
import type { CodeBuddyClient } from '../../src/codebuddy/client.js';
import {
  LocalUserModel,
  getUserModel,
  resetUserModels,
  screenUserModelContent,
  UserModelPrivacyError,
  runUserDialecticInference,
  runUserLocalInference,
} from '../../src/memory/user-model.js';

describe('LocalUserModel', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-model-test-'));
    resetUserModels();
  });

  afterEach(async () => {
    resetUserModels();
    await fs.remove(tmpDir);
  });

  const modelFile = () => path.join(tmpDir, '.codebuddy', 'user-model.json');

  describe('observe (no silent write)', () => {
    it('proposes a pending observation that is NOT in the active model', () => {
      const model = new LocalUserModel(tmpDir);
      const { observation, deduped } = model.observe({
        kind: 'preference',
        content: 'Prefers French for explanations.',
      });

      expect(deduped).toBe(false);
      expect(observation.status).toBe('pending');
      expect(observation.source).toBe('self_observed');
      // Not folded into the model until accepted.
      expect(model.getAccepted()).toHaveLength(0);
      expect(model.summarize()).toBeNull();
      // The side-car is persisted.
      expect(fs.existsSync(modelFile())).toBe(true);
    });

    it('de-duplicates equivalent pending observations (case-insensitive)', () => {
      const model = new LocalUserModel(tmpDir);
      const first = model.observe({ kind: 'trait', content: 'Direct communicator' });
      const second = model.observe({ kind: 'trait', content: 'direct communicator  ' });
      expect(second.deduped).toBe(true);
      expect(second.observation.id).toBe(first.observation.id);
      expect(model.list('pending')).toHaveLength(1);
    });

    it('clamps confidence to 0..1', () => {
      const model = new LocalUserModel(tmpDir);
      expect(model.observe({ kind: 'preference', content: 'a', confidence: 5 }).observation.confidence).toBe(1);
      expect(model.observe({ kind: 'preference', content: 'b', confidence: -1 }).observation.confidence).toBe(0);
    });

    it('throws on empty content and invalid kind', () => {
      const model = new LocalUserModel(tmpDir);
      expect(() => model.observe({ kind: 'preference', content: '  ' })).toThrow(/content is required/i);
      expect(() => model.observe({ kind: 'nope' as never, content: 'x' })).toThrow(/kind must be one of/i);
    });
  });

  describe('privacy boundary', () => {
    it('screenUserModelContent flags sensitive content', () => {
      expect(screenUserModelContent('prefers dark mode')).toBeNull();
      expect(screenUserModelContent('has a medical condition')).toMatch(/privacy scope/);
      expect(screenUserModelContent('salary is 100k')).toMatch(/privacy scope/);
      expect(screenUserModelContent('stores the api key in env')).toMatch(/privacy scope/);
    });

    it('refuses to observe sensitive content', () => {
      const model = new LocalUserModel(tmpDir);
      expect(() => model.observe({ kind: 'trait', content: 'is going through a divorce' })).toThrow(
        UserModelPrivacyError,
      );
      expect(model.list()).toHaveLength(0);
    });

    it('re-screens edited content at accept time', () => {
      const model = new LocalUserModel(tmpDir);
      const { observation } = model.observe({ kind: 'preference', content: 'likes concise answers' });
      expect(() =>
        model.accept(observation.id, { reviewedBy: 'r', content: 'discloses bank account details' }),
      ).toThrow(UserModelPrivacyError);
      // Still pending, not accepted.
      expect(model.get(observation.id)?.status).toBe('pending');
    });
  });

  describe('accept', () => {
    it('requires an explicit human reviewer', () => {
      const model = new LocalUserModel(tmpDir);
      const { observation } = model.observe({ kind: 'preference', content: 'x' });
      expect(() => model.accept(observation.id, { reviewedBy: '  ' })).toThrow(/human approval/i);
      expect(model.getAccepted()).toHaveLength(0);
    });

    it('folds an observation into the active model and summary', () => {
      const model = new LocalUserModel(tmpDir);
      const { observation } = model.observe({ kind: 'working-style', content: 'Runs tests before marking done.' });
      const accepted = model.accept(observation.id, { reviewedBy: 'Patrice' });

      expect(accepted.status).toBe('accepted');
      expect(accepted.reviewedBy).toBe('Patrice');
      expect(model.getAccepted()).toHaveLength(1);
      const summary = model.summarize();
      expect(summary).toContain('<user_model>');
      expect(summary).toContain('Working style');
      expect(summary).toContain('Runs tests before marking done.');
    });

    it('applies inline edits', () => {
      const model = new LocalUserModel(tmpDir);
      const { observation } = model.observe({ kind: 'preference', content: 'rough' });
      const accepted = model.accept(observation.id, {
        reviewedBy: 'r',
        content: 'Prefers TypeScript strict mode.',
        kind: 'expertise',
      });
      expect(accepted.kind).toBe('expertise');
      expect(accepted.content).toBe('Prefers TypeScript strict mode.');
    });

    it('refuses to accept a non-pending observation', () => {
      const model = new LocalUserModel(tmpDir);
      const { observation } = model.observe({ kind: 'trait', content: 'once' });
      model.accept(observation.id, { reviewedBy: 'r' });
      expect(() => model.accept(observation.id, { reviewedBy: 'r' })).toThrow(/already accepted/i);
    });
  });

  describe('discard', () => {
    it('removes an accepted observation from the active model', () => {
      const model = new LocalUserModel(tmpDir);
      const { observation } = model.observe({ kind: 'preference', content: 'temporary' });
      model.accept(observation.id, { reviewedBy: 'r' });
      expect(model.getAccepted()).toHaveLength(1);
      model.discard(observation.id, { reason: 'no longer true' });
      expect(model.getAccepted()).toHaveLength(0);
      expect(model.get(observation.id)?.status).toBe('discarded');
    });

    it('refuses to discard an already-discarded observation', () => {
      const model = new LocalUserModel(tmpDir);
      const { observation } = model.observe({ kind: 'preference', content: 'transient' });
      model.discard(observation.id, { reviewedBy: 'reviewer', reason: 'first reason' });

      expect(() =>
        model.discard(observation.id, { reviewedBy: 'reviewer', reason: 'second reason' }),
      ).toThrow(/already discarded/i);
      expect(model.get(observation.id)?.reviewNote).toBe('first reason');
    });
  });

  describe('summarize', () => {
    it('returns null when there are no accepted observations', () => {
      const model = new LocalUserModel(tmpDir);
      model.observe({ kind: 'preference', content: 'pending only' });
      expect(model.summarize()).toBeNull();
    });
  });

  describe('persistence', () => {
    it('reloads model state across instances', () => {
      const model = new LocalUserModel(tmpDir);
      const { observation } = model.observe({ kind: 'preference', content: 'persist me' });
      model.accept(observation.id, { reviewedBy: 'r' });
      model.observe({ kind: 'trait', content: 'still pending' });

      const reloaded = new LocalUserModel(tmpDir);
      const stats = reloaded.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byStatus.accepted).toBe(1);
      expect(stats.byStatus.pending).toBe(1);
      expect(reloaded.summarize()).toContain('persist me');
    });
  });

  describe('clear', () => {
    it('clears by status', () => {
      const model = new LocalUserModel(tmpDir);
      const a = model.observe({ kind: 'preference', content: 'one' }).observation;
      model.accept(a.id, { reviewedBy: 'r' });
      model.observe({ kind: 'trait', content: 'two' });
      expect(model.clear('pending')).toBe(1);
      expect(model.getStats().total).toBe(1);
    });
  });

  describe('singleton accessor', () => {
    it('returns the same instance for the same workDir', () => {
      expect(getUserModel(tmpDir)).toBe(getUserModel(tmpDir));
    });
  });

  describe('runUserDialecticInference', () => {
    it('analyzes chat history and proposes observations', async () => {
      const mockClient = {
        chat: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  { kind: 'preference', content: 'Prefers TypeScript over Javascript.', confidence: 0.9 },
                  { kind: 'working-style', content: 'Likes running tests after code changes.', confidence: 0.8 },
                  { kind: 'trait', content: 'Very descriptive commit messages.', confidence: 0.7 },
                  { kind: 'expertise', content: 'Knows Docker and Kubernetes.', confidence: 0.65 },
                  // Should be screened out by privacy screen
                  { kind: 'trait', content: 'Discloses credit card details', confidence: 0.99 }
                ])
              }
            }
          ]
        })
      } as unknown as CodeBuddyClient;

      const chatHistory: ChatEntry[] = [
        { type: 'user', content: 'I want to write a TypeScript service', timestamp: new Date() },
        { type: 'assistant', content: 'Sure, I can help you write a TypeScript service', timestamp: new Date() }
      ];

      const proposed = await runUserDialecticInference(chatHistory, tmpDir, mockClient);

      expect(proposed).toHaveLength(4);
      expect(proposed[0]!.content).toBe('Prefers TypeScript over Javascript.');
      expect(proposed[0]!.kind).toBe('preference');
      expect(proposed[0]!.status).toBe('pending');

      const model = new LocalUserModel(tmpDir);
      const pending = model.list('pending');
      expect(pending).toHaveLength(4);
      expect(pending.map(p => p.content)).not.toContain('Discloses credit card details');
    });
  });

  describe('runUserLocalInference', () => {
    it('proposes obvious working preferences without accepting them', () => {
      const chatHistory: ChatEntry[] = [
        {
          type: 'user',
          content: 'fais des tests reels, je ne veux plus de mocks',
          timestamp: new Date(),
        },
        {
          type: 'user',
          content: 'continue en mode autonome toutes les 10 minutes puis commit et push',
          timestamp: new Date(),
        },
      ];

      const proposed = runUserLocalInference(chatHistory, tmpDir, {
        provenance: { sessionId: 'local-session' },
      });

      expect(proposed.map((obs) => obs.content)).toEqual([
        'Prefers real verification paths over mocks for completion evidence.',
        'Prefers autonomous continuation with concise periodic progress when the task is clear.',
        'Wants useful verified changes committed and pushed after completion.',
        'Prefers French for collaboration updates.',
      ]);
      expect(proposed.every((obs) => obs.status === 'pending')).toBe(true);

      const model = new LocalUserModel(tmpDir);
      expect(model.getAccepted()).toHaveLength(0);
      expect(model.list('pending')).toHaveLength(4);

      const secondRun = runUserLocalInference(chatHistory, tmpDir);
      expect(secondRun).toHaveLength(0);
    });
  });
});
