import {
  evaluateCompanionSelf,
  type CompanionSelfEvaluation,
} from './self-evaluation.js';
import { recordCompanionPercept } from './percepts.js';

export type CompanionRadarDimension =
  | 'channels'
  | 'learning'
  | 'runtime'
  | 'automation'
  | 'multimodal'
  | 'workflow'
  | 'plugins'
  | 'safety'
  | 'memory'
  | 'ui';

export type CompanionRadarSeverity = 'lead' | 'parity' | 'gap';

export interface CompanionCompetitorProfile {
  id: string;
  name: string;
  sourceUrl: string;
  strengths: string[];
  dimensions: CompanionRadarDimension[];
}

export interface CompanionCompetitiveGap {
  id: string;
  dimension: CompanionRadarDimension;
  severity: CompanionRadarSeverity;
  summary: string;
  recommendation: string;
  competitorRefs: string[];
  command?: string;
  tags: string[];
}

export interface CompanionCompetitiveRadar {
  id: string;
  timestamp: string;
  cwd: string;
  score: number;
  comparedAgainst: CompanionCompetitorProfile[];
  currentStrengths: string[];
  gaps: CompanionCompetitiveGap[];
  nextMoves: string[];
  sourceNotes: string[];
  selfEvaluation: Pick<CompanionSelfEvaluation, 'score' | 'level' | 'findings' | 'nextActions'>;
}

export interface CompanionCompetitiveRadarOptions {
  cwd?: string;
  now?: Date;
  recordSuggestions?: boolean;
}

export const COMPANION_COMPETITORS: CompanionCompetitorProfile[] = [
  {
    id: 'hermes-agent',
    name: 'Hermes Agent',
    sourceUrl: 'https://github.com/NousResearch/hermes-agent',
    dimensions: ['learning', 'runtime', 'automation', 'plugins', 'channels', 'memory'],
    strengths: [
      'Closed learning loop: creates and improves skills from experience.',
      'Messaging gateway for Telegram, Discord, Slack, WhatsApp, Signal, and email.',
      'Cron scheduling plus delivery to external channels.',
      'Remote and sandboxed terminal backends including Docker, SSH, Modal, Daytona, and Vercel Sandbox.',
    ],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    sourceUrl: 'https://openclaw.ai/',
    dimensions: ['channels', 'automation', 'plugins', 'workflow', 'memory', 'safety'],
    strengths: [
      'Personal-agent posture across chat apps, desktop actions, browser control, files, shell, and integrations.',
      'Persistent memory and 50+ integrations for daily-life automation.',
      'Community skills/plugins and examples such as daily briefings, voice-guided production fixes, and inbox workflows.',
    ],
  },
  {
    id: 'lisa',
    name: 'Lisa',
    sourceUrl: 'https://github.com/phuetz/Lisa',
    dimensions: ['multimodal', 'workflow', 'plugins', 'ui', 'safety'],
    strengths: [
      'Browser-first senses: face, hands, objects, posture, sounds, WebRTC, TensorFlow.js, Web Speech API.',
      'Specialized agents with planner orchestration, dependencies, checkpoints, and reusable workflows.',
      'Computer-control skills that can be learned and replayed.',
    ],
  },
  {
    id: 'uni',
    name: 'UNI Companion',
    sourceUrl: 'https://uni-ai.dev/',
    dimensions: ['multimodal', 'memory', 'ui', 'automation', 'channels'],
    strengths: [
      'Real-time voice with interruption, camera sharing, wake words, and local encrypted memory.',
      'UI cards for plugin output and proactive impulses such as reminders or spontaneous conversation.',
      'Home-network pairing for phone, tablet, and laptop access.',
    ],
  },
];

function radarId(now: Date): string {
  return `companion-radar-${now.toISOString().replace(/[-:.TZ]/g, '')}`;
}

function hasFinding(evaluation: CompanionSelfEvaluation, id: string): boolean {
  return evaluation.findings.some(finding => finding.id === id);
}

function buildCurrentStrengths(evaluation: CompanionSelfEvaluation): string[] {
  const strengths = [
    'ChatGPT-Pro-first companion route through the existing Code Buddy brain when OAuth is connected.',
    'Cowork companion cockpit with local status, percept filters, camera snapshots, and self-evaluation.',
    'Project-scoped sensory journal for vision, hearing, screen, self-state, memory, tool events, and suggestions.',
    'Fleet, slash commands, CLI commands, MCP/plugin surface, and safety/permission plumbing already exist in the host system.',
  ];

  if (evaluation.score >= 60) {
    strengths.push(`Companion readiness is already ${evaluation.level} (${evaluation.score}/100).`);
  }
  if (!hasFinding(evaluation, 'vision-camera-bridge')) {
    strengths.push('Camera bridge is wired as an explicit, user-triggered sense.');
  }

  return strengths;
}

