/**
 * Semantic vision reaction — turns the HIGH-LEVEL vision events from the Python
 * vision sidecar (`person_entered` / `person_left` / `drowsy`) into a remote
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
import { buildArrivalOpener, buildLlmArrivalOpener, loadArrivalState, saveArrivalState, pushRecent, type ArrivalChat } from './arrival-opener.js';

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
    '🚪 Plus personne dans le champ',
    '🌙 La pièce est de nouveau vide',
    '👋 La personne est partie',
    '🎥 Le champ est vide',
  ],
  drowsy: [
    '😴 Somnolence détectée (yeux fermés)',
    '💤 La personne a l’air de somnoler',
    '😪 Yeux fermés — fatigue détectée',
  ],
};

const lastMsgIdx: Record<string, number> = {};

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
}

export function wireSemanticVisionReaction(options: SemanticVisionOptions = {}): () => void {
  const bus = getGlobalEventBus();
  // Greet an arriving person aloud (opt-in) — the robot stops being a tool that waits and becomes a
  // presence that notices you. Cooldown'd so a person flickering in/out doesn't re-greet.
  const greetEnabled = process.env.CODEBUDDY_SENSORY_GREET === 'true';
  const greetCooldownMs = Number(process.env.CODEBUDDY_SENSORY_GREET_COOLDOWN_MS) || 60_000;
  const now = options.now ?? (() => Date.now());
  let lastGreetAt = Number.NEGATIVE_INFINITY;

  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    // Own-property check (not `in`, and not bracket-access-!==-undefined — both walk the
    // prototype chain): a crafted frame with kind='toString'/'constructor' would otherwise pass
    // and interpolate an inherited Function into the alert/percept.
    if (p.modality !== 'vision' || !p.kind || !Object.prototype.hasOwnProperty.call(CAMERA_MESSAGES, p.kind)) return;
    const kind = p.kind;
    const payload = (p.payload ?? {}) as { imagePath?: string; camera?: string };

    void (async () => {
      try {
        const label = pickCameraMessage(kind);
        const { recordCompanionPercept } = await import('../companion/percepts.js');
        await recordCompanionPercept(
          {
            modality: 'vision',
            source: 'semantic_vision_reaction',
            summary: `${kind} → ${label}`,
            confidence: 0.95,
            payload: { event: kind, imagePath: payload.imagePath, camera: payload.camera },
            tags: ['vision', 'event', kind],
          },
          options.cwd ? { cwd: options.cwd } : {},
        );
        logger.info(`[vision] semantic event → ${kind}`);
        await sendTelegramAlert(`${label}${payload.camera ? ` (${payload.camera})` : ''}`, payload.imagePath);
      } catch (err) {
        logger.warn(`[vision] semantic reaction failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Spoken greeting on arrival (separate guard so a Telegram/percept hiccup never mutes it).
      if (kind === 'person_entered' && greetEnabled) {
        const t = now();
        if (t - lastGreetAt < greetCooldownMs) return;
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
            ...(process.env.CODEBUDDY_USER_NAME ? { name: process.env.CODEBUDDY_USER_NAME } : {}),
          });
          let greeting = opener.text || persona.greeting || 'Bonjour ! Je suis là si tu as besoin.';

          // Natural, non-scripted layer (opt-in CODEBUDDY_SENSORY_GREET_LLM): a fresh
          // LLM line seeded with the recent lines to AVOID + the last things heard so it
          // can reference the conversation. Times out to the instant opener above.
          if (process.env.CODEBUDDY_SENSORY_GREET_LLM === 'true') {
            try {
              let recentHeard: string[] = [];
              try {
                const { readRecentCompanionPercepts } = await import('../companion/percepts.js');
                const heard = await readRecentCompanionPercepts({ modality: 'hearing', limit: 4 });
                recentHeard = heard
                  .map((h) => String((h.payload as { text?: string })?.text ?? h.summary ?? '').replace(/^Heard:\s*/i, ''))
                  .filter(Boolean);
              } catch {
                /* memory context optional */
              }
              const llmLine = await buildLlmArrivalOpener({
                now: t,
                lastSeenAt: state.lastSeenAt ?? null,
                recentTexts: [...(state.recentSpoken ?? []), ...state.recent],
                recentHeard,
                ...(persona.spokenPrompt ? { personaPrompt: persona.spokenPrompt } : {}),
                ...(process.env.CODEBUDDY_USER_NAME ? { name: process.env.CODEBUDDY_USER_NAME } : {}),
                ...(options.llmChat ? { chat: options.llmChat } : {}),
              });
              if (llmLine) greeting = llmLine;
            } catch {
              /* keep the deterministic opener */
            }
          }

          const greet =
            options.greet ??
            (async (text: string) => {
              const { sayNow } = await import('./voice-loop.js');
              await sayNow(text);
            });
          await greet(greeting);
          saveArrivalState({
            lastSeenAt: t,
            recent: pushRecent(state.recent, opener.template),
            recentSpoken: pushRecent(state.recentSpoken ?? [], greeting),
          });
          options.onEngage?.(); // open the conversation window — follow-ups are now treated as addressed
          logger.info(`[vision] greeted arrival (${opener.trigger}) → ${greeting}`);
        } catch (err) {
          logger.warn(`[vision] arrival greeting failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })();
  });
  return () => bus.off(id);
}
