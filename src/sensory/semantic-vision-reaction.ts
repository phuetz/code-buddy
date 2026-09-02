/**
 * Semantic vision reaction — turns the HIGH-LEVEL vision events from the Python
 * vision sidecar (`person_entered` / `person_lost` / `drowsy`) into a remote
 * alert. These are state-machine TRANSITIONS (already deduped at the detector,
 * one per transition), so each is meaningful → always alert, no extra throttling.
 * Opt-in via the same camera gate as the motion reaction. Best-effort, never-throws.
 *
 * @module sensory/semantic-vision-reaction
 */
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';
import { sendTelegramAlert } from './alert.js';
import { getCompanionConductor, type Conductor } from '../companion/orchestrator.js';
import { resolveCurrentHomeInteractionPolicy } from '../companion/home-interaction-policy.js';
import type { HomeModeStore } from '../life-rhythm/home-mode-store.js';
import {
  buildArrivalOpener,
  buildLlmArrivalOpener,
  isConfiguredUserIdentity,
  loadArrivalState,
  saveArrivalState,
  pushRecent,
  type ArrivalChat,
} from './arrival-opener.js';
import {
  safeCameraKeyframePath,
  telegramVisionPhotoPath,
} from './camera-keyframe-policy.js';

/**
 * Human-readable alert POOLS per semantic event kind (extend as detectors are
 * added). A pool, not a single string, so the Telegram notification isn't the
 * exact same phrase every time — `pickCameraMessage` rotates and avoids the
 * consecutive repeat. (The SPOKEN greeting is varied separately by the arrival
 * opener; this is the phone notification.)
 */
export const CAMERA_MESSAGES: Record<string, string[]> = {
  person_entered: [
    "👤 Quelqu'un est entré dans le champ",
    '👀 Présence détectée devant la caméra',
    '🙂 Il y a quelqu’un devant moi',
    '🎥 Un visage vient d’apparaître',
    '✨ Quelqu’un arrive',
  ],
  person_left: [
    '👁️ Ancien signal de sortie reçu — présence à confirmer',
    '🎥 Je ne vois plus la présence ; je ne peux pas confirmer son départ',
    '🌫️ Le suivi visuel est perdu — situation incertaine',
    '👋 La présence est sortie du champ ou masquée',
  ],
  person_lost: [
    '👁️ Je ne vois plus la personne',
    '🎥 La personne est sortie du champ ou masquée',
    '🌫️ Présence visuelle perdue — situation désormais incertaine',
  ],
  drowsy: [
    '😴 Somnolence détectée (yeux fermés)',
    '💤 La personne a l’air de somnoler',
    '😪 Yeux fermés — fatigue détectée',
  ],
};

const lastMsgIdx: Record<string, number> = {};
export const DEFAULT_SENSORY_REGREET_MIN_MS = 300_000;

export function resolveSensoryRegreetMinMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEBUDDY_SENSORY_REGREET_MIN_MS?.trim();
  if (!raw) return DEFAULT_SENSORY_REGREET_MIN_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? Math.min(86_400_000, Math.floor(value))
    : DEFAULT_SENSORY_REGREET_MIN_MS;
}

/** Pick a varied alert caption for `kind`, avoiding the consecutive repeat. Returns `kind` if unknown. */
export function pickCameraMessage(kind: string, rng: () => number = Math.random): string {
  const pool = Object.prototype.hasOwnProperty.call(CAMERA_MESSAGES, kind) ? CAMERA_MESSAGES[kind]! : null;
  if (!pool || pool.length === 0) return kind;
  if (pool.length === 1) return pool[0]!;
  let idx = Math.floor(rng() * pool.length) % pool.length;
  if (idx === lastMsgIdx[kind]) idx = (idx + 1) % pool.length; // never the same caption twice in a row
  lastMsgIdx[kind] = idx;
  return pool[idx]!;
}

export interface SemanticVisionOptions {
  cwd?: string;
  /** Speak the arrival greeting. Default: sayNow (Piper, active persona's voice). Injectable for tests. */
  greet?: (text: string) => Promise<void>;
  /** Called right after a greeting so the conversation window opens (server wires decider.markEngaged). */
  onEngage?: () => void;
  now?: () => number;
  /** LLM chat seam for the opt-in natural opener (injectable for tests; default routes to the voice model). */
  llmChat?: ArrivalChat;
  /** Local identity-presence hook. True only for CODEBUDDY_USER_NAME, compared case-insensitively. */
  onIdentityChange?: (recognizedUserPresent: boolean) => void;
  /** Shared companion speech arbiter; injectable for deterministic tests. */
  conductor?: Conductor;
  /** Household posture store; injectable to isolate callers and tests. */
  homeModeStore?: HomeModeStore;
}

