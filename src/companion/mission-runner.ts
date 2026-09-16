import { writeFileAtomic } from '../utils/atomic-write.js';
import * as path from 'path';
import {
  readCompanionMissionBoard,
  syncCompanionMissionBoard,
  updateCompanionMissionStatus,
  type CompanionMission,
  type CompanionMissionBoard,
  type CompanionMissionPriority,
  type CompanionMissionStatus,
} from './mission-board.js';
import { recordCompanionPercept } from './percepts.js';
import { recordCompanionSafetyEvent } from './safety-ledger.js';

export interface CompanionMissionRunnerOptions {
  cwd?: string;
  now?: Date;
  dryRun?: boolean;
}

export interface CompanionMissionRunResult {
  success: boolean;
  dryRun: boolean;
  message: string;
  mission?: CompanionMission;
  board?: CompanionMissionBoard;
  brief?: string;
  briefPath?: string;
  perceptId?: string;
  safetyEventId?: string;
  syncedBoard?: boolean;
}

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

function missionRunsDir(cwd: string): string {
  return path.join(cwd, '.codebuddy', 'companion', 'mission-runs');
}

function briefPathForMission(cwd: string, mission: CompanionMission, now: Date): string {
  const stamp = now.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  const safeId = mission.id.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 96);
  return path.join(missionRunsDir(cwd), `${safeId}-${stamp}.md`);
}

function priorityRank(priority: CompanionMissionPriority): number {
  if (priority === 'P0') return 0;
  if (priority === 'P1') return 1;
  return 2;
}

function statusRank(status: CompanionMissionStatus): number {
  if (status === 'in_progress') return 0;
  if (status === 'open') return 1;
  if (status === 'done') return 2;
  return 3;
}

function selectMission(board: CompanionMissionBoard): CompanionMission | null {
  const candidates = [...board.missions]
    .filter(mission => mission.status === 'in_progress' || mission.status === 'open')
    .sort((a, b) =>
      statusRank(a.status) - statusRank(b.status)
      || priorityRank(a.priority) - priorityRank(b.priority)
      || a.updatedAt.localeCompare(b.updatedAt)
      || a.title.localeCompare(b.title));
  return candidates[0] ?? null;
}

function implementationLane(mission: CompanionMission): string {
  const tags = new Set(mission.tags.map(tag => tag.toLowerCase()));
  const dimension = mission.dimension.toLowerCase();
  if (dimension.includes('voice') || tags.has('voice')) {
    return 'Voice loop: capture interruption state, preserve transcript ordering, and add a narrow regression around start/stop speech flow.';
  }
  if (dimension.includes('vision') || dimension.includes('sense') || tags.has('camera')) {
    return 'Senses loop: record explicit sensory events, keep local files workspace-scoped, and expose the result in CLI plus Cowork.';
  }
  if (dimension.includes('safety') || tags.has('safety')) {
    return 'Safety loop: make every sensitive capability auditable, append-only, and visible before expanding autonomy.';
  }
  if (dimension.includes('ui') || tags.has('ui')) {
    return 'Cowork loop: add compact controls and status cards without blocking the CLI path.';
  }
  if (dimension.includes('memory') || tags.has('memory')) {
    return 'Memory loop: persist only useful project-scoped state, keep reviewable artifacts, and avoid silent personal profiling.';
  }
  if (dimension.includes('channel') || tags.has('channels')) {
    return 'Channel loop: define a small gateway contract first, then connect one transport with explicit safety boundaries.';
  }
  if (dimension.includes('remote') || tags.has('remote')) {
    return 'Runtime loop: start with provider-neutral contracts and dry-run diagnostics before any live backend call.';
  }
  return 'Companion loop: add the smallest verified capability that closes the mission, then feed the result back into percepts and missions.';
}

function buildBrief(mission: CompanionMission, cwd: string, now: Date): string {
  const refs = mission.competitorRefs.length > 0 ? mission.competitorRefs.join(', ') : 'internal companion radar';
  const command = mission.command || 'No seed command provided by radar.';
  const tags = mission.tags.length > 0 ? mission.tags.join(', ') : 'none';
  return [
    `# Companion Mission Run: ${mission.title}`,
    '',
    `Generated: ${now.toISOString()}`,
    `Workspace: ${cwd}`,
    `Mission: ${mission.id}`,
    `Priority: ${mission.priority}`,
    `Status: ${mission.status}`,
    `Dimension: ${mission.dimension}`,
    `Source gap: ${mission.sourceGapId}`,
    `Inspired by: ${refs}`,
    `Tags: ${tags}`,
    '',
    '## Objective',
    mission.summary,
    '',
    '## Recommendation',
    mission.recommendation,
    '',
    '## Suggested Implementation Lane',
    implementationLane(mission),
    '',
    '## Seed Command',
    '```bash',
    command,
    '```',
    '',
    '## Safety Notes',
    '- Keep camera, microphone, screen, tool, and mission actions explicit and ledgered.',
    '- Keep writes workspace-scoped unless the user explicitly authorizes a broader target.',
    '- Do not persist personal or biometric data outside existing companion stores without a visible review path.',
    '- Favor dry-run diagnostics before live remote, payment, or external-account actions.',
    '',
    '## Verification Checklist',
    '- Add or update focused unit tests for the new behavior.',
    '- Run root typecheck for core changes.',
    '- Run Cowork typecheck when renderer or IPC surfaces change.',
    '- Run targeted Vitest specs before marking the mission done.',
    '- Update docs or command help if a user-facing command changes.',
    '',
    '## Done Signal',
    `Run \`buddy companion missions done ${mission.id}\` once the implementation and verification are complete.`,
    '',
  ].join('\n');
}

