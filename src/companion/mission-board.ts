import { mkdir } from 'fs/promises';
import * as path from 'path';
import { readJsonAtomic, writeJsonAtomic } from '../utils/atomic-write.js';
import {
  buildCompanionCompetitiveRadar,
  type CompanionCompetitiveGap,
  type CompanionRadarDimension,
} from './competitive-radar.js';
import { recordCompanionPercept } from './percepts.js';
import { recordCompanionSafetyEvent } from './safety-ledger.js';

export type CompanionMissionStatus = 'open' | 'in_progress' | 'done' | 'dismissed';
export type CompanionMissionPriority = 'P0' | 'P1' | 'P2';

export interface CompanionMission {
  id: string;
  title: string;
  dimension: CompanionRadarDimension;
  status: CompanionMissionStatus;
  priority: CompanionMissionPriority;
  summary: string;
  recommendation: string;
  sourceGapId: string;
  sourceRadarId?: string;
  competitorRefs: string[];
  command?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CompanionMissionBoard {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  missions: CompanionMission[];
}

export interface CompanionMissionBoardOptions {
  cwd?: string;
  now?: Date;
  storePath?: string;
}

export interface CompanionMissionBoardSyncOptions extends CompanionMissionBoardOptions {
  recordSuggestions?: boolean;
}

export interface CompanionMissionBoardSyncResult {
  board: CompanionMissionBoard;
  radarId: string;
  created: number;
  updated: number;
  unchanged: number;
}

export interface CompanionMissionListOptions extends CompanionMissionBoardOptions {
  status?: CompanionMissionStatus;
}

export interface CompanionMissionStatusUpdateOptions extends CompanionMissionBoardOptions {
  recordPercept?: boolean;
}

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

export function getCompanionMissionBoardPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'missions.json');
}

function resolveStorePath(options: CompanionMissionBoardOptions = {}): string {
  const cwd = resolveCwd(options.cwd);
  return path.resolve(cwd, options.storePath || getCompanionMissionBoardPath(cwd));
}

function emptyBoard(options: CompanionMissionBoardOptions = {}): CompanionMissionBoard {
  const cwd = resolveCwd(options.cwd);
  return {
    schemaVersion: 1,
    cwd,
    storePath: resolveStorePath(options),
    updatedAt: (options.now || new Date()).toISOString(),
    missions: [],
  };
}

function isMissionStatus(value: unknown): value is CompanionMissionStatus {
  return value === 'open' || value === 'in_progress' || value === 'done' || value === 'dismissed';
}

function parseMission(value: unknown): CompanionMission | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CompanionMission>;
  if (
    typeof raw.id !== 'string'
    || typeof raw.title !== 'string'
    || typeof raw.dimension !== 'string'
    || !isMissionStatus(raw.status)
    || typeof raw.summary !== 'string'
    || typeof raw.recommendation !== 'string'
    || typeof raw.sourceGapId !== 'string'
  ) {
    return null;
  }

  return {
    id: raw.id,
    title: raw.title,
    dimension: raw.dimension as CompanionRadarDimension,
    status: raw.status,
    priority: raw.priority === 'P0' || raw.priority === 'P1' || raw.priority === 'P2'
      ? raw.priority
      : 'P2',
    summary: raw.summary,
    recommendation: raw.recommendation,
    sourceGapId: raw.sourceGapId,
    sourceRadarId: raw.sourceRadarId,
    competitorRefs: Array.isArray(raw.competitorRefs)
      ? raw.competitorRefs.filter((ref): ref is string => typeof ref === 'string')
      : [],
    command: raw.command,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    completedAt: raw.completedAt,
  };
}

async function writeMissionBoard(board: CompanionMissionBoard): Promise<void> {
  await writeJsonAtomic(board.storePath, board, { mode: 0o600 });
}

function missionId(gap: CompanionCompetitiveGap): string {
  return `mission-${gap.id}`;
}

function titleFromGap(gap: CompanionCompetitiveGap): string {
  const compact = gap.summary.replace(/^Buddy\s+/i, '').replace(/\.$/, '');
  return `${gap.dimension}: ${compact}`.slice(0, 96);
}

