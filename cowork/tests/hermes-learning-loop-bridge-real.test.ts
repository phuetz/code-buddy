import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getHermesLearningLoopStatusForReview } from '../src/main/tools/hermes-learning-loop-bridge';

const distRoot = path.resolve(process.cwd(), '..', 'dist');
const hasBuiltLearningCore = fs.existsSync(path.join(distRoot, 'agent', 'hermes-learning-loop-status.js'));

describe.skipIf(!hasBuiltLearningCore)('Hermes learning loop bridge real core integration', () => {
  let originalEnginePath: string | undefined;

  beforeEach(() => {
    originalEnginePath = process.env.CODEBUDDY_ENGINE_PATH;
    process.env.CODEBUDDY_ENGINE_PATH = distRoot;
  });

  afterEach(() => {
    if (originalEnginePath === undefined) delete process.env.CODEBUDDY_ENGINE_PATH;
    else process.env.CODEBUDDY_ENGINE_PATH = originalEnginePath;
  });

  it('loads the real compiled Learning Agent status for Cowork without observation content', async () => {
    const status = await getHermesLearningLoopStatusForReview({
      rootDir: path.resolve(process.cwd(), '..'),
      limit: 3,
    });

    expect(status).toMatchObject({
      kind: 'hermes_learning_loop_status',
      schemaVersion: 1,
      ok: true,
    });
    expect(status?.commands.retrospective).toBe('buddy run retrospective <run-id> --force --json');
    expect(status?.commands.skillUsage).toBe('buddy skills learning-usage --json');
    if (status?.nextRetrospectiveRun) {
      expect(status.nextRetrospectiveRun.command).toBe(
        `buddy run retrospective ${status.nextRetrospectiveRun.runId} --force --json`,
      );
      expect(['completed', 'failed', 'cancelled']).toContain(status.nextRetrospectiveRun.status);
    }
    expect(status?.summary.recentRunCount).toBeGreaterThanOrEqual(0);
    expect(status?.reviewGates).toMatchObject({
      lessonWritesRequireApproval: true,
      skillCandidatesRequireReview: true,
      skillLifecycleRequiresApproval: true,
      userModelWritesRequireApproval: true,
    });
    expect(JSON.stringify(status)).not.toContain('content');
    expect(JSON.stringify(status)).not.toContain('observation');
  });
});