async function ensureBoard(options: CompanionMissionRunnerOptions): Promise<{ board: CompanionMissionBoard; synced: boolean }> {
  const board = await readCompanionMissionBoard(options);
  if (board.missions.length > 0 || options.dryRun) {
    return { board, synced: false };
  }

  const synced = await syncCompanionMissionBoard({
    cwd: board.cwd,
    now: options.now,
    recordSuggestions: true,
  });
  return { board: synced.board, synced: true };
}

export async function runNextCompanionMission(
  options: CompanionMissionRunnerOptions = {},
): Promise<CompanionMissionRunResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const { board, synced } = await ensureBoard({ ...options, cwd, now });
  const selected = selectMission(board);
  if (!selected) {
    return {
      success: false,
      dryRun: Boolean(options.dryRun),
      message: board.missions.length === 0
        ? 'No companion missions yet. Run `buddy companion missions sync` first.'
        : 'No open or in-progress companion missions remain.',
      board,
      syncedBoard: synced,
    };
  }

  const activeMission = options.dryRun || selected.status === 'in_progress'
    ? selected
    : await updateCompanionMissionStatus(selected.id, 'in_progress', { cwd, now, recordPercept: true });
  const brief = buildBrief(activeMission, cwd, now);
  const targetPath = briefPathForMission(cwd, activeMission, now);

  if (options.dryRun) {
    return {
      success: true,
      dryRun: true,
      message: `Next companion mission would run: ${activeMission.id}`,
      mission: activeMission,
      board,
      brief,
      briefPath: targetPath,
      syncedBoard: synced,
    };
  }

  await writeFileAtomic(targetPath, brief, { mode: 0o600 });

  let perceptId: string | undefined;
  let safetyEventId: string | undefined;
  try {
    const percept = await recordCompanionPercept({
      modality: 'tool',
      source: 'companion_mission_runner',
      summary: `Prepared executable brief for companion mission ${activeMission.id}.`,
      confidence: 1,
      payload: {
        missionId: activeMission.id,
        priority: activeMission.priority,
        briefPath: targetPath,
        syncedBoard: synced,
      },
      tags: ['mission-runner', 'self-improvement', activeMission.priority.toLowerCase()],
    }, { cwd });
    perceptId = percept.id;
  } catch {
    // The mission brief is the source of truth if percept logging is temporarily unavailable.
  }

  try {
    const event = await recordCompanionSafetyEvent({
      kind: 'mission',
      risk: 'low',
      action: 'companion_mission_runner',
      reason: `Prepared a workspace-local execution brief for ${activeMission.id}.`,
      status: 'completed',
      source: 'companion_mission_runner',
      artifactPath: targetPath,
      missionId: activeMission.id,
      payload: {
        priority: activeMission.priority,
        status: activeMission.status,
        syncedBoard: synced,
      },
      tags: ['mission-runner', 'self-improvement', activeMission.priority.toLowerCase()],
    }, { cwd, now });
    safetyEventId = event.id;
  } catch {
    // Do not fail a successfully written mission brief if the audit append fails.
  }

  return {
    success: true,
    dryRun: false,
    message: `Prepared companion mission ${activeMission.id}.`,
    mission: activeMission,
    board,
    brief,
    briefPath: targetPath,
    perceptId,
    safetyEventId,
    syncedBoard: synced,
  };
}

export function formatCompanionMissionRun(result: CompanionMissionRunResult): string {
  if (!result.success) {
    return result.message;
  }

  const lines = [
    result.dryRun ? 'Next Companion Mission (dry run)' : 'Companion Mission Prepared',
    '='.repeat(50),
    result.message,
  ];
  if (result.mission) {
    lines.push(
      '',
      `[${result.mission.priority}] ${result.mission.id}`,
      `  ${result.mission.title}`,
      `  ${result.mission.recommendation}`,
    );
  }
  if (result.syncedBoard) {
    lines.push('', 'Mission board was synced before selecting the mission.');
  }
  if (result.briefPath) {
    lines.push('', `Brief: ${result.briefPath}`);
  }
  if (result.perceptId) {
    lines.push(`Percept: ${result.perceptId}`);
  }
  if (result.safetyEventId) {
    lines.push(`Safety event: ${result.safetyEventId}`);
  }
  if (result.dryRun && result.brief) {
    lines.push('', result.brief);
  }

  return lines.join('\n');
}
