import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  curateCompanionSkills,
  dismissCompanionSkillCandidate,
  formatCompanionSkillCandidates,
  getCompanionSkillCandidatePath,
  promoteCompanionSkillCandidate,
  readCompanionSkillCandidates,
  reviewCompanionSkillCandidate,
} from '../src/companion/skill-curator.js';
import {
  getCompanionMissionBoardPath,
  type CompanionMission,
  type CompanionMissionBoard,
} from '../src/companion/mission-board.js';
import { readRecentCompanionPercepts, recordCompanionPercept } from '../src/companion/percepts.js';
import { readRecentCompanionSafetyEvents } from '../src/companion/safety-ledger.js';

function mission(overrides: Partial<CompanionMission> = {}): CompanionMission {
  const now = '2026-05-24T09:00:00.000Z';
  return {
    id: 'mission-companion-voice-barge-in',
    title: 'multimodal: voice barge-in',
    dimension: 'multimodal',
    status: 'done',
    priority: 'P0',
    summary: 'Buddy needs interruptible voice.',
    recommendation: 'Add barge-in semantics for voice dialogue.',
    sourceGapId: 'companion-voice-barge-in',
    sourceRadarId: 'radar-1',
    competitorRefs: ['lisa', 'uni'],
    command: 'buddy companion status',
    tags: ['voice', 'barge-in'],
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    ...overrides,
  };
}

async function writeBoard(cwd: string, missions: CompanionMission[]): Promise<void> {
  const storePath = getCompanionMissionBoardPath(cwd);
  const board: CompanionMissionBoard = {
    schemaVersion: 1,
    cwd,
    storePath,
    updatedAt: '2026-05-24T09:00:00.000Z',
    missions,
  };
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
}

describe('companion skill curator', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-skill-curator-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('curates reusable skills from completed missions and repeated percept tags', async () => {
    await writeBoard(tempDir, [
      mission(),
      mission({
        id: 'mission-open',
        sourceGapId: 'companion-open-gap',
        status: 'open',
        title: 'channels: still open',
        dimension: 'channels',
      }),
    ]);
    await recordCompanionPercept({
      modality: 'suggestion',
      source: 'companion_impulses',
      summary: 'Voice loop needs a short check-in.',
      payload: { command: 'buddy companion status' },
      tags: ['voice', 'check-in'],
    }, { cwd: tempDir, now: new Date('2026-05-24T10:00:00.000Z') });
    await recordCompanionPercept({
      modality: 'tool',
      source: 'companion_mission_runner',
      summary: 'Prepared a voice mission brief.',
      tags: ['voice', 'mission-runner'],
    }, { cwd: tempDir, now: new Date('2026-05-24T10:01:00.000Z') });

    const result = await curateCompanionSkills({
      cwd: tempDir,
      now: new Date('2026-05-24T11:00:00.000Z'),
      recordSuggestions: false,
    });

    expect(result.created).toBe(2);
    expect(result.store.storePath).toBe(getCompanionSkillCandidatePath(tempDir));
    expect(result.store.candidates.map(candidate => candidate.id)).toEqual(expect.arrayContaining([
      'skill-companion-voice-barge-in',
      'skill-pattern-voice',
    ]));
    expect(result.store.candidates.find(candidate => candidate.id === 'skill-companion-voice-barge-in')).toMatchObject({
      score: 86,
      status: 'draft',
      command: 'buddy companion status',
    });
    expect(formatCompanionSkillCandidates(result.store)).toContain('Buddy Companion Skill Curator');
  });

  it('promotes a candidate into a local skill artifact and audits it', async () => {
    await writeBoard(tempDir, [mission()]);
    await curateCompanionSkills({
      cwd: tempDir,
      now: new Date('2026-05-24T11:00:00.000Z'),
      recordSuggestions: false,
    });
    await reviewCompanionSkillCandidate('skill-companion-voice-barge-in', {
      reviewedBy: 'Patrice',
      note: 'Routine relue et limitée aux actions explicites.',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T11:30:00.000Z'),
      recordPercept: false,
    });

    const promoted = await promoteCompanionSkillCandidate('skill-companion-voice-barge-in', {
      cwd: tempDir,
      now: new Date('2026-05-24T12:00:00.000Z'),
    });

    expect(promoted.candidate.status).toBe('promoted');
    expect(promoted.artifactPath).toContain(path.join('.codebuddy', 'companion', 'skills'));

    const markdown = await readFile(promoted.artifactPath, 'utf8');
    expect(markdown).toContain('# Companion Skill: multimodal: voice barge-in');
    expect(markdown).toContain('## Safety Contract');
    expect(markdown).toContain('Reviewed by: Patrice');

    const store = await readCompanionSkillCandidates({ cwd: tempDir });
    expect(store.candidates.find(candidate => candidate.id === 'skill-companion-voice-barge-in')).toMatchObject({
      status: 'promoted',
      artifactPath: promoted.artifactPath,
    });

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir, modality: 'tool' });
    expect(percepts.some(percept => percept.source === 'companion_skill_curator')).toBe(true);

    const safety = await readRecentCompanionSafetyEvents({ cwd: tempDir, kind: 'data' });
    expect(safety.some(event => event.action === 'companion_skill_promote')).toBe(true);
  });

  it('blocks draft promotion and invalidates review when generated content changes', async () => {
    await writeBoard(tempDir, [mission()]);
    await curateCompanionSkills({ cwd: tempDir, recordSuggestions: false });
    await expect(promoteCompanionSkillCandidate('skill-companion-voice-barge-in', { cwd: tempDir }))
      .rejects.toThrow('must be reviewed before promotion');

    const reviewed = await reviewCompanionSkillCandidate('skill-companion-voice-barge-in', {
      reviewedBy: 'Patrice',
    }, { cwd: tempDir, recordPercept: false });
    expect(reviewed).toMatchObject({ status: 'reviewed', reviewedBy: 'Patrice' });

    await writeBoard(tempDir, [mission({ recommendation: 'Use a newly revised safe barge-in routine.' })]);
    const refreshed = await curateCompanionSkills({ cwd: tempDir, recordSuggestions: false });
    const changed = refreshed.store.candidates.find(
      candidate => candidate.id === 'skill-companion-voice-barge-in',
    );
    expect(changed?.status).toBe('draft');
    expect(changed?.reviewedBy).toBeUndefined();
    await expect(promoteCompanionSkillCandidate('skill-companion-voice-barge-in', { cwd: tempDir }))
      .rejects.toThrow('must be reviewed before promotion');
  });

  it('dismisses candidates so they cannot be promoted by accident', async () => {
    await writeBoard(tempDir, [mission()]);
    await curateCompanionSkills({ cwd: tempDir, recordSuggestions: false });

    const dismissed = await dismissCompanionSkillCandidate('skill-companion-voice-barge-in', {
      cwd: tempDir,
      now: new Date('2026-05-24T12:00:00.000Z'),
      recordPercept: false,
    });

    expect(dismissed.status).toBe('dismissed');
    await expect(promoteCompanionSkillCandidate('skill-companion-voice-barge-in', { cwd: tempDir }))
      .rejects
      .toThrow('Cannot promote dismissed companion skill candidate');
  });
});
