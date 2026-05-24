import { getCompanionStatus, type CompanionStatus, type CompanionStatusOptions } from './companion-mode.js';
import {
  readRecentCompanionPercepts,
  recordCompanionPercept,
  type CompanionPercept,
  type CompanionPerceptModality,
  type CompanionPerceptStats,
} from './percepts.js';

export type CompanionEvaluationSeverity = 'info' | 'warning' | 'action';
export type CompanionEvaluationArea =
  | 'brain'
  | 'identity'
  | 'voice'
  | 'vision'
  | 'hearing'
  | 'screen'
  | 'memory'
  | 'safety'
  | 'workflow';
export type CompanionEvaluationLevel = 'dormant' | 'awakening' | 'aware' | 'collaborative';

export interface CompanionSelfEvaluationFinding {
  id: string;
  area: CompanionEvaluationArea;
  severity: CompanionEvaluationSeverity;
  summary: string;
  recommendation: string;
  command?: string;
  tags: string[];
}

export interface CompanionSelfEvaluation {
  id: string;
  timestamp: string;
  cwd: string;
  score: number;
  level: CompanionEvaluationLevel;
  findings: CompanionSelfEvaluationFinding[];
  strengths: string[];
  nextActions: string[];
  perceptStats: CompanionPerceptStats;
}

export interface CompanionSelfEvaluationOptions extends CompanionStatusOptions {
  now?: Date;
  recordSuggestions?: boolean;
}

const RECENT_PERCEPT_LIMIT = 50;

function evaluationId(now: Date): string {
  return `companion-eval-${now.toISOString().replace(/[-:.TZ]/g, '')}`;
}

function levelForScore(score: number): CompanionEvaluationLevel {
  if (score >= 85) return 'collaborative';
  if (score >= 60) return 'aware';
  if (score >= 30) return 'awakening';
  return 'dormant';
}

function hasModality(
  modality: CompanionPerceptModality,
  stats: CompanionPerceptStats,
  recent: CompanionPercept[],
): boolean {
  return Boolean(stats.byModality[modality]) || recent.some(percept => percept.modality === modality);
}

function addFinding(
  findings: CompanionSelfEvaluationFinding[],
  finding: CompanionSelfEvaluationFinding,
): void {
  findings.push(finding);
}

