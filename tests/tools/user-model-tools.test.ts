/**
 * Tests for the user-model tool adapters.
 *
 * Uses a unique tmpDir per test via a process.cwd() spy so the tools exercise
 * the real LocalUserModel → disk path.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import {
  UserModelObserveTool,
  UserModelRecallTool,
  createUserModelTools,
} from '../../src/tools/registry/user-model-tools.js';
import { getUserModel, resetUserModels } from '../../src/memory/user-model.js';

describe('User model tool adapters', () => {
  let tmpDir: string;
  let cwdSpy: jest.SpyInstance;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-model-tools-'));
    resetUserModels();
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    resetUserModels();
    await fs.remove(tmpDir);
  });

  describe('createUserModelTools()', () => {
    it('returns the observe and recall tools', () => {
      const names = createUserModelTools().map((t) => t.name);
      expect(names).toContain('user_model_observe');
      expect(names).toContain('user_model_recall');
    });
  });

  describe('UserModelObserveTool', () => {
    it('proposes a pending observation not yet in the model', async () => {
      const tool = new UserModelObserveTool();
      const result = await tool.execute({ kind: 'preference', content: 'Prefers concise diffs.' });

      expect(result.success).toBe(true);
      expect(result.output).toMatch(/awaiting human review/i);
      expect(getUserModel(tmpDir).getAccepted()).toHaveLength(0);
      expect(getUserModel(tmpDir).list('pending')).toHaveLength(1);
    });

    it('refuses sensitive content with a privacy error', async () => {
      const tool = new UserModelObserveTool();
      const result = await tool.execute({ kind: 'trait', content: 'has a chronic illness' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/privacy scope/i);
      expect(getUserModel(tmpDir).list()).toHaveLength(0);
    });

    it('rejects missing content and invalid kind', async () => {
      const tool = new UserModelObserveTool();
      expect((await tool.execute({ kind: 'preference' })).success).toBe(false);
      expect((await tool.execute({ kind: 'bogus', content: 'x' })).success).toBe(false);
    });
  });

  describe('UserModelRecallTool', () => {
    it('reports nothing when the model is empty', async () => {
      const result = await new UserModelRecallTool().execute({});
      expect(result.success).toBe(true);
      expect(result.output).toMatch(/no accepted observations/i);
    });

    it('returns accepted observations and filters by kind', async () => {
      const model = getUserModel(tmpDir);
      const a = model.observe({ kind: 'expertise', content: 'Strong in TypeScript.' }).observation;
      model.accept(a.id, { reviewedBy: 'r' });
      const b = model.observe({ kind: 'preference', content: 'Likes dark themes.' }).observation;
      model.accept(b.id, { reviewedBy: 'r' });

      const all = await new UserModelRecallTool().execute({});
      expect(all.output).toContain('Strong in TypeScript.');
      expect(all.output).toContain('Likes dark themes.');

      const expertiseOnly = await new UserModelRecallTool().execute({ kind: 'expertise' });
      expect(expertiseOnly.output).toContain('Strong in TypeScript.');
      expect(expertiseOnly.output).not.toContain('Likes dark themes.');
    });
  });
});
