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
import {
  listSkillWriteAudit,
  promoteSkillCandidate,
  SKILL_BACKGROUND_WRITE_REVIEWER,
} from '../../../src/agent/learning/skill-background-writes.js';
import { getSkillsHub, resetSkillsHub } from '../../../src/skills/hub.js';

let tempHubDir: string;
let rootDir: string;

const ENV_KEYS = [
  'CODEBUDDY_LEARNING_BACKGROUND_WRITES',
  'CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS',
] as const;
const savedEnv: Record<string, string | undefined> = {};

function runResult(overrides: Partial<ResearchScriptJobRunResult> = {}): ResearchScriptJobRunResult {
  return {
    commandPreview: 'node script.js',
    durationMs: 25,
    exitCode: 0,
    jobId: 'research-script-demo',
    outputPath: 'research-scripts/demo/output.json',
    signal: null,
    status: 'completed',
    stderrPath: 'research-scripts/demo/stderr.log',
    stdoutPath: 'research-scripts/demo/stdout.log',
    summaryPath: 'research-scripts/demo/summary.md',
    timedOut: false,
    ...overrides,
  };
}

async function buildEligibleCandidate(title: string): Promise<ResearchScriptSkillCandidate> {
  const job = buildResearchScriptJobArtifact({
    id: `research-script-${title}`,
    goal: `Find public data for ${title} with evidence.`,
    title,
    language: 'javascript',
    inputContract: { INPUT_JSON: 'Input leads.' },
    outputContract: { OUTPUT_JSON: 'Enriched leads.' },
    sandboxPolicy: { network: 'disabled' },
  });
  const candidate = buildResearchScriptSkillCandidate(job, [
    runResult({ jobId: job.id }),
    runResult({ jobId: job.id, durationMs: 40 }),
  ]);
  expect(candidate.eligible).toBe(true);
  return candidate;
}

describe('skill background writes (S1 — sentinel auto-install gated by flag)', () => {
  beforeEach(async () => {
    resetSkillsHub();
    tempHubDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-bgwrite-hub-'));
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-bgwrite-root-'));
    getSkillsHub({
      cacheDir: path.join(tempHubDir, 'cache'),
      skillsDir: path.join(tempHubDir, 'skills'),
      lockfilePath: path.join(tempHubDir, 'lock.json'),
    });
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  });

  afterEach(async () => {
    resetSkillsHub();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await fs.rm(tempHubDir, { recursive: true, force: true });
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('is a no-op when the opt-in flag is OFF', async () => {
    delete process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITES;
    delete process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS;

    const candidate = await buildEligibleCandidate('flag-off-workflow');
    await materializeResearchScriptSkillCandidate(candidate, { rootDir });

    const result = await promoteSkillCandidate(candidate, { workDir: rootDir });
    expect(result.installed).toBe(false);
    expect(result.reason).toBe('background skill writes disabled');

    const installedPath = path.join(rootDir, '.codebuddy', 'skills', candidate.skillName, 'SKILL.md');
    await expect(fs.access(installedPath)).rejects.toThrow();
    expect(listSkillWriteAudit(rootDir)).toHaveLength(0);
  });

  it('auto-installs an eligible candidate with the sentinel approver when the flag is ON', async () => {
    process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITES = 'true';
    process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS = 'true';

    const candidate = await buildEligibleCandidate('flag-on-workflow');
    await materializeResearchScriptSkillCandidate(candidate, { rootDir });

    const result = await promoteSkillCandidate(candidate, { workDir: rootDir });
    expect(result.installed).toBe(true);
    expect(result.installedPath).toBe(`.codebuddy/skills/${candidate.skillName}/SKILL.md`);

    const installedMarkdown = await fs.readFile(
      path.join(rootDir, '.codebuddy', 'skills', candidate.skillName, 'SKILL.md'),
      'utf8',
    );
    expect(installedMarkdown).toContain('## Human Approval');
    expect(installedMarkdown).toContain(`- Approved by: ${SKILL_BACKGROUND_WRITE_REVIEWER}`);

    const audit = listSkillWriteAudit(rootDir);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      reviewer: SKILL_BACKGROUND_WRITE_REVIEWER,
      skillName: candidate.skillName,
    });

    // The skill is registered and intact in the workspace hub.
    expect(getSkillsHub().info(candidate.skillName)).toMatchObject({ integrityOk: true });
  });

  it('refuses to auto-write a candidate whose content trips the secret screen', async () => {
    process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITES = 'true';
    process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS = 'true';

    const base = await buildEligibleCandidate('secret-workflow');
    const tainted: ResearchScriptSkillCandidate = {
      ...base,
      markdown: `${base.markdown.trimEnd()}\n\n## Leak\n- API_KEY=sk-abcdef0123456789abcd\n`,
    };
    await materializeResearchScriptSkillCandidate(tainted, { rootDir, overwrite: true });

    const result = await promoteSkillCandidate(tainted, { workDir: rootDir });
    expect(result.installed).toBe(false);
    expect(result.reason).toContain('secret');

    const installedPath = path.join(rootDir, '.codebuddy', 'skills', tainted.skillName, 'SKILL.md');
    await expect(fs.access(installedPath)).rejects.toThrow();
    expect(listSkillWriteAudit(rootDir)).toHaveLength(0);
  });
});