function priorityForGap(gap: CompanionCompetitiveGap, index: number): CompanionMissionPriority {
  if (gap.id === 'companion-brain-login' || index < 3) return 'P0';
  if (index < 6) return 'P1';
  return 'P2';
}

function missionFromGap(
  gap: CompanionCompetitiveGap,
  index: number,
  radarId: string,
  now: string,
  existing?: CompanionMission,
): CompanionMission {
  return {
    id: existing?.id || missionId(gap),
    title: titleFromGap(gap),
    dimension: gap.dimension,
    status: existing?.status || 'open',
    priority: priorityForGap(gap, index),
    summary: gap.summary,
    recommendation: gap.recommendation,
    sourceGapId: gap.id,
    sourceRadarId: radarId,
    competitorRefs: gap.competitorRefs,
    command: gap.command,
    tags: [...new Set(['companion', 'self-improvement', ...gap.tags])],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    completedAt: existing?.completedAt,
  };
}

function missionChanged(a: CompanionMission, b: CompanionMission): boolean {
  return JSON.stringify({
    title: a.title,
    dimension: a.dimension,
    priority: a.priority,
    summary: a.summary,
    recommendation: a.recommendation,
    sourceRadarId: a.sourceRadarId,
    competitorRefs: a.competitorRefs,
    command: a.command,
    tags: a.tags,
  }) !== JSON.stringify({
    title: b.title,
    dimension: b.dimension,
    priority: b.priority,
    summary: b.summary,
    recommendation: b.recommendation,
    sourceRadarId: b.sourceRadarId,
    competitorRefs: b.competitorRefs,
    command: b.command,
    tags: b.tags,
  });
}

function sortMissions(missions: CompanionMission[]): CompanionMission[] {
  const priorityRank: Record<CompanionMissionPriority, number> = { P0: 0, P1: 1, P2: 2 };
  const statusRank: Record<CompanionMissionStatus, number> = {
    in_progress: 0,
    open: 1,
    done: 2,
    dismissed: 3,
  };
  return [...missions].sort((a, b) =>
    statusRank[a.status] - statusRank[b.status]
    || priorityRank[a.priority] - priorityRank[b.priority]
    || a.title.localeCompare(b.title));
}

export async function readCompanionMissionBoard(
  options: CompanionMissionBoardOptions = {},
): Promise<CompanionMissionBoard> {
  const fallback = emptyBoard(options);
  const parsed = await readJsonAtomic<Partial<CompanionMissionBoard> | null>(fallback.storePath, null, {
    mode: 0o600,
    isValid: (value): value is Partial<CompanionMissionBoard> => Boolean(
      value && typeof value === 'object' && !Array.isArray(value),
    ),
  });
  if (!parsed) return fallback;
  try {
    const missions = Array.isArray(parsed.missions)
      ? parsed.missions.map(parseMission).filter((mission): mission is CompanionMission => Boolean(mission))
      : [];
    return {
      schemaVersion: 1,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : fallback.cwd,
      storePath: fallback.storePath,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : fallback.updatedAt,
      missions: sortMissions(missions),
    };
  } catch {
    return fallback;
  }
}

