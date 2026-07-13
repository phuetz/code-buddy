import { getCompanionStatus, type CompanionStatusOptions } from './companion-mode.js';
import {
  readRecentCompanionPercepts,
  recordCompanionPercept,
  type CompanionPercept,
  type CompanionPerceptModality,
} from './percepts.js';
import {
  readCompanionMissionBoard,
  type CompanionMission,
  type CompanionMissionPriority,
  type CompanionMissionStatus,
} from './mission-board.js';
import {
  getCompanionSafetyLedgerStats,
  readRecentCompanionSafetyEvents,
  type CompanionSafetyEvent,
} from './safety-ledger.js';
import { resolveUserName } from './user-name.js';

export type CompanionImpulseKind =
  | 'readiness'
  | 'sense'
  | 'mission'
  | 'safety'
  | 'memory'
  | 'conversation';
export type CompanionImpulsePriority = 'high' | 'medium' | 'low';

export interface CompanionImpulseEvidence {
  label: string;
  value: string;
}

export interface CompanionImpulse {
  id: string;
  kind: CompanionImpulseKind;
  priority: CompanionImpulsePriority;
  title: string;
  message: string;
  command?: string;
  evidence: CompanionImpulseEvidence[];
  tags: string[];
}

export interface CompanionImpulseBrief {
  id: string;
  timestamp: string;
  cwd: string;
  summary: string;
  nextPrompt: string;
  impulses: CompanionImpulse[];
  context: {
    perceptTotal: number;
    openMissions: number;
    inProgressMissions: number;
    safetyEvents: number;
    latestPerceptTimestamp?: string;
    latestSafetyTimestamp?: string;
  };
}

export interface CompanionImpulseBriefOptions extends CompanionStatusOptions {
  now?: Date;
  recordSuggestions?: boolean;
}

const RECENT_LIMIT = 60;
const VISION_STALE_HOURS = 24;
const HEARING_STALE_HOURS = 12;
const SELF_STALE_HOURS = 8;
const VOICE_STT_SLOW_MS = 2_500;
const VOICE_LOOP_SLOW_MS = 5_000;
const VOICE_RESPONSE_SLOW_MS = 3_000;
const VOICE_SIGNAL_MARGIN = 1.35;

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