function addScore(condition: boolean, points: number): number {
  return condition ? points : 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function buildFindings(
  status: CompanionStatus,
  stats: CompanionPerceptStats,
  recent: CompanionPercept[],
): CompanionSelfEvaluationFinding[] {
  const findings: CompanionSelfEvaluationFinding[] = [];
  const identityReady = status.identity.soulIsCompanion && status.identity.bootIsCompanion;
  const voiceReady = status.voice.enabled && status.voice.available;
  const ttsReady = status.tts.enabled && status.tts.available;
  const visionSeen = hasModality('vision', stats, recent);
  const hearingSeen = hasModality('hearing', stats, recent);
  const screenSeen = hasModality('screen', stats, recent);
  const selfSeen = hasModality('self', stats, recent);

  if (!status.chatGptCredentialsPresent) {
    addFinding(findings, {
      id: 'brain-chatgpt-login',
      area: 'brain',
      severity: 'action',
      summary: 'Le cerveau ChatGPT OAuth n est pas connecte.',
      recommendation: 'Connecter l abonnement ChatGPT pour que Buddy utilise le cerveau principal du systeme.',
      command: 'buddy login',
      tags: ['chatgpt', 'brain', 'auth'],
    });
  }

  if (!identityReady) {
    addFinding(findings, {
      id: 'identity-companion-files',
      area: 'identity',
      severity: 'action',
      summary: 'L identite compagnon n est pas entierement installee.',
      recommendation: 'Installer ou rafraichir SOUL.md et BOOT.md pour donner une posture stable a Buddy.',
      command: 'buddy companion setup',
      tags: ['identity', 'companion'],
    });
  }

  if (!voiceReady) {
    addFinding(findings, {
      id: 'voice-input-loop',
      area: 'voice',
      severity: 'warning',
      summary: 'La boucle vocale entrante n est pas encore prete.',
      recommendation: status.voice.reason
        ? `Corriger la disponibilite voix: ${status.voice.reason}`
        : 'Activer la saisie vocale dans Cowork ou lancer la configuration compagnon.',
      command: 'buddy companion setup',
      tags: ['voice', 'stt'],
    });
  }

  if (!ttsReady) {
    addFinding(findings, {
      id: 'voice-output-loop',
      area: 'voice',
      severity: 'warning',
      summary: 'La voix sortante TTS n est pas encore prete.',
      recommendation: status.tts.reason
        ? `Corriger la synthese vocale: ${status.tts.reason}`
        : 'Activer TTS pour permettre a Buddy de repondre oralement.',
      command: 'buddy companion setup',
      tags: ['voice', 'tts'],
    });
  }

  if (!status.camera.available) {
    addFinding(findings, {
      id: 'vision-camera-bridge',
      area: 'vision',
      severity: 'warning',
      summary: 'La passerelle camera locale n est pas disponible.',
      recommendation: status.camera.reason
        ? `Corriger l acces camera: ${status.camera.reason}`
        : 'Verifier ffmpeg et les permissions camera.',
      command: 'buddy companion camera status',
      tags: ['vision', 'camera'],
    });
  } else if (!visionSeen) {
    addFinding(findings, {
      id: 'vision-first-percept',
      area: 'vision',
      severity: 'action',
      summary: 'La camera est prete mais aucun percept visuel n a encore ete capture.',
      recommendation: 'Capturer une image de contexte pour que Buddy puisse ancrer son attention dans le monde visible.',
      command: 'buddy companion camera snapshot',
      tags: ['vision', 'percept'],
    });
  }

  if (!hearingSeen) {
    addFinding(findings, {
      id: 'hearing-first-percept',
      area: 'hearing',
      severity: 'action',
      summary: 'Aucun percept auditif n est encore enregistre.',
      recommendation: 'Parler a Buddy via Cowork afin que le journal conserve la boucle bidirectionnelle voix.',
      tags: ['hearing', 'voice', 'percept'],
    });
  }

  if (!screenSeen) {
    addFinding(findings, {
      id: 'screen-first-percept',
      area: 'screen',
      severity: 'action',
      summary: 'Aucun percept ecran n est encore enregistre.',
      recommendation: 'Demander une capture ou utiliser un outil ecran pour que Buddy voie aussi l espace de travail.',
      tags: ['screen', 'percept'],
    });
  }

  if (!selfSeen) {
    addFinding(findings, {
      id: 'self-state-loop',
      area: 'memory',
      severity: 'action',
      summary: 'Buddy n a pas encore note son propre etat interne.',
      recommendation: 'Enregistrer un self-state pour fermer la boucle proprioceptive du compagnon.',
      command: 'buddy companion self',
      tags: ['self', 'memory', 'proprioception'],
    });
  }

  if (!stats.exists || stats.total === 0) {
    addFinding(findings, {
      id: 'percept-journal-empty',
      area: 'memory',
      severity: 'warning',
      summary: 'Le journal sensoriel est vide.',
      recommendation: 'Utiliser le panneau compagnon, la voix, la camera et les captures pour construire une memoire d interaction locale.',
      tags: ['memory', 'percepts'],
    });
  }

  if (status.wakeWord.engine === 'text-match') {
    addFinding(findings, {
      id: 'wakeword-offline-engine',
      area: 'workflow',
      severity: 'info',
      summary: 'Le mot de reveil utilise le fallback text-match.',
      recommendation: 'Ajouter PICOVOICE_ACCESS_KEY pour un vrai reveil vocal local si Patrice veut une experience mains-libres.',
      tags: ['wakeword', 'voice'],
    });
  }

  addFinding(findings, {
    id: 'safety-explicit-permission',
    area: 'safety',
    severity: 'info',
    summary: 'Les sens du compagnon restent explicites et locaux.',
    recommendation: 'Conserver cette frontiere: camera, micro et captures doivent rester visibles, intentionnels et rattaches au projet actif.',
    tags: ['safety', 'privacy'],
  });

  return findings;
}

function buildStrengths(
  status: CompanionStatus,
  stats: CompanionPerceptStats,
  recent: CompanionPercept[],
): string[] {
  const strengths: string[] = [];
  if (status.chatGptCredentialsPresent) strengths.push(`Cerveau ChatGPT connecte via ${status.authPath}.`);
  if (status.identity.soulIsCompanion && status.identity.bootIsCompanion) {
    strengths.push('Identite compagnon installee et chargee.');
  }
  if (status.voice.enabled && status.voice.available) strengths.push(`Entree vocale prete (${status.voice.provider}).`);
  if (status.tts.enabled && status.tts.available) strengths.push(`Sortie vocale prete (${status.tts.provider}).`);
  if (status.camera.available) strengths.push(`Camera disponible sur ${status.camera.platform}.`);
  if (status.wakeWord.available) strengths.push(`Mot de reveil actif (${status.wakeWord.engine}).`);
  if (stats.total > 0) strengths.push(`${stats.total} percept(s) dans le journal sensoriel.`);
  if (hasModality('self', stats, recent)) strengths.push('Boucle proprioceptive deja amorcee.');
  strengths.push('Les donnees sensorielles sont journalisees localement par projet.');
  return strengths;
}

function buildNextActions(findings: CompanionSelfEvaluationFinding[]): string[] {
  return findings
    .filter(finding => finding.severity !== 'info')
    .slice(0, 5)
    .map(finding => finding.command
      ? `${finding.recommendation} (${finding.command})`
      : finding.recommendation);
}

function computeScore(
  status: CompanionStatus,
  stats: CompanionPerceptStats,
  recent: CompanionPercept[],
): number {
  const identityReady = status.identity.soulIsCompanion && status.identity.bootIsCompanion;
  const voiceReady = status.voice.enabled && status.voice.available;
  const ttsReady = status.tts.enabled && status.tts.available;
  const wakeWordPoints = status.wakeWord.engine === 'porcupine' ? 5 : 2;

  return Math.min(100, Math.round(
    addScore(status.chatGptCredentialsPresent, 20)
    + addScore(identityReady, 15)
    + addScore(voiceReady, 10)
    + addScore(ttsReady, 10)
    + addScore(status.camera.available, 10)
    + addScore(hasModality('vision', stats, recent), 5)
    + addScore(hasModality('hearing', stats, recent), 5)
    + addScore(hasModality('screen', stats, recent), 5)
    + addScore(hasModality('self', stats, recent), 5)
    + addScore(stats.total > 0, 5)
    + wakeWordPoints
    + 5,
  ));
}

async function recordEvaluationPercepts(evaluation: CompanionSelfEvaluation): Promise<void> {
  await recordCompanionPercept({
    modality: 'self',
    source: 'companion_self_evaluation',
    summary: `Buddy self-evaluation: ${evaluation.score}/100 (${evaluation.level}) with ${evaluation.findings.length} finding(s).`,
    confidence: 1,
    payload: {
      evaluationId: evaluation.id,
      score: evaluation.score,
      level: evaluation.level,
      findingIds: evaluation.findings.map(finding => finding.id),
      nextActions: evaluation.nextActions,
    },
    tags: ['self', 'evaluation', 'companion', 'self-improvement'],
  }, { cwd: evaluation.cwd });

  const suggestions = evaluation.findings
    .filter(finding => finding.severity !== 'info')
    .slice(0, 3);

  for (const finding of suggestions) {
    await recordCompanionPercept({
      modality: 'suggestion',
      source: 'companion_self_evaluation',
      summary: finding.recommendation,
      confidence: finding.severity === 'action' ? 0.95 : 0.8,
      payload: {
        evaluationId: evaluation.id,
        findingId: finding.id,
        area: finding.area,
        severity: finding.severity,
        command: finding.command,
      },
      tags: unique(['suggestion', 'self-improvement', finding.area, ...finding.tags]),
    }, { cwd: evaluation.cwd });
  }
}

export async function evaluateCompanionSelf(
  options: CompanionSelfEvaluationOptions = {},
): Promise<CompanionSelfEvaluation> {
  const now = options.now || new Date();
  const status = await getCompanionStatus({ cwd: options.cwd });
  const recent = await readRecentCompanionPercepts({
    cwd: status.cwd,
    limit: RECENT_PERCEPT_LIMIT,
  });
  const stats = status.percepts;
  const findings = buildFindings(status, stats, recent);
  const score = computeScore(status, stats, recent);
  const evaluation: CompanionSelfEvaluation = {
    id: evaluationId(now),
    timestamp: now.toISOString(),
    cwd: status.cwd,
    score,
    level: levelForScore(score),
    findings,
    strengths: buildStrengths(status, stats, recent),
    nextActions: buildNextActions(findings),
    perceptStats: stats,
  };

  if (options.recordSuggestions !== false) {
    await recordEvaluationPercepts(evaluation);
  }

  return evaluation;
}

export function formatCompanionSelfEvaluation(evaluation: CompanionSelfEvaluation): string {
  const lines = [
    'Buddy Companion Self-Evaluation',
    '='.repeat(50),
    '',
    `Workspace: ${evaluation.cwd}`,
    `Evaluation: ${evaluation.id}`,
    `Score: ${evaluation.score}/100 (${evaluation.level})`,
    `Percepts: ${evaluation.perceptStats.total} recorded`,
  ];

  if (evaluation.strengths.length > 0) {
    lines.push('', 'Strengths:', ...evaluation.strengths.map(item => `- ${item}`));
  }

  if (evaluation.findings.length > 0) {
    lines.push('', 'Findings:');
    for (const finding of evaluation.findings) {
      lines.push(`- [${finding.severity}] ${finding.area}: ${finding.summary}`);
      lines.push(`  ${finding.recommendation}`);
      if (finding.command) lines.push(`  Command: ${finding.command}`);
    }
  }

  if (evaluation.nextActions.length > 0) {
    lines.push('', 'Next actions:', ...evaluation.nextActions.map(item => `- ${item}`));
  }

  return lines.join('\n');
}