export async function syncCompanionMissionBoard(
  options: CompanionMissionBoardSyncOptions = {},
): Promise<CompanionMissionBoardSyncResult> {
  const now = options.now || new Date();
  const nowIso = now.toISOString();
  const existingBoard = await readCompanionMissionBoard(options);
  const radar = await buildCompanionCompetitiveRadar({
    cwd: existingBoard.cwd,
    now,
    recordSuggestions: false,
  });
  const existingByGap = new Map(existingBoard.missions.map(mission => [mission.sourceGapId, mission]));
  const generatedGapIds = new Set<string>();
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  const generated = radar.gaps
    .filter(gap => gap.severity === 'gap')
    .map((gap, index) => {
      generatedGapIds.add(gap.id);
      const existing = existingByGap.get(gap.id);
      const mission = missionFromGap(gap, index, radar.id, nowIso, existing);
      if (!existing) {
        created += 1;
      } else if (missionChanged(mission, existing)) {
        updated += 1;
      } else {
        unchanged += 1;
      }
      return mission;
    });

  const retained = existingBoard.missions.filter(mission => !generatedGapIds.has(mission.sourceGapId));
  const board: CompanionMissionBoard = {
    schemaVersion: 1,
    cwd: existingBoard.cwd,
    storePath: existingBoard.storePath,
    updatedAt: nowIso,
    missions: sortMissions([...generated, ...retained]),
  };

  await writeMissionBoard(board);

  if (options.recordSuggestions !== false) {
    await recordCompanionPercept({
      modality: 'suggestion',
      source: 'companion_mission_board',
      summary: `Companion mission board synced: ${created} created, ${updated} updated, ${unchanged} unchanged.`,
      confidence: 0.9,
      payload: {
        radarId: radar.id,
        missionCount: board.missions.length,
        created,
        updated,
        unchanged,
        storePath: board.storePath,
      },
      tags: ['mission-board', 'self-improvement', 'workflow'],
    }, { cwd: board.cwd });
  }

  return { board, radarId: radar.id, created, updated, unchanged };
}

export async function listCompanionMissions(
  options: CompanionMissionListOptions = {},
): Promise<CompanionMission[]> {
  const board = await readCompanionMissionBoard(options);
  return board.missions.filter(mission => !options.status || mission.status === options.status);
}

export async function updateCompanionMissionStatus(
  missionIdValue: string,
  status: CompanionMissionStatus,
  options: CompanionMissionStatusUpdateOptions = {},
): Promise<CompanionMission> {
  const now = options.now || new Date();
  const nowIso = now.toISOString();
  const board = await readCompanionMissionBoard(options);
  const mission = board.missions.find(item => item.id === missionIdValue);
  if (!mission) {
    throw new Error(`Companion mission not found: ${missionIdValue}`);
  }

  mission.status = status;
  mission.updatedAt = nowIso;
  if (status === 'done' || status === 'dismissed') {
    mission.completedAt = nowIso;
  } else {
    delete mission.completedAt;
  }
  board.updatedAt = nowIso;
  board.missions = sortMissions(board.missions);
  await writeMissionBoard(board);

  if (options.recordPercept !== false) {
    await recordCompanionPercept({
      modality: 'tool',
      source: 'companion_mission_board',
      summary: `Companion mission ${mission.id} marked ${status}.`,
      confidence: 1,
      payload: {
        missionId: mission.id,
        status,
        storePath: board.storePath,
      },
      tags: ['mission-board', 'status', status],
    }, { cwd: board.cwd });
  }

  try {
    await recordCompanionSafetyEvent({
      kind: 'mission',
      risk: 'low',
      action: 'mission_status_update',
      reason: `Companion mission ${mission.id} was marked ${status}.`,
      status: 'completed',
      source: 'companion_mission_board',
      missionId: mission.id,
      payload: {
        missionId: mission.id,
        status,
        storePath: board.storePath,
      },
      tags: ['mission-board', 'status', status],
    }, { cwd: board.cwd, now });
  } catch {
    // Mission state already persisted; do not roll it back if audit append fails.
  }

  return mission;
}

export function formatCompanionMissionBoard(board: CompanionMissionBoard): string {
  const lines = [
    'Buddy Companion Mission Board',
    '='.repeat(50),
    '',
    `Workspace: ${board.cwd}`,
    `Path: ${board.storePath}`,
    `Updated: ${board.updatedAt}`,
    `Missions: ${board.missions.length}`,
  ];

  if (board.missions.length === 0) {
    lines.push('', 'No companion missions yet. Run `buddy companion missions sync`.');
    return lines.join('\n');
  }

  for (const mission of board.missions) {
    lines.push(
      '',
      `[${mission.priority}] [${mission.status}] ${mission.id}`,
      `  ${mission.title}`,
      `  ${mission.recommendation}`,
      `  Inspired by: ${mission.competitorRefs.join(', ')}`,
    );
    if (mission.command) lines.push(`  Command: ${mission.command}`);
  }

  return lines.join('\n');
}