function briefId(now: Date): string {
  return `companion-impulses-${now.toISOString().replace(/[-:.TZ]/g, '')}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function priorityRank(priority: CompanionImpulsePriority): number {
  if (priority === 'high') return 0;
  if (priority === 'medium') return 1;
  return 2;
}

function missionPriorityRank(priority: CompanionMissionPriority): number {
  if (priority === 'P0') return 0;
  if (priority === 'P1') return 1;
  return 2;
}

function missionStatusRank(status: CompanionMissionStatus): number {
  if (status === 'in_progress') return 0;
  if (status === 'open') return 1;
  if (status === 'done') return 2;
  return 3;
}

function newestPercept(
  percepts: CompanionPercept[],
  modality: CompanionPerceptModality
): CompanionPercept | undefined {
  return percepts.find((percept) => percept.modality === modality);
}

function hoursSince(timestamp: string | undefined, now: Date): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, (now.getTime() - ms) / 3_600_000);
}

function isStale(timestamp: string | undefined, now: Date, hours: number): boolean {
  const age = hoursSince(timestamp, now);
  return age === null || age >= hours;
}

function formatAge(timestamp: string | undefined, now: Date): string {
  const age = hoursSince(timestamp, now);
  if (age === null) return 'never';
  if (age < 1) return `${Math.round(age * 60)}m ago`;
  if (age < 48) return `${Math.round(age)}h ago`;
  return `${Math.round(age / 24)}d ago`;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finiteNumberValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function formatMs(value: number | undefined): string {
  return typeof value === 'number' ? `${Math.round(value)}ms` : 'unknown';
}

interface VoiceLoopMetrics {
  sttMs?: number;
  totalMs?: number;
  decisionMs?: number;
  actionMs?: number;
  firstAudioMs?: number;
  perceivedResponseMs?: number;
  voiceTotalMs?: number;
  captureMs?: number;
  writeMs?: number;
  sampleRate?: number;
  peakRms?: number;
  avgRms?: number;
  rmsOn?: number;
  rmsOff?: number;
  device?: string;
}

function extractVoiceLoopMetrics(percept: CompanionPercept | undefined): VoiceLoopMetrics | null {
  const payload = objectValue(percept?.payload);
  if (!payload) return null;
  const latency = objectValue(payload.latency);
  const capture = objectValue(payload.capture);
  if (!latency && !capture) return null;

  const metrics: VoiceLoopMetrics = {
    sttMs: finiteNumberValue(latency?.sttMs),
    totalMs: finiteNumberValue(latency?.totalMs),
    decisionMs: finiteNumberValue(latency?.decisionMs),
    actionMs: finiteNumberValue(latency?.actionMs),
    firstAudioMs: finiteNumberValue(latency?.firstAudioMs),
    perceivedResponseMs: finiteNumberValue(latency?.perceivedResponseMs),
    voiceTotalMs: finiteNumberValue(latency?.voiceTotalMs),
    captureMs: finiteNumberValue(capture?.ms),
    writeMs: finiteNumberValue(capture?.writeMs),
    sampleRate: finiteNumberValue(capture?.sampleRate),
    peakRms: finiteNumberValue(capture?.peakRms) ?? finiteNumberValue(capture?.rms),
    avgRms: finiteNumberValue(capture?.avgRms),
    rmsOn: finiteNumberValue(capture?.rmsOn),
    rmsOff: finiteNumberValue(capture?.rmsOff),
    device: stringValue(capture?.device),
  };
  if (
    metrics.sttMs === undefined &&
    metrics.totalMs === undefined &&
    metrics.captureMs === undefined &&
    metrics.writeMs === undefined &&
    metrics.peakRms === undefined
  ) {
    return null;
  }
  return metrics;
}

function buildVoiceLatencyImpulse(
  impulses: CompanionImpulse[],
  latestHearing: CompanionPercept | undefined
): void {
  const metrics = extractVoiceLoopMetrics(latestHearing);
  if (!metrics) return;
  const slowStt = typeof metrics.sttMs === 'number' && metrics.sttMs >= VOICE_STT_SLOW_MS;
  const responseLatency = metrics.perceivedResponseMs ?? metrics.totalMs;
  const responseBudget =
    metrics.perceivedResponseMs !== undefined ? VOICE_RESPONSE_SLOW_MS : VOICE_LOOP_SLOW_MS;
  const slowLoop = typeof responseLatency === 'number' && responseLatency >= responseBudget;
  if (!slowStt && !slowLoop) return;

  const priority: CompanionImpulsePriority =
    (responseLatency || 0) >= responseBudget * 1.6 ||
    (metrics.sttMs || 0) >= VOICE_STT_SLOW_MS * 1.6
      ? 'high'
      : 'medium';

  addImpulse(impulses, {
    kind: 'sense',
    priority,
    title: 'Reduce voice latency',
    message:
      'Tune perceived voice latency: keep the warm reply stream active, prefer a fast routed model, and use a smaller speech-recognition model if STT dominates.',
    command: 'buddy companion percepts recent --limit 5 --modality hearing',
    evidence: [
      { label: 'stt', value: formatMs(metrics.sttMs) },
      { label: 'first audio', value: formatMs(metrics.firstAudioMs) },
      { label: 'perceived response', value: formatMs(metrics.perceivedResponseMs) },
      { label: 'loop', value: formatMs(metrics.totalMs) },
      { label: 'capture', value: formatMs(metrics.captureMs) },
      { label: 'device', value: metrics.device || 'unknown' },
    ],
    tags: ['voice', 'hearing', 'latency', 'realtime'],
  });
}

function buildVoiceCaptureQualityImpulse(
  impulses: CompanionImpulse[],
  latestHearing: CompanionPercept | undefined
): void {
  const metrics = extractVoiceLoopMetrics(latestHearing);
  if (!metrics?.peakRms || !metrics.rmsOn) return;
  const weakSignal = metrics.peakRms < metrics.rmsOn * VOICE_SIGNAL_MARGIN;
  if (!weakSignal) return;

  addImpulse(impulses, {
    kind: 'sense',
    priority: metrics.peakRms < metrics.rmsOn * 1.1 ? 'high' : 'medium',
    title: 'Improve voice capture',
    message:
      'Improve microphone gain or placement; the latest speech signal was too close to the VAD threshold.',
    command: 'buddy companion percepts recent --limit 5 --modality hearing',
    evidence: [
      { label: 'peak rms', value: metrics.peakRms.toFixed(4) },
      {
        label: 'avg rms',
        value: metrics.avgRms !== undefined ? metrics.avgRms.toFixed(4) : 'unknown',
      },
      { label: 'vad on', value: metrics.rmsOn.toFixed(4) },
      { label: 'device', value: metrics.device || 'unknown' },
    ],
    tags: ['voice', 'hearing', 'capture', 'quality'],
  });
}

function selectActiveMission(missions: CompanionMission[]): CompanionMission | undefined {
  const candidates = [...missions]
    .filter((mission) => mission.status === 'in_progress' || mission.status === 'open')
    .sort(
      (a, b) =>
        missionStatusRank(a.status) - missionStatusRank(b.status) ||
        missionPriorityRank(a.priority) - missionPriorityRank(b.priority) ||
        a.updatedAt.localeCompare(b.updatedAt)
    );
  return candidates[0];
}

function addImpulse(impulses: CompanionImpulse[], input: Omit<CompanionImpulse, 'id'>): void {
  const id = `${input.kind}-${slug(input.title)}`;
  if (impulses.some((impulse) => impulse.id === id)) return;
  impulses.push({ id, ...input });
}

function buildSummary(impulses: CompanionImpulse[]): string {
  if (impulses.length === 0) {
    return 'Buddy has no urgent companion impulse right now.';
  }
  const high = impulses.filter((impulse) => impulse.priority === 'high').length;
  const medium = impulses.filter((impulse) => impulse.priority === 'medium').length;
  return `Buddy has ${impulses.length} companion impulse(s): ${high} high, ${medium} medium.`;
}

function buildNextPrompt(impulses: CompanionImpulse[]): string {
  const first = impulses[0];
  if (!first) {
    return `${resolveUserName()}, the companion loop is quiet. I can keep watching the mission board or you can give me the next goal.`;
  }
  return `${resolveUserName()}, my next useful move is: ${first.message}`;
}

function sortImpulses(impulses: CompanionImpulse[]): CompanionImpulse[] {
  return [...impulses].sort(
    (a, b) =>
      priorityRank(a.priority) - priorityRank(b.priority) ||
      a.kind.localeCompare(b.kind) ||
      a.title.localeCompare(b.title)
  );
}

function buildReadinessImpulses(
  impulses: CompanionImpulse[],
  status: Awaited<ReturnType<typeof getCompanionStatus>>
): void {
  if (!status.chatGptCredentialsPresent) {
    addImpulse(impulses, {
      kind: 'readiness',
      priority: 'high',
      title: 'Connect ChatGPT brain',
      message: 'Connect the ChatGPT OAuth brain before expanding autonomy.',
      command: 'buddy login',
      evidence: [{ label: 'auth', value: status.authPath }],
      tags: ['brain', 'chatgpt', 'oauth'],
    });
  }

  if (!status.identity.soulIsCompanion || !status.identity.bootIsCompanion) {
    addImpulse(impulses, {
      kind: 'readiness',
      priority: 'high',
      title: 'Install companion identity',
      message: 'Refresh SOUL.md and BOOT.md so Buddy keeps a stable companion posture.',
      command: 'buddy companion setup',
      evidence: [
        { label: 'soul', value: status.identity.soulIsCompanion ? 'ready' : 'missing' },
        { label: 'boot', value: status.identity.bootIsCompanion ? 'ready' : 'missing' },
      ],
      tags: ['identity', 'companion'],
    });
  }

  if (
    !status.voice.enabled ||
    !status.voice.available ||
    !status.tts.enabled ||
    !status.tts.available
  ) {
    addImpulse(impulses, {
      kind: 'readiness',
      priority: 'medium',
      title: 'Repair voice loop',
      message: 'Repair voice input or output so dialogue can stay bidirectional.',
      command: 'buddy companion status',
      evidence: [
        {
          label: 'voice',
          value: status.voice.reason || (status.voice.available ? 'ready' : 'unavailable'),
        },
        {
          label: 'tts',
          value: status.tts.reason || (status.tts.available ? 'ready' : 'unavailable'),
        },
      ],
      tags: ['voice', 'tts', 'hearing'],
    });
  }
}

function buildSenseImpulses(
  impulses: CompanionImpulse[],
  status: Awaited<ReturnType<typeof getCompanionStatus>>,
  recent: CompanionPercept[],
  now: Date
): void {
  const latestVision = newestPercept(recent, 'vision');
  const latestHearing = newestPercept(recent, 'hearing');
  const latestSelf = newestPercept(recent, 'self');

  if (status.camera.available && isStale(latestVision?.timestamp, now, VISION_STALE_HOURS)) {
    addImpulse(impulses, {
      kind: 'sense',
      priority: latestVision ? 'medium' : 'high',
      title: 'Refresh visual context',
      message:
        'Take a camera snapshot so Buddy can ground the next exchange in the visible workspace.',
      command: 'buddy companion camera snapshot',
      evidence: [{ label: 'last vision', value: formatAge(latestVision?.timestamp, now) }],
      tags: ['vision', 'camera', 'percept'],
    });
  }

  if (
    status.voice.enabled &&
    status.voice.available &&
    isStale(latestHearing?.timestamp, now, HEARING_STALE_HOURS)
  ) {
    addImpulse(impulses, {
      kind: 'conversation',
      priority: latestHearing ? 'low' : 'medium',
      title: 'Invite a voice check-in',
      message: 'Open a short voice check-in; Buddy has not recorded a recent hearing percept.',
      evidence: [{ label: 'last hearing', value: formatAge(latestHearing?.timestamp, now) }],
      tags: ['voice', 'hearing', 'check-in'],
    });
  }

  if (status.voice.enabled && status.voice.available) {
    buildVoiceLatencyImpulse(impulses, latestHearing);
    buildVoiceCaptureQualityImpulse(impulses, latestHearing);
  }

  if (isStale(latestSelf?.timestamp, now, SELF_STALE_HOURS)) {
    addImpulse(impulses, {
      kind: 'memory',
      priority: latestSelf ? 'low' : 'medium',
      title: 'Record self-state',
      message: 'Record Buddy self-state to keep the proprioception loop fresh.',
      command: 'buddy companion self',
      evidence: [{ label: 'last self', value: formatAge(latestSelf?.timestamp, now) }],
      tags: ['self', 'memory', 'proprioception'],
    });
  }
}

function buildMissionImpulse(impulses: CompanionImpulse[], missions: CompanionMission[]): void {
  const mission = selectActiveMission(missions);
  if (!mission) return;

  addImpulse(impulses, {
    kind: 'mission',
    priority: mission.priority === 'P0' ? 'high' : 'medium',
    title: `Run ${mission.id}`,
    message: `Prepare or continue the next companion mission: ${mission.title}`,
    command: 'buddy companion missions run-next',
    evidence: [
      { label: 'priority', value: mission.priority },
      { label: 'status', value: mission.status },
      { label: 'dimension', value: mission.dimension },
    ],
    tags: ['mission', 'self-improvement', mission.priority.toLowerCase(), ...mission.tags],
  });
}

function buildSafetyImpulse(
  impulses: CompanionImpulse[],
  stats: Awaited<ReturnType<typeof getCompanionSafetyLedgerStats>>,
  events: CompanionSafetyEvent[]
): void {
  const interesting = events.find(
    (event) => event.risk === 'high' || event.status === 'failed' || event.status === 'denied'
  );

  if (interesting) {
    addImpulse(impulses, {
      kind: 'safety',
      priority: interesting.risk === 'high' ? 'high' : 'medium',
      title: 'Review safety ledger',
      message: `Review the latest ${interesting.status} companion safety event before increasing autonomy.`,
      command: 'buddy companion safety recent',
      evidence: [
        { label: 'event', value: interesting.action },
        { label: 'risk', value: interesting.risk },
      ],
      tags: ['safety', 'audit', interesting.status],
    });
  } else if (stats.total > 0) {
    addImpulse(impulses, {
      kind: 'safety',
      priority: 'low',
      title: 'Skim recent safety events',
      message: 'Skim the companion safety ledger to keep sensory and mission actions visible.',
      command: 'buddy companion safety recent --limit 5',
      evidence: [{ label: 'events', value: String(stats.total) }],
      tags: ['safety', 'audit'],
    });
  }
}

async function recordImpulseSuggestions(brief: CompanionImpulseBrief): Promise<void> {
  for (const impulse of brief.impulses.slice(0, 4)) {
    await recordCompanionPercept(
      {
        modality: 'suggestion',
        source: 'companion_impulses',
        summary: impulse.message,
        confidence: impulse.priority === 'high' ? 0.95 : impulse.priority === 'medium' ? 0.85 : 0.7,
        payload: {
          briefId: brief.id,
          impulseId: impulse.id,
          kind: impulse.kind,
          priority: impulse.priority,
          command: impulse.command,
          evidence: impulse.evidence,
        },
        tags: ['impulse', 'proactive', ...impulse.tags],
      },
      { cwd: brief.cwd }
    );
  }
}

export async function buildCompanionImpulseBrief(
  options: CompanionImpulseBriefOptions = {}
): Promise<CompanionImpulseBrief> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const [status, recent, board, safetyStats, safetyEvents] = await Promise.all([
    getCompanionStatus({ cwd }),
    readRecentCompanionPercepts({ cwd, limit: RECENT_LIMIT }),
    readCompanionMissionBoard({ cwd }),
    getCompanionSafetyLedgerStats({ cwd }),
    readRecentCompanionSafetyEvents({ cwd, limit: 10 }),
  ]);

  const impulses: CompanionImpulse[] = [];
  buildReadinessImpulses(impulses, status);
  buildSenseImpulses(impulses, status, recent, now);
  buildMissionImpulse(impulses, board.missions);
  buildSafetyImpulse(impulses, safetyStats, safetyEvents);

  if (status.percepts.total === 0) {
    addImpulse(impulses, {
      kind: 'memory',
      priority: 'high',
      title: 'Start sensory journal',
      message:
        'Start the companion sensory journal with a self-state, voice check-in, or camera snapshot.',
      command: 'buddy companion self',
      evidence: [{ label: 'percepts', value: '0' }],
      tags: ['memory', 'percepts', 'bootstrap'],
    });
  }

  const sorted = sortImpulses(impulses);
  const brief: CompanionImpulseBrief = {
    id: briefId(now),
    timestamp: now.toISOString(),
    cwd: status.cwd,
    summary: buildSummary(sorted),
    nextPrompt: buildNextPrompt(sorted),
    impulses: sorted,
    context: {
      perceptTotal: status.percepts.total,
      openMissions: board.missions.filter((mission) => mission.status === 'open').length,
      inProgressMissions: board.missions.filter((mission) => mission.status === 'in_progress')
        .length,
      safetyEvents: safetyStats.total,
      latestPerceptTimestamp: status.percepts.latestTimestamp,
      latestSafetyTimestamp: safetyStats.latestTimestamp,
    },
  };

  if (options.recordSuggestions !== false) {
    await recordImpulseSuggestions(brief);
  }

  return brief;
}

export function formatCompanionImpulseBrief(brief: CompanionImpulseBrief): string {
  const lines = [
    'Buddy Companion Impulses',
    '='.repeat(50),
    '',
    `Workspace: ${brief.cwd}`,
    `Brief: ${brief.id}`,
    `Summary: ${brief.summary}`,
    `Next prompt: ${brief.nextPrompt}`,
    '',
    `Context: ${brief.context.perceptTotal} percept(s), ${brief.context.openMissions} open mission(s), ${brief.context.inProgressMissions} in progress, ${brief.context.safetyEvents} safety event(s)`,
  ];

  if (brief.impulses.length === 0) {
    lines.push('', 'No companion impulses right now.');
    return lines.join('\n');
  }

  lines.push('', 'Impulses:');
  for (const impulse of brief.impulses) {
    lines.push(`- [${impulse.priority}] ${impulse.kind}: ${impulse.title}`);
    lines.push(`  ${impulse.message}`);
    if (impulse.command) lines.push(`  Command: ${impulse.command}`);
    if (impulse.evidence.length > 0) {
      lines.push(
        `  Evidence: ${impulse.evidence.map((item) => `${item.label}=${item.value}`).join('; ')}`
      );
    }
  }

  return lines.join('\n');
}
