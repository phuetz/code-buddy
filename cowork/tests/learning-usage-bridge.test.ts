import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { listLearningSkillUsageForReview } from '../src/main/tools/learning-usage-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('learning usage bridge', () => {
  it('loads Learning Agent skill outcome telemetry from the workspace root', async () => {
    const listLearningSkillUsage = vi.fn(() => [
      {
        averageDurationMs: 1250,
        deprecated: false,
        failureCount: 0,
        invocationCount: 3,
        lastDurationMs: 1000,
        lastRunId: 'run-learning-usage',
        lastUsedAt: '2026-05-30T14:00:00.000Z',
        reinforced: true,
        skillName: 'learned-search-view-file-bash',
        successCount: 3,
      },
    ]);
    mockedLoadCoreModule.mockResolvedValue({ listLearningSkillUsage });

    const rootDir = path.resolve('workspace');
    const usage = await listLearningSkillUsageForReview({
      rootDir,
      limit: 1,
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/learning-agent.js');
    expect(listLearningSkillUsage).toHaveBeenCalledWith(rootDir);
    expect(usage).toEqual([
      {
        averageDurationMs: 1250,
        deprecated: false,
        failureCount: 0,
        invocationCount: 3,
        lastDurationMs: 1000,
        lastRunId: 'run-learning-usage',
        lastUsedAt: '2026-05-30T14:00:00.000Z',
        reinforced: true,
        skillName: 'learned-search-view-file-bash',
        successCount: 3,
      },
    ]);
  });

  it('degrades to an empty list when the core Learning Agent module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(listLearningSkillUsageForReview({
      rootDir: path.resolve('workspace'),
    })).resolves.toEqual([]);
  });

  it('rejects relative workspace roots before loading the core module', async () => {
    const usage = await listLearningSkillUsageForReview({
      rootDir: 'relative-workspace',
    });

    expect(usage).toEqual([]);
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });
});
