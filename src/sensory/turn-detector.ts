/**
 * Opt-in boundary between buddy-sense/LiveKit and the existing speech reaction.
 *
 * The audio model runs beside the ear (Rust → local Python bridge). The brain
 * only consumes the small, raw-free decision carried with a transcript event.
 * With the flag off, this module does not call a provider and returns no signal.
 */

export const SENSORY_TURN_DETECTOR_ENV = 'CODEBUDDY_SENSORY_TURN_DETECTOR';

export interface TurnDetectorDecisionInput {
  text: string;
  payload: Record<string, unknown>;
}

export interface TurnDetectorDecision {
  endOfTurn: boolean;
  source: string;
  probability?: number;
  threshold?: number;
  inferenceMs?: number;
}

export type TurnDecisionProvider = (
  input: TurnDetectorDecisionInput,
) => TurnDetectorDecision | undefined;

export function isLiveKitTurnDetectorEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[SENSORY_TURN_DETECTOR_ENV]?.trim().toLowerCase() === 'livekit';
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isLiveKitSource(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.includes('livekit') || normalized.includes('turn-detector-v1-mini');
}

/** Read the decision emitted by an optional local sensor service. */
export function readLiveKitTurnDecision(
  text: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): TurnDetectorDecision | undefined {
  if (!isLiveKitTurnDetectorEnabled(env)) return undefined;
  const source = typeof payload.turnDetector === 'string' ? payload.turnDetector : '';
  if (!isLiveKitSource(source)) return undefined;

  const explicit = payload.turnEnded ?? payload.turnComplete;
  const probability = finite(payload.turnProbability);
  const threshold = finite(payload.turnThreshold) ?? 0.285;
  const endOfTurn = typeof explicit === 'boolean'
    ? explicit
    : probability !== undefined
      ? probability >= threshold
      : payload.turnForcedAfterHold === true;
  if (typeof explicit !== 'boolean' && probability === undefined && payload.turnForcedAfterHold !== true) {
    return undefined;
  }
  return {
    endOfTurn,
    source,
    ...(probability !== undefined ? { probability } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
    ...(finite(payload.turnDetectionMs) !== undefined
      ? { inferenceMs: finite(payload.turnDetectionMs) }
      : {}),
  };
}

/**
 * Resolve the optional sensor decision. Provider errors are intentionally
 * fail-open to the existing transcript/heuristic path at the call site.
 */
export function resolveTurnDetectorDecision(
  input: TurnDetectorDecisionInput,
  provider?: TurnDecisionProvider,
  env: NodeJS.ProcessEnv = process.env,
): TurnDetectorDecision | undefined {
  if (!isLiveKitTurnDetectorEnabled(env)) return undefined;
  const provided = provider?.(input);
  return provided ?? readLiveKitTurnDecision(input.text, input.payload, env);
}
