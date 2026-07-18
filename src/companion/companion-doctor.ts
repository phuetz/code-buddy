/**
 * Companion doctor — pure readiness checks for the Lisa voice persona stack.
 *
 * Detects the common footgun: CODEBUDDY_ROBOT_NAME=Lisa while the active persona
 * is a coding profile without a spoken layer (or spokenPrompt is missing entirely).
 * Never throws; consumers format and decide exit code.
 *
 * @module companion/companion-doctor
 */

export type CompanionDoctorSeverity = 'ok' | 'warn' | 'error';

export interface CompanionDoctorCheck {
  id: string;
  label: string;
  severity: CompanionDoctorSeverity;
  detail: string;
  next?: string;
}

export interface CompanionDoctorInput {
  /** Active persona id (e.g. lisa, debugger, default). */
  personaId?: string | null;
  /** Persona display / robot name if any. */
  personaRobotName?: string | null;
  /** Spoken character prompt (empty ⇒ no voice character). */
  spokenPrompt?: string | null;
  /** CODEBUDDY_ROBOT_NAME (or equivalent). */
  robotNameEnv?: string | null;
  /** CODEBUDDY_COMPANION_VOICE_FALLBACK when set. */
  voiceFallbackEnv?: string | null;
  /** Whether spokenPrompt was borrowed from lisa for a non-lisa persona. */
  borrowedLisaSpoken?: boolean;
}

export interface CompanionDoctorReport {
  ok: boolean;
  score: number;
  checks: CompanionDoctorCheck[];
  summary: string;
}

function isLisaName(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'lisa' || v === 'companion-lisa';
}

/**
 * Run persona/voice identity checks. Pure and sync — inject persona state from
 * getActivePersonaVoiceAsync() / env at the CLI boundary.
 */
export function runCompanionDoctor(input: CompanionDoctorInput = {}): CompanionDoctorReport {
  const personaId = (input.personaId ?? '').trim() || 'default';
  const spoken = (input.spokenPrompt ?? '').trim();
  const robotEnv = (input.robotNameEnv ?? process.env.CODEBUDDY_ROBOT_NAME ?? '').trim();
  const fallback = (
    input.voiceFallbackEnv ?? process.env.CODEBUDDY_COMPANION_VOICE_FALLBACK ?? ''
  ).trim();
  const wantsLisa =
    isLisaName(robotEnv) || isLisaName(fallback) || isLisaName(input.personaRobotName);

  const checks: CompanionDoctorCheck[] = [];

  if (wantsLisa && personaId !== 'lisa' && !input.borrowedLisaSpoken) {
    checks.push({
      id: 'persona_mismatch',
      label: 'Persona vs robot name',
      severity: 'error',
      detail:
        `Robot expects Lisa (ROBOT_NAME/fallback="${robotEnv || fallback || input.personaRobotName}") ` +
        `but active persona is "${personaId}" without a Lisa spoken layer.`,
      next: 'Run `buddy persona set lisa` (or pin lisa in sensory boot) so the voice character loads.',
    });
  } else if (wantsLisa && personaId !== 'lisa' && input.borrowedLisaSpoken) {
    checks.push({
      id: 'persona_borrow',
      label: 'Persona vs robot name',
      severity: 'warn',
      detail:
        `Active persona is "${personaId}" but spokenPrompt is borrowed from lisa. ` +
        'Works for voice, but pin persona lisa to avoid debugger/coding profile side-effects.',
      next: 'Prefer `buddy persona set lisa` for a permanent fix.',
    });
  } else if (wantsLisa && personaId === 'lisa') {
    checks.push({
      id: 'persona_match',
      label: 'Persona vs robot name',
      severity: 'ok',
      detail: 'Active persona is lisa and robot name matches the companion identity.',
    });
  } else {
    checks.push({
      id: 'persona_other',
      label: 'Persona vs robot name',
      severity: 'ok',
      detail: `Active persona "${personaId}" (robot="${robotEnv || input.personaRobotName || 'unset'}").`,
    });
  }

  if (!spoken) {
    checks.push({
      id: 'spoken_prompt',
      label: 'Spoken character prompt',
      severity: wantsLisa ? 'error' : 'warn',
      detail: wantsLisa
        ? 'No spokenPrompt on the active voice layer — Lisa will fall back to a generic SPEAK system prompt.'
        : 'No spokenPrompt configured; companion voice character will be generic.',
      next: wantsLisa
        ? 'Set persona lisa (built-in spokenPrompt) or add spokenPrompt to the active persona.'
        : 'Optional: add a spokenPrompt to the active persona for a stable voice character.',
    });
  } else if (spoken.length < 80) {
    checks.push({
      id: 'spoken_prompt',
      label: 'Spoken character prompt',
      severity: 'warn',
      detail: `spokenPrompt is very short (${spoken.length} chars) — character may dilute.`,
      next: 'Use the built-in lisa spokenPrompt or expand the persona voice character.',
    });
  } else {
    checks.push({
      id: 'spoken_prompt',
      label: 'Spoken character prompt',
      severity: 'ok',
      detail: `spokenPrompt present (${spoken.length} chars).`,
    });
  }

  if (personaId === 'lisa' && !robotEnv) {
    checks.push({
      id: 'robot_name_env',
      label: 'CODEBUDDY_ROBOT_NAME',
      severity: 'warn',
      detail:
        'Persona is lisa but CODEBUDDY_ROBOT_NAME is unset — address detection may miss "Lisa".',
      next: 'Set CODEBUDDY_ROBOT_NAME=Lisa in vision.env / lisa.env for reliable wake-by-name.',
    });
  } else if (robotEnv) {
    checks.push({
      id: 'robot_name_env',
      label: 'CODEBUDDY_ROBOT_NAME',
      severity: 'ok',
      detail: `CODEBUDDY_ROBOT_NAME=${robotEnv}`,
    });
  } else {
    checks.push({
      id: 'robot_name_env',
      label: 'CODEBUDDY_ROBOT_NAME',
      severity: 'ok',
      detail: 'CODEBUDDY_ROBOT_NAME unset (non-Lisa persona path).',
    });
  }

  const errors = checks.filter((c) => c.severity === 'error').length;
  const warns = checks.filter((c) => c.severity === 'warn').length;
  const oks = checks.filter((c) => c.severity === 'ok').length;
  const total = checks.length || 1;
  const score = Math.round(((oks + warns * 0.5) / total) * 100);
  const ok = errors === 0;

  const summary = ok
    ? warns > 0
      ? `Companion doctor: OK with ${warns} warning(s) (${score}%).`
      : `Companion doctor: all clear (${score}%).`
    : `Companion doctor: ${errors} error(s), ${warns} warning(s) (${score}%).`;

  return { ok, score, checks, summary };
}

