import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildResearchScriptJobArtifact } from '../../../src/agent/research-script-job-artifact.js';
import {
  buildResearchScriptSkillCandidate,
  materializeResearchScriptSkillCandidate,
  type ResearchScriptSkillCandidate,
} from '../../../src/agent/research-script-skill-candidate.js';
import type { ResearchScriptJobRunResult } from '../../../src/agent/research-script-job-runner.js';
import type { AgentRunner, GradedTask } from '../../../src/agent/self-improvement/paired-gate.js';
import { makeSkillGate } from '../../../src/agent/learning/skill-paired-gate.js';
import { promoteSkillCandidate } from '../../../src/agent/learning/skill-background-writes.js';
import { getSkillsHub, resetSkillsHub } from '../../../src/skills/hub.js';

let tempHubDir: string;
let rootDir: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['CODEBUDDY_LEARNING_BACKGROUND_WRITES', 'CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS'] as const;

function runResult(overrides: Partial<ResearchScriptJobRunResult> = {}): ResearchScriptJobRunResult {
  return {
    commandPreview: 'node script.js',
    durationMs: 25,
    exitCode: 0,
    jobId: 'research-script-demo',
    outputPath: 'o.json',
    signal: null,
    status: 'completed',
    stderrPath: 'e.log',
    stdoutPath: 's.log',
    summaryPath: 'm.md',
    timedOut: false,
    ...overrides,
  };
}

function buildCandidate(title: string): ResearchScriptSkillCandidate {
  const job = buildResearchScriptJobArtifact({
    id: `research-script-${title}`,
    goal: `Find public data for ${title}.`,
    title,
    language: 'javascript',
    inputContract: { INPUT_JSON: 'Input.' },
    outputContract: { OUTPUT_JSON: 'Output.' },
    sandboxPolicy: { network: 'disabled' },
  });
  const candidate = buildResearchScriptSkillCandidate(job, [
    runResult({ jobId: job.id }),
    runResult({ jobId: job.id }),
  ]);
  expect(candidate.eligible).toBe(true);
  return candidate;
}

/** Runner that "solves" only when the skill markdown is injected. */
function behaviourChangingRunner(skillName: string): AgentRunner {
  return {
    async run(_prompt, lessonText) {
      const solved = lessonText != null && lessonText.includes(skillName);
      return { text: solved ? 'solved' : 'unsolved' };
    },
  };
}

/** Runner whose output never depends on the injected skill → inert. */
const inertRunner: AgentRunner = {
  async run() {
    return { text: 'unsolved' };
  },
};

function winningTasks(count: number): GradedTask[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `t${index}`,
    prompt: 'do the task',
    grade: (result) => result.text === 'solved',
  }));
}

describe('skill paired gate (S3)', () => {
  beforeEach(async () => {
    resetSkillsHub();
    tempHubDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-gate-hub-'));
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-gate-root-'));
    getSkillsHub({
      cacheDir: path.join(tempHubDir, 'cache'),
      skillsDir: path.join(tempHubDir, 'skills'),
      lockfilePath: path.join(tempHubDir, 'lock.json'),
    });
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITES = 'true';
    process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS = 'true';
  });

  afterEach(async () => {
    resetSkillsHub();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await fs.rm(tempHubDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('accepts a skill that demonstrably changes agent behaviour and installs it', async () => {
    const candidate = buildCandidate('gate-accept-workflow');
    const gate = makeSkillGate({ runner: behaviourChangingRunner(candidate.skillName), tasks: winningTasks(5) });

    expect(await gate(candidate)).toMatchObject({ decision: 'accept' });

    await materializeResearchScriptSkillCandidate(candidate, { rootDir });
    const result = await promoteSkillCandidate(candidate, { workDir: rootDir, gate });
    expect(result.installed).toBe(true);
  });

  it('rejects an inert skill and leaves it pending', async () => {
    const candidate = buildCandidate('gate-inert-workflow');
    const gate = makeSkillGate({ runner: inertRunner, tasks: winningTasks(5) });

    expect(await gate(candidate)).toMatchObject({ decision: 'reject', reason: expect.stringContaining('inert') });

    await materializeResearchScriptSkillCandidate(candidate, { rootDir });
    const result = await promoteSkillCandidate(candidate, { workDir: rootDir, gate });
    expect(result.installed).toBe(false);
    const installedPath = path.join(rootDir, '.codebuddy', 'skills', candidate.skillName, 'SKILL.md');
    await expect(fs.access(installedPath)).rejects.toThrow();
  });

  it('abstains when no gradeable tasks can be derived and falls back to the reversible nets', async () => {
    const candidate = buildCandidate('gate-abstain-workflow');
    const gate = makeSkillGate({ runner: inertRunner }); // no tasks → derive returns [] → abstain

    expect(await gate(candidate)).toMatchObject({ decision: 'abstain' });

    await materializeResearchScriptSkillCandidate(candidate, { rootDir });
    const result = await promoteSkillCandidate(candidate, { workDir: rootDir, gate });
    expect(result.installed).toBe(true); // abstain does NOT block; structural+screen+reversible nets apply
  });
});