export function wireSemanticVisionReaction(options: SemanticVisionOptions = {}): () => void {
  const bus = getGlobalEventBus();
  // Greet an arriving person aloud (opt-in) — the robot stops being a tool that waits and becomes a
  // presence that notices you. Cooldown'd so a person flickering in/out doesn't re-greet.
  const greetEnabled = process.env.CODEBUDDY_SENSORY_GREET === 'true';
  const greetCooldownMs = Number(process.env.CODEBUDDY_SENSORY_GREET_COOLDOWN_MS) || 60_000;
  const regreetMinMs = resolveSensoryRegreetMinMs();
  const now = options.now ?? (() => Date.now());
  const conductor = options.conductor ?? getCompanionConductor();
  let lastGreetAt = Number.NEGATIVE_INFINITY;
  let awaitingIdentityGreeting = false;
  let recognizedUserPresent = false;
  let lastLossAt = Number.NEGATIVE_INFINITY;
  let suppressCurrentArrivalGreeting = false;

  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    // Own-property check (not `in`, and not bracket-access-!==-undefined — both walk the
    // prototype chain): a crafted frame with kind='toString'/'constructor' would otherwise pass
    // and interpolate an inherited Function into the alert/percept.
    const identityEvent = p.kind === 'person_identified';
    if (
      p.modality !== 'vision' ||
      !p.kind ||
      (!identityEvent && !Object.prototype.hasOwnProperty.call(CAMERA_MESSAGES, p.kind))
    ) return;
    const kind = p.kind;
    const payload = (p.payload ?? {}) as {
      imagePath?: string;
      camera?: string;
      identityPending?: boolean;
      name?: unknown;
      similarity?: unknown;
    };
    if (kind === 'person_entered') {
      const enteredAt = now();
      suppressCurrentArrivalGreeting = enteredAt - lastLossAt < regreetMinMs;
      if (!suppressCurrentArrivalGreeting) lastLossAt = Number.NEGATIVE_INFINITY;
      recognizedUserPresent = false;
      options.onIdentityChange?.(false);
      awaitingIdentityGreeting = payload.identityPending === true;
    } else if (kind === 'person_lost' || kind === 'person_left') {
      lastLossAt = now();
      recognizedUserPresent = false;
      awaitingIdentityGreeting = false;
      options.onIdentityChange?.(false);
    }
    const identityShouldOpenArrival = identityEvent && awaitingIdentityGreeting;
    if (identityShouldOpenArrival) awaitingIdentityGreeting = false;

    void (async () => {
      let arrivalName = kind === 'person_entered'
        ? process.env.CODEBUDDY_USER_NAME?.trim()
        : undefined;
      let recognizedArrival = !identityEvent;
      if (identityEvent) {
        const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
        const safeName = rawName &&
          rawName.length <= 100 &&
          // eslint-disable-next-line no-control-regex -- identity input must reject C0/C1 controls
          !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(rawName)
          ? rawName
          : 'unknown';
        const unknown = safeName.toLocaleLowerCase() === 'unknown';
        const similarity = typeof payload.similarity === 'number' &&
          Number.isFinite(payload.similarity)
          ? Math.max(-1, Math.min(1, payload.similarity))
          : undefined;
        recognizedArrival = !unknown && isConfiguredUserIdentity(safeName);
        recognizedUserPresent = recognizedArrival;
        options.onIdentityChange?.(recognizedUserPresent);
        arrivalName = recognizedArrival
          ? process.env.CODEBUDDY_USER_NAME?.trim()
          : undefined;
        try {
          const { recordCompanionPercept } = await import('../companion/percepts.js');
          await recordCompanionPercept(
            {
              modality: 'vision',
              source: 'semantic_vision_reaction',
              summary: unknown ? 'personne inconnue' : `${safeName} est là`,
              confidence: similarity ?? (unknown ? 0 : 1),
              payload: {
                event: kind,
                name: safeName,
                ...(similarity !== undefined ? { similarity } : {}),
                camera: payload.camera,
                recognizedUser: recognizedArrival,
              },
              tags: ['vision', 'identity', recognizedArrival ? 'configured-user' : 'other'],
            },
            options.cwd ? { cwd: options.cwd } : {},
          );
          logger.info(
            `[vision] local identity percept → ${unknown ? 'unknown' : safeName}`,
          );
        } catch (err) {
          logger.warn(`[vision] identity percept failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        try {
          const label = pickCameraMessage(kind);
          const frame = await safeCameraKeyframePath(payload.imagePath);
          const { recordCompanionPercept } = await import('../companion/percepts.js');
          await recordCompanionPercept(
            {
              modality: 'vision',
              source: 'semantic_vision_reaction',
              summary: `${kind} → ${label}`,
              confidence: 0.95,
              payload: { event: kind, imagePath: frame, camera: payload.camera },
              tags: ['vision', 'event', kind],
            },
            options.cwd ? { cwd: options.cwd } : {},
          );
          logger.info(`[vision] semantic event → ${kind}`);
          await sendTelegramAlert(
            `${label}${payload.camera ? ' (caméra locale)' : ''}`,
            telegramVisionPhotoPath(frame),
          );
        } catch (err) {
          logger.warn(`[vision] semantic reaction failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Spoken greeting on arrival (separate guard so a Telegram/percept hiccup never mutes it).
      const greetFromAnonymousArrival =
        kind === 'person_entered' && payload.identityPending !== true;
      const greetFromIdentity = identityShouldOpenArrival;
      if (
        (greetFromAnonymousArrival || greetFromIdentity)
        && greetEnabled
        && !suppressCurrentArrivalGreeting
      ) {
        const t = now();
        if (t - lastGreetAt < greetCooldownMs) return;
        const homePolicy = await resolveCurrentHomeInteractionPolicy('arrival', {
          ...(options.homeModeStore ? { homeModeStore: options.homeModeStore } : {}),
        });
        if (!homePolicy.allowed) {
          logger.info(`[vision] arrival greeting skipped by home policy: ${homePolicy.reason}`);
          return;
        }
        if (!conductor.claim('arrival')) {
          logger.info('[vision] arrival greeting skipped: conductor gap');
          return;
        }
        lastGreetAt = t;
        try {
          const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
          const persona = await getActivePersonaVoiceAsync();
          // Varied, context-aware opener (time of day / gap since last seen) with anti-repetition,
          // instead of the single fixed persona.greeting that made it say the same line every time.
          const state = loadArrivalState();
          const opener = buildArrivalOpener({
            now: t,
            lastSeenAt: state.lastSeenAt ?? null,
            recent: state.recent,
            ...(arrivalName ? { name: arrivalName } : {}),
            recognizedUser: recognizedArrival,
          });
          let greeting = opener.text || persona.greeting || 'Bonjour ! Je suis là si tu as besoin.';

          // Natural, non-scripted layer (opt-in CODEBUDDY_SENSORY_GREET_LLM): a fresh
          // LLM line seeded with the recent lines to AVOID + the last things heard so it
          // can reference the conversation. Times out to the instant opener above.
          if (process.env.CODEBUDDY_SENSORY_GREET_LLM === 'true') {
            try {
              let recentHeard: string[] = [];
              try {
                const { readRecentDialogueHearing } = await import(
                  '../companion/dialogue-percepts.js'
                );
                recentHeard = (await readRecentDialogueHearing(4, options.cwd)).reverse();
              } catch {
                /* memory context optional */
              }
              // Relational context (opt-in): accepted facts about him + Lisa's mood + presence, so the
              // opener can reference the relationship, not just the last things heard. The env gate is
              // checked BEFORE the dynamic import so the (heavy) user-model graph is never loaded when
              // the feature is off — keeps the default path import-free and fast. Best-effort.
              let relationalContext = '';
              if (process.env.CODEBUDDY_COMPANION_RELATIONAL === 'true') {
                try {
                  const { buildRelationalContext } = await import('../companion/relational-context.js');
                  relationalContext = await buildRelationalContext(options.cwd ? { cwd: options.cwd } : {});
                } catch {
                  /* relational context optional */
                }
              }
              const llmLine = await buildLlmArrivalOpener({
                now: t,
                lastSeenAt: state.lastSeenAt ?? null,
                recentTexts: [...(state.recentSpoken ?? []), ...state.recent],
                recentHeard,
                ...(persona.spokenPrompt ? { personaPrompt: persona.spokenPrompt } : {}),
                ...(relationalContext ? { relationalContext } : {}),
                ...(arrivalName ? { name: arrivalName } : {}),
                ...(options.llmChat ? { chat: options.llmChat } : {}),
              });
              if (llmLine) greeting = llmLine;
            } catch {
              /* keep the deterministic opener */
            }
          }

          const { guardRelationshipReply } = await import(
            '../conversation/relationship-safety.js'
          );
          const safeGreeting = guardRelationshipReply(greeting).response;
          const greet =
            options.greet ??
            (async (text: string) => {
              const [{ sayNow }, { speakCanonicalVoiceInitiative }] = await Promise.all([
                import('./voice-loop.js'),
                import('../conversation/voice-continuity.js'),
              ]);
              await speakCanonicalVoiceInitiative(
                text,
                (content) => sayNow(content, { phoneDelivery: 'never' }),
              );
            });
          await greet(safeGreeting);
          saveArrivalState({
            lastSeenAt: t,
            recent: pushRecent(state.recent, opener.template),
            recentSpoken: pushRecent(state.recentSpoken ?? [], safeGreeting),
          });
          options.onEngage?.(); // open the conversation window — follow-ups are now treated as addressed
          logger.info(`[vision] greeted arrival (${opener.trigger}) → ${safeGreeting}`);
        } catch (err) {
          logger.warn(`[vision] arrival greeting failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })();
  });
  return () => bus.off(id);
}