export function formatCompanionDoctorReport(report: CompanionDoctorReport): string {
  const mark = (s: CompanionDoctorSeverity): string =>
    s === 'ok' ? '[ok]' : s === 'warn' ? '[warn]' : '[error]';

  const lines = [
    'Buddy Companion Doctor',
    '='.repeat(50),
    '',
    report.summary,
    `Score: ${report.score}% · overall: ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    'Checks:',
    ...report.checks.map(
      (c) =>
        `${mark(c.severity)} ${c.label}: ${c.detail}${c.next ? `\n       → ${c.next}` : ''}`,
    ),
  ];

  const nexts = report.checks
    .filter((c) => c.severity !== 'ok' && c.next)
    .map((c) => `- ${c.next}`);
  if (nexts.length > 0) {
    lines.push('', 'Next steps:', ...nexts);
  }

  return lines.join('\n');
}

/**
 * Build doctor input from live persona voice + env. Detects lisa spokenPrompt borrow
 * when persona id ≠ lisa but spoken looks like the built-in lisa character.
 */
export function doctorInputFromPersonaVoice(
  voice: {
    personaId?: string;
    robotName?: string;
    spokenPrompt?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): CompanionDoctorInput {
  const personaId = voice.personaId ?? 'default';
  const spoken = voice.spokenPrompt ?? '';
  const borrowedLisaSpoken =
    personaId !== 'lisa' &&
    spoken.length > 200 &&
    /lisa|petite amie|ohwx|exclusive|code.?buddy/i.test(spoken);

  return {
    personaId,
    personaRobotName: voice.robotName,
    spokenPrompt: spoken,
    robotNameEnv: env.CODEBUDDY_ROBOT_NAME,
    voiceFallbackEnv: env.CODEBUDDY_COMPANION_VOICE_FALLBACK,
    borrowedLisaSpoken,
  };
}

/** Live entry point used by CLI / slash commands (never throws). */
export async function runLiveCompanionDoctor(
  getVoice: () => Promise<{
    personaId?: string;
    robotName?: string;
    spokenPrompt?: string;
  }> = async () => {
    const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
    return getActivePersonaVoiceAsync();
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompanionDoctorReport> {
  try {
    const voice = await getVoice();
    return runCompanionDoctor(doctorInputFromPersonaVoice(voice, env));
  } catch (err) {
    return {
      ok: false,
      score: 0,
      summary: `Companion doctor failed: ${err instanceof Error ? err.message : String(err)}`,
      checks: [
        {
          id: 'doctor_crash',
          label: 'Doctor runtime',
          severity: 'error',
          detail: err instanceof Error ? err.message : String(err),
          next: 'Check persona manager init and CODEBUDDY home permissions.',
        },
      ],
    };
  }
}