function buildGaps(evaluation: CompanionSelfEvaluation): CompanionCompetitiveGap[] {
  const gaps: CompanionCompetitiveGap[] = [
    {
      id: 'companion-cross-channel-gateway',
      dimension: 'channels',
      severity: 'gap',
      summary: 'Buddy has Fleet/server foundations, but no dedicated always-on companion gateway across chat apps.',
      recommendation: 'Create a companion gateway profile that maps Telegram/Discord/Signal/WhatsApp-style messages into the same project-scoped percept and approval model.',
      competitorRefs: ['hermes-agent', 'openclaw', 'uni'],
      tags: ['channels', 'gateway', 'always-on'],
    },
    {
      id: 'companion-skill-curator',
      dimension: 'learning',
      severity: 'gap',
      summary: 'Buddy records lessons and suggestions, but does not yet curate companion skills from repeated successful routines.',
      recommendation: 'Add a companion skill curator that promotes repeated percept/suggestion patterns into reviewed skills, then prunes stale ones.',
      competitorRefs: ['hermes-agent', 'openclaw', 'lisa'],
      command: 'buddy companion radar',
      tags: ['skills', 'learning-loop', 'curation'],
    },
    {
      id: 'companion-remote-runtime',
      dimension: 'runtime',
      severity: 'gap',
      summary: 'Buddy is strong locally, but the companion does not yet hibernate/wake on a remote persistent runtime.',
      recommendation: 'Finish the Daytona/Modal/Vercel backend path so the companion can keep working while the desktop sleeps.',
      competitorRefs: ['hermes-agent'],
      tags: ['runtime', 'remote', 'persistence'],
    },
    {
      id: 'companion-voice-barge-in',
      dimension: 'multimodal',
      severity: hasFinding(evaluation, 'voice-input-loop') ? 'gap' : 'parity',
      summary: 'Voice input/TTS exists, but true real-time interruption and full-duplex conversation are not yet first-class.',
      recommendation: 'Add barge-in semantics: stop speaking when Patrice talks, keep partial transcript state, and resume with the revised instruction.',
      competitorRefs: ['uni', 'lisa'],
      tags: ['voice', 'barge-in', 'full-duplex'],
    },
    {
      id: 'companion-ui-cards',
      dimension: 'ui',
      severity: 'gap',
      summary: 'Cowork shows companion state, but tools cannot yet push typed interactive UI cards into the companion panel.',
      recommendation: 'Create a companion card schema for weather, timers, approvals, camera frames, checklists, and workflow steps.',
      competitorRefs: ['uni', 'lisa'],
      tags: ['ui', 'cards', 'cowork'],
    },
    {
      id: 'companion-workflow-board',
      dimension: 'workflow',
      severity: 'gap',
      summary: 'Agent teams and workflows exist, but the companion lacks a simple visible mission board with dependencies and checkpoints.',
      recommendation: 'Expose a companion mission board that turns multi-step requests into visible steps, blockers, checkpoints, and resumable templates.',
      competitorRefs: ['lisa', 'hermes-agent', 'openclaw'],
      tags: ['workflow', 'planner', 'checkpoints'],
    },
    {
      id: 'companion-proactive-briefings',
      dimension: 'automation',
      severity: 'gap',
      summary: 'Schedulers exist, but the companion does not yet propose daily briefings, weekly reviews, or sensory reminders from its own radar.',
      recommendation: 'Add opt-in companion impulses: daily readiness brief, weekly self-review, and reminders when vision/hearing/screen percepts go stale.',
      competitorRefs: ['openclaw', 'uni', 'hermes-agent'],
      tags: ['automation', 'briefing', 'impulses'],
    },
    {
      id: 'companion-encrypted-senses',
      dimension: 'memory',
      severity: 'gap',
      summary: 'The percept journal is project-local and explicit, but not encrypted at rest.',
      recommendation: 'Add optional encryption for companion percepts and snapshots, with clear export/delete controls.',
      competitorRefs: ['uni', 'openclaw'],
      tags: ['memory', 'privacy', 'encryption'],
    },
    {
      id: 'companion-action-safety-ledger',
      dimension: 'safety',
      severity: 'parity',
      summary: 'Buddy has stronger approval plumbing than most companion demos, but sensory and autonomy decisions need one unified visible ledger.',
      recommendation: 'Render a companion safety ledger: what sense/tool was used, why, user approval, output artifact, and rollback/delete affordances.',
      competitorRefs: ['openclaw', 'hermes-agent', 'uni'],
      tags: ['safety', 'audit', 'permissions'],
    },
    {
      id: 'companion-computer-skill-replay',
      dimension: 'plugins',
      severity: 'gap',
      summary: 'Lisa-style learned desktop actions are not yet a companion-native reusable primitive.',
      recommendation: 'Let Buddy save successful screen/computer-use action traces as reviewed replayable skills with parameters.',
      competitorRefs: ['lisa', 'openclaw'],
      tags: ['computer-use', 'skills', 'replay'],
    },
  ];

  if (hasFinding(evaluation, 'brain-chatgpt-login')) {
    gaps.unshift({
      id: 'companion-brain-login',
      dimension: 'memory',
      severity: 'gap',
      summary: 'The ChatGPT subscription brain is not connected in this environment.',
      recommendation: 'Run `buddy login` so the companion uses Patrice\'s ChatGPT Pro brain route before deeper automation.',
      competitorRefs: ['hermes-agent', 'openclaw'],
      command: 'buddy login',
      tags: ['brain', 'auth', 'chatgpt'],
    });
  }

  return gaps;
}

