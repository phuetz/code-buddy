/**
 * Session Skill Generator — auto-generates a reusable SKILL.md from a complex
 * session transcript.
 *
 * Triggered automatically when a session is flagged as "complex" (many tool
 * calls, errors recovered, multi-step reasoning). Produces a candidate skill
 * that is safety-gated and installed as an authored-* skill, so the next time
 * the same situation arises the agent reuses the guide instead of re-learning.
 *
 * @module agent/self-improvement/session-skill-generator
 */

import { LiveSkillMutator, safetyGateSkill, toAuthoredSkillName } from './skill-mutator.js';
import { EvolutionaryArchive } from './evolutionary-archive.js';
import { logger } from '../../utils/logger.js';

export interface SessionTranscript {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
  toolCalls: number;
  errorsRecovered: number;
  filesTouched: string[];
  summary?: string;
}

export interface GeneratedSkill {
  name: string;
  description: string;
  content: string;
  sourceSessionId: string;
  complexityScore: number;
}

export interface SessionSkillGeneratorOptions {
  mutator?: LiveSkillMutator;
  archive?: EvolutionaryArchive;
  minToolCalls?: number;
  minErrorsRecovered?: number;
  minComplexityScore?: number;
}

const DEFAULTS = {
  minToolCalls: 8,
  minErrorsRecovered: 1,
  minComplexityScore: 6,
};

/**
 * Heuristic complexity score. Higher = more worth turning into a skill.
 */
export function scoreSessionComplexity(session: SessionTranscript): number {
  let score = 0;
  score += Math.min(session.toolCalls / 4, 6);
  score += Math.min(session.errorsRecovered * 2, 4);
  score += Math.min(session.filesTouched.length / 2, 3);
  if (session.summary && session.summary.length > 200) score += 1;
  const hasDecision = session.messages.some(
    (m) => m.role === 'user' && /(?:décid|decided|choisi|chose|préfère|prefer)/i.test(m.content),
  );
  if (hasDecision) score += 1;
  return Math.round(score * 10) / 10;
}

export function isComplexSession(
  session: SessionTranscript,
  opts: SessionSkillGeneratorOptions = {},
): boolean {
  const minToolCalls = opts.minToolCalls ?? DEFAULTS.minToolCalls;
  const minErrors = opts.minErrorsRecovered ?? DEFAULTS.minErrorsRecovered;
  const minScore = opts.minComplexityScore ?? DEFAULTS.minComplexityScore;
  const score = scoreSessionComplexity(session);
  return (
    session.toolCalls >= minToolCalls ||
    session.errorsRecovered >= minErrors ||
    score >= minScore
  );
}

/**
 * Build a deterministic SKILL.md draft from the session transcript.
 * No LLM call here — pure extraction so it works offline and is testable.
 */
export function buildSkillDraft(session: SessionTranscript): GeneratedSkill {
  const name = toAuthoredSkillName(`session-${session.sessionId.slice(0, 8)}`);
  const keySteps = session.messages
    .filter((m) => m.role === 'assistant' && m.content.trim().length > 20)
    .slice(0, 6)
    .map((m) => `- ${m.content.trim().split('\n')[0].slice(0, 160)}`);
  const recovered = session.messages
    .filter((m) => m.role === 'tool' && /error|failed|exception/i.test(m.content))
    .slice(0, 4)
    .map((m) => `- ${m.content.trim().split('\n')[0].slice(0, 160)}`);
  const files =
    session.filesTouched.length > 0
      ? session.filesTouched.slice(0, 8).map((f) => `- \`${f}\``).join('\n')
      : '- (none recorded)';

  const body = [
    `# ${name}`,
    '',
    `## When to use`,
    `Reuse this guide when facing a situation similar to session ${session.sessionId}`,
    `(${session.startedAt} → ${session.endedAt}): multi-step work with`,
    `${session.toolCalls} tool calls and ${session.errorsRecovered} recovered errors.`,
    '',
    '## Steps that worked',
    ...(keySteps.length ? keySteps : ['- (no assistant steps captured)']),
    '',
    '## Errors recovered along the way',
    ...(recovered.length ? recovered : ['- (none)']),
    '',
    '## Files touched',
    files,
    '',
    '## Notes',
    session.summary?.trim() || 'Auto-generated from a complex session. Refine as needed.',
    '',
  ].join('\n');

  return {
    name,
    description: `Auto-generated reusable guide from complex session ${session.sessionId.slice(0, 8)}`,
    content: body,
    sourceSessionId: session.sessionId,
    complexityScore: scoreSessionComplexity(session),
  };
}

export interface GenerateResult {
  generated: boolean;
  skill?: GeneratedSkill;
  installed?: boolean;
  reason?: string;
}

/**
 * Evaluate a session and, if complex enough, create + safety-gate + install
 * an authored skill. Returns whether something was produced.
 */
export async function generateSkillFromSession(
  session: SessionTranscript,
  options: SessionSkillGeneratorOptions = {},
): Promise<GenerateResult> {
  if (!isComplexSession(session, options)) {
    return { generated: false, reason: 'session not complex enough' };
  }

  const skill = buildSkillDraft(session);
  const gate = safetyGateSkill(skill.content);
  if (!gate.ok) {
    logger.warn('Auto-generated skill rejected by safety gate', {
      name: skill.name,
      reasons: gate.reasons,
    });
    return { generated: false, reason: `safety gate: ${gate.reasons.join('; ')}`, skill };
  }

  const mutator = options.mutator ?? new LiveSkillMutator();
  try {
    mutator.create(
      { name: skill.name, description: skill.description, content: skill.content },
      { overwrite: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to install auto-generated skill', { name: skill.name, error: msg });
    return { generated: true, installed: false, skill, reason: msg };
  }

  try {
    const archive = options.archive ?? new EvolutionaryArchive();
    archive.append({
      proposalId: `session-skill:${skill.sourceSessionId}`,
      kind: 'skill',
      targetScenarioId: skill.sourceSessionId,
      delta: skill.complexityScore,
      scoreAfter: 1,
      appliedRef: skill.name,
    });
  } catch {
    // archive is best-effort
  }

  logger.info('Auto-generated skill from complex session', {
    name: skill.name,
    score: skill.complexityScore,
    toolCalls: session.toolCalls,
  });

  return { generated: true, installed: true, skill };
}

let generatorInstance: {
  generate: (session: SessionTranscript) => Promise<GenerateResult>;
} | null = null;

export function getSessionSkillGenerator(
  options: SessionSkillGeneratorOptions = {},
): { generate: (session: SessionTranscript) => Promise<GenerateResult> } {
  if (!generatorInstance) {
    generatorInstance = {
      generate: (session) => generateSkillFromSession(session, options),
    };
  }
  return generatorInstance;
}

export function resetSessionSkillGenerator(): void {
  generatorInstance = null;
}
