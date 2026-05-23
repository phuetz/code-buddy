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
import {
  LocalUserModel,
  getUserModel,
  resetUserModels,
  screenUserModelContent,
  UserModelPrivacyError,
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
});
