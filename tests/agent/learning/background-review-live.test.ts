import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { executeToolHeadless } from '../../../src/cloud/headless-tool-executor.js';
import { resetMemoryManagerForTests } from '../../../src/memory/persistent-memory.js';
import {
  BACKGROUND_REVIEW_SENTINEL_ENV,
  runBackgroundReview,
  type BackgroundReviewClient,
  type ReviewChatResponse,
} from '../../../src/agent/learning/background-review-agent.js';

describe('background review live headless tool probe', () => {
  let previousCwd: string;
  let tempDir: string;
  let previousHeadless: string | undefined;
  let previousSentinel: string | undefined;

  beforeEach(async () => {
    previousCwd = process.cwd();
    previousHeadless = process.env.CODEBUDDY_HEADLESS;
    previousSentinel = process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-background-review-live-'));
    process.chdir(tempDir);
    process.env.CODEBUDDY_HEADLESS = 'true';
    delete process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    resetMemoryManagerForTests();
  });

  afterEach(async () => {
    resetMemoryManagerForTests();
    process.chdir(previousCwd);
    if (previousHeadless === undefined) delete process.env.CODEBUDDY_HEADLESS;
    else process.env.CODEBUDDY_HEADLESS = previousHeadless;
    if (previousSentinel === undefined) delete process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    else process.env[BACKGROUND_REVIEW_SENTINEL_ENV] = previousSentinel;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes project memory through the real headless registry in a virgin workspace', async () => {
    let calls = 0;
    const client: BackgroundReviewClient = {
      async chat(): Promise<ReviewChatResponse> {
        if (calls++ > 0) {
          return { choices: [{ message: { role: 'assistant', content: 'done' } }] };
        }
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'remember-project-style',
                function: {
                  name: 'remember',
                  arguments: JSON.stringify({
                    key: 'review-live-probe',
                    value: 'background review can persist project memory',
                    scope: 'project',
                  }),
                },
              }],
            },
          }],
        };
      },
      getCurrentModel: () => 'live-probe-scripted-client',
    };

    const projectMemoryPath = path.join(tempDir, '.codebuddy', 'CODEBUDDY_MEMORY.md');
    await expect(fs.access(projectMemoryPath)).rejects.toThrow();

    const result = await runBackgroundReview({
      client,
      executeTool: executeToolHeadless,
      mode: 'memory',
      tools: [{ function: { name: 'remember' } }],
      transcript: [{ role: 'user', content: 'Please remember the repo style.' }],
      workDir: tempDir,
    });

    expect(result.skipped).toBe(false);
    expect(result.toolCallsMade).toEqual([{ name: 'remember', success: true }]);
    const content = await fs.readFile(projectMemoryPath, 'utf8');
    expect(content).toContain('- **review-live-probe**: background review can persist project memory');
  });
});