function scoreFromGaps(gaps: CompanionCompetitiveGap[], evaluation: CompanionSelfEvaluation): number {
  const penalty = gaps.reduce((sum, gap) => sum + (gap.severity === 'gap' ? 7 : gap.severity === 'parity' ? 2 : 0), 0);
  return Math.max(0, Math.min(100, Math.round((evaluation.score * 0.55) + (100 - penalty) * 0.45)));
}

function sourceNotes(): string[] {
  return COMPANION_COMPETITORS.map(profile => `${profile.name}: ${profile.sourceUrl}`);
}

async function recordRadarSuggestions(radar: CompanionCompetitiveRadar): Promise<void> {
  for (const gap of radar.gaps.filter(item => item.severity === 'gap').slice(0, 5)) {
    await recordCompanionPercept({
      modality: 'suggestion',
      source: 'companion_competitive_radar',
      summary: gap.recommendation,
      confidence: 0.86,
      payload: {
        radarId: radar.id,
        gapId: gap.id,
        dimension: gap.dimension,
        severity: gap.severity,
        competitors: gap.competitorRefs,
        command: gap.command,
      },
      tags: ['competitive-radar', 'self-improvement', gap.dimension, ...gap.tags],
    }, { cwd: radar.cwd });
  }
}

export async function buildCompanionCompetitiveRadar(
  options: CompanionCompetitiveRadarOptions = {},
): Promise<CompanionCompetitiveRadar> {
  const now = options.now || new Date();
  const evaluation = await evaluateCompanionSelf({
    cwd: options.cwd,
    now,
    recordSuggestions: false,
  });
  const gaps = buildGaps(evaluation);
  const radar: CompanionCompetitiveRadar = {
    id: radarId(now),
    timestamp: now.toISOString(),
    cwd: evaluation.cwd,
    score: scoreFromGaps(gaps, evaluation),
    comparedAgainst: COMPANION_COMPETITORS,
    currentStrengths: buildCurrentStrengths(evaluation),
    gaps,
    nextMoves: gaps
      .filter(gap => gap.severity === 'gap')
      .slice(0, 6)
      .map(gap => gap.command ? `${gap.recommendation} (${gap.command})` : gap.recommendation),
    sourceNotes: sourceNotes(),
    selfEvaluation: {
      score: evaluation.score,
      level: evaluation.level,
      findings: evaluation.findings,
      nextActions: evaluation.nextActions,
    },
  };

  if (options.recordSuggestions !== false) {
    await recordRadarSuggestions(radar);
  }

  return radar;
}

export function formatCompanionCompetitiveRadar(radar: CompanionCompetitiveRadar): string {
  const lines = [
    'Buddy Companion Competitive Radar',
    '='.repeat(50),
    '',
    `Workspace: ${radar.cwd}`,
    `Radar: ${radar.id}`,
    `Competitive score: ${radar.score}/100`,
    `Self-evaluation: ${radar.selfEvaluation.score}/100 (${radar.selfEvaluation.level})`,
    `Compared against: ${radar.comparedAgainst.map(profile => profile.name).join(', ')}`,
  ];

  lines.push('', 'Current strengths:', ...radar.currentStrengths.map(item => `- ${item}`));

  lines.push('', 'Priority gaps:');
  for (const gap of radar.gaps.slice(0, 10)) {
    lines.push(`- [${gap.severity}] ${gap.dimension}: ${gap.summary}`);
    lines.push(`  ${gap.recommendation}`);
    lines.push(`  Inspired by: ${gap.competitorRefs.join(', ')}`);
    if (gap.command) lines.push(`  Command: ${gap.command}`);
  }

  if (radar.nextMoves.length > 0) {
    lines.push('', 'Next moves:', ...radar.nextMoves.map(item => `- ${item}`));
  }

  lines.push('', 'Sources:', ...radar.sourceNotes.map(item => `- ${item}`));
  return lines.join('\n');
}
