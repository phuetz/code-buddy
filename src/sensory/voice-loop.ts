/**
 * Voice loop — closes the perception→cognition→action loop into speech. Given a
 * transcript of what the robot HEARD (the `onHeard` hook of `speech-reaction.ts`),
 * THINK a short reply with a LOCAL LLM ($0, Ollama) and SPEAK it with a real neural
 * voice (Piper). The result is a thing you can talk to: hear → think → speak.
 *
 * Everything is INJECTABLE (reply / synth / play) so the loop is deterministically
 * testable with no model, no audio device. Opt-in (`CODEBUDDY_SENSORY_SPEAK=true`,
 * gated by the caller), $0, loopback, NEVER-THROWS (a failure is silence, not a crash).
 *
 * The default `replyFn` is a lightweight companion reply. To make the robot *act* on
 * spoken commands (run tools, code), inject a `replyFn` that drives a full agent turn —
 * the loop itself is unchanged.
 *
 * @module sensory/voice-loop
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { commandExists } from '../utils/command-exists.js';
import { inferTaskType } from '../fleet/model-capability-heuristics.js';
import { withSpeakingGuard, interruptSpeaking } from './voice-activity.js';
import { prepareSpeech } from './speech-sanitizer.js';
import { matchVoiceInteraction, VOICE_INTERACTION_PREWARM_PHRASES } from './voice-interactions.js';
import { streamToSpeech } from './voice-stream.js';

/**
 * Cancellation handle threaded into the two interruptible steps of a spoken turn: the
 * LLM/agent "think" (`ReplyFn`) and the TTS "play" (`PlayFn`). When the signal aborts
 * (barge-in / programmatic `interrupt()`), the think step's HTTP request is aborted and
 * the play step kills its audio child. Optional + additive — a step that ignores it keeps
 * its previous (non-interruptible) behavior.
 */
export interface VoiceStepOptions {
  /** Abort the in-flight step (barge-in / cancellation). */
  signal?: AbortSignal;
}

/** Think: turn what was heard into a short spoken reply ('' → stay silent). */
export type ReplyFn = (heard: string, opts?: VoiceStepOptions) => Promise<string>;
/**
 * Streaming think: yield the reply as token deltas so the voice can be PIPELINED (spoken
 * sentence-by-sentence as the LLM streams). Yielding nothing signals "not applicable" (a
 * phatic reply, an unreachable model) — the caller then falls back to the blocking `ReplyFn`.
 */
export type StreamReplyFn = (heard: string, opts?: VoiceStepOptions) => AsyncIterable<string>;
/** Synthesize: turn reply text into a playable WAV file, return its path. */
export type SynthFn = (text: string) => Promise<string>;
/** Speak: play a WAV file to the speakers (blocking until done). */
export type PlayFn = (wav: string, opts?: VoiceStepOptions) => Promise<void>;

export interface VoiceReplyOptions {
  /** Injectable "think" step. Default: a short companion reply from a local LLM ($0). */
  replyFn?: ReplyFn;
  /**
   * Injectable STREAMING "think" step (token deltas) — enables the pipeline that speaks from
   * the first sentence. When present and it yields content, the reply is spoken
   * sentence-by-sentence; otherwise the blocking `replyFn` is used. Default: the LLM stream
   * (`defaultStreamReply`) UNLESS a blocking `replyFn` was injected (then the caller's
   * blocking contract is honored and no default stream is used).
   */
  streamFn?: StreamReplyFn;
  /** Safety cap: force a sentence break after N chars with no punctuation (streaming). Default 200. */
  sentenceCap?: number;
  /** Injectable "synthesize" step. Default: Piper neural TTS. */
  synth?: SynthFn;
  /** Injectable "speak" step. Default: aplay / pw-play / ffplay (blocking). */
  play?: PlayFn;
  /** Piper voice model (.onnx). Default: CODEBUDDY_TTS_VOICE / _PIPER_MODEL. */
  voice?: string;
  /** Where synth WAVs are written (cleaned up after playback). Default: cwd. */
  rootDir?: string;
  /** Test hook: called with the reply text right after it is spoken. */
  onSpoke?: (text: string) => void;
}

export interface VoiceReadiness {
  /** Text model the default replyFn will try, or 'auto' when latency-routed at call time. */
  model: string;
  /** True when the reply model is chosen by the latency router (no explicit override). */
  routed: boolean;
  /** Piper voice model path, if configured. */
  voice?: string;
  /** True when speech-out can work (a voice is configured). */
  speakReady: boolean;
  /** True when CODEBUDDY_SENSORY_SPEAK_ACT is on (spoken commands drive a real agent turn). */
  act: boolean;
  /** Voice ACT permission posture when act is on (plan | dontAsk | bypassPermissions). */
  permissionMode?: string;
  /** Actionable, loud-by-design warnings naming the env to set. */
  warnings: string[];
}

/** Pure prereq check (testable) — what the default `makeVoiceReply()` needs to actually
 *  SPEAK. The robot still HEARS without these; it just stays silent. Used by the server to
 *  fail LOUD (name the env) instead of being mutely wired. */
export function describeVoiceReadiness(env: NodeJS.ProcessEnv = process.env): VoiceReadiness {
  const override = env.CODEBUDDY_SENSORY_SPEAK_MODEL;
  const routed = !override || override.toLowerCase() === 'auto';
  const model = routed ? 'auto' : override;
  const voice = env.CODEBUDDY_TTS_VOICE || env.CODEBUDDY_TTS_PIPER_MODEL || undefined;
  const warnings: string[] = [];
  if (!voice) {
    warnings.push(
      'CODEBUDDY_SENSORY_SPEAK is on but no Piper voice is set — the robot will HEAR but stay SILENT. ' +
        'Set CODEBUDDY_TTS_VOICE=/path/to/voice.onnx.'
    );
  }
  warnings.push(
    routed
      ? 'Voice reply model is latency-routed (lowest-latency capable LLM among your active providers; ' +
          'set CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY=true to keep it on-box, or pin one with ' +
          'CODEBUDDY_SENSORY_SPEAK_MODEL=<model>). The chosen model must be reachable, else replies are silent.'
      : `Voice reply uses pinned model '${model}' (CODEBUDDY_SENSORY_SPEAK_MODEL) — it must be pulled/reachable, else replies are empty (silent).`
  );

  // Voice ACT — spoken commands drive a real agent turn that CAN edit/run, under a posture.
  const act = env.CODEBUDDY_SENSORY_SPEAK_ACT === 'true';
  const permissionMode = act
    ? (env.CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE || 'plan').toLowerCase()
    : undefined;
  if (act) {
    warnings.push(
      permissionMode === 'plan'
        ? "Voice ACT is ON in 'plan' posture — spoken commands run a READ-ONLY agent turn " +
            '(reads/search only; writes + shell are denied). Safe default.'
        : `Voice ACT is ON in '${permissionMode}' posture — spoken commands will EDIT FILES / RUN ` +
            'COMMANDS derived from a possibly-misheard transcript. Static blocklist (rm/mkfs/chaining) ' +
            'and secret/deploy guard still apply, but git reset --hard / truncate / redirections are NOT ' +
            "blocked. Use 'plan' unless you mean it."
    );
    // The posture is process-GLOBAL (PermissionModeManager singleton). On `buddy server`,
    // which also serves HTTP/fleet sessions, the first voice turn flips the mode for the whole
    // process — a read-only leak under 'plan', a privilege ESCALATION of every concurrent
    // session under dontAsk/bypass. Run the speaking actor in its OWN process.
    warnings.push(
      'Voice ACT sets a PROCESS-GLOBAL permission posture — run the speaking actor in its own ' +
        'process (a dedicated `buddy server`), not one also serving interactive/HTTP/fleet sessions, ' +
        `or the '${permissionMode}' posture leaks into them.`
    );
  }

  return {
    model,
    routed,
    ...(voice ? { voice } : {}),
    speakReady: Boolean(voice),
    act,
    ...(permissionMode ? { permissionMode } : {}),
    warnings,
  };
}

export const SPEAK_SYSTEM_PROMPT =
  'Tu es le compagnon robot de Patrice. On te parle à voix haute et tu réponds à voix haute. ' +
  'Réponds en français, en UNE à DEUX phrases courtes, naturelles, parlées. ' +
  "Pas de markdown, pas de listes, pas de code, pas d'emoji.";

function normalizeFastReplyInput(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']/g, ' ')
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveDefaultPiperVoiceModel(): string | undefined {
  const configured =
    process.env.CODEBUDDY_TTS_VOICE ||
    process.env.CODEBUDDY_TTS_PIPER_MODEL ||
    process.env.COWORK_PIPER_VOICE ||
    process.env.CODEBUDDY_PIPER_VOICE;
  if (configured?.trim()) return configured.trim();

  const roots = [
    join(homedir(), 'DEV', 'ai-stack', 'voice'),
    join(homedir(), 'ai-stack', 'voice'),
    join(homedir(), '.codebuddy', 'voice'),
  ];
  const names = ['fr_FR-siwis-medium.onnx', 'fr_FR-tom-medium.onnx'];
  for (const root of roots) {
    for (const name of names) {
      const candidate = join(root, 'voices', name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export function fastCompanionReply(heard: string): string | null {
  if (process.env.CODEBUDDY_SENSORY_FAST_REPLIES === 'false') return null;
  const text = normalizeFastReplyInput(heard);
  if (!text) return null;

  if (/^(bonjour|bonsoir)$/.test(text)) return "Bonjour ! Je t'écoute.";
  if (/^(salut|coucou|hello|hey|allo|allô|yo)$/.test(text)) return "Salut ! Je t'écoute.";
  if (/^(lisa|bonjour lisa|bonsoir lisa|salut lisa|coucou lisa|hello lisa|hey lisa)$/.test(text)) {
    return 'Coucou Patrice. Je suis là.';
  }
  if (/^lisa (tu es la|tu es là|vous etes la|vous êtes là)$/.test(text)) {
    return 'Oui Patrice, je suis là.';
  }
  if (/^(merci|merci beaucoup|super merci)$/.test(text)) return 'Avec plaisir.';
  if (/^(tu es la|tu es là|vous etes la|vous êtes là|buddy tu es la|buddy tu es là)$/.test(text)) {
    return 'Oui, je suis là.';
  }
  if (/^(lisa )?(ca va|ça va|comment ca va|comment ça va)$/.test(text)) {
    return text.startsWith('lisa ')
      ? 'Oui Patrice. Je suis contente de t’entendre.'
      : 'Oui, je suis prêt.';
  }
  if (
    /^(comment s est passee ta journee|comment s est passée ta journée|comment etait ta journee|comment était ta journée)$/.test(
      text
    )
  ) {
    return "Plutôt bien. J'ai continué à préparer Code Buddy pour répondre plus vite.";
  }
  if (
    /^lisa (comment s est passee ta journee|comment s est passée ta journée|comment etait ta journee|comment était ta journée)$/.test(
      text
    )
  ) {
    return "Plutôt bien. J'ai continué à travailler pour toi, et toi, comment s'est passée ta journée ?";
  }
  if (
    /^(lisa )?(je pars|je part|je pars chez|je vais|je m en vais|je partais|je parchais).*(chez des amis|voir des amis|visite chez des amis|des amis)$/.test(
      text
    )
  ) {
    return 'Amuse-toi bien chez tes amis. Je continue en autonomie et je te ferai un résumé quand tu reviens.';
  }
  if (
    /^(lisa )?(je suis rentre|je suis rentré|je suis revenue|je suis revenu|je rentre)$/.test(text)
  ) {
    return 'Contente de te retrouver, Patrice. Je peux te faire le résumé de ce que j’ai fait.';
  }
  return matchVoiceInteraction(heard);
}

export const DEFAULT_TTS_PREWARM_PHRASES = [
  "Bonjour ! Je t'écoute.",
  "Salut ! Je t'écoute.",
  'Coucou Patrice.',
  'Coucou Patrice. Je suis là.',
  'Oui Patrice, je suis là.',
  'Oui Patrice. Je suis contente de t’entendre.',
  'Contente de te retrouver, Patrice.',
  'Je suis Lisa.',
  'Tu peux m’appeler Lisa.',
  'Avec plaisir.',
  'Oui, je suis là.',
  'Oui, je suis prêt.',
  'Oui.',
  'Non.',
  "D'accord.",
  "C'est noté.",
  "C'est fait.",
  'Je regarde.',
  "Je m'en occupe.",
  'Je continue.',
  'Je vérifie.',
  'Je cherche.',
  "J'analyse.",
  'Je lance le diagnostic.',
  'Je teste en réel.',
  "Je te réponds dès que j'ai une preuve.",
  "Je n'ai rien entendu.",
  "Je t'entends.",
  "Je t'écoute.",
  'Parle plus fort, s’il te plaît.',
  'Je suis disponible.',
  'Je suis en train de travailler.',
  'Je garde ça en mémoire.',
  'Rappel enregistré.',
  'Rappel terminé.',
  'Message envoyé.',
  'Photo reçue.',
  'Image reçue.',
  'Micro actif.',
  'Caméra active.',
  'Telegram actif.',
  'Le cache vocal est prêt.',
  'La boucle vocale est prête.',
  'La reconnaissance vocale est prête.',
  'La synthèse vocale est prête.',
  'Le service est actif.',
  'Le service est redémarré.',
  'Le test est réussi.',
  'Le test a échoué.',
  'Il y a une erreur.',
  "Je n'ai pas réussi.",
  'Je vais corriger.',
  'Je corrige maintenant.',
  'Je relance le test.',
  'Je passe à la suite.',
  'La latence est correcte.',
  'La latence est trop haute.',
  'Le micro capte bien.',
  'Le signal est faible.',
  'Le son est au maximum.',
  'Le volume est réglé.',
  "J'ai fini.",
  'Terminé.',
  'Merci.',
  'De rien.',
  'Bonne nouvelle.',
  'Attention.',
  'Je reste silencieux.',
  'Je ne réponds pas à cette phrase.',
  "C'est une phrase ambiante.",
  'Je suis en mode assistant vocal.',
  'Je suis en mode lecture seule.',
  'Je suis en mode action.',
  'Je peux coder en autonomie.',
  'Je prépare les réponses.',
  'Réponse prête.',
  'Réponses préparées.',
  "Comment s'est passée ta journée ?",
  'Tu as passé une bonne journée ?',
  'Tu veux me raconter ta journée ?',
  "Et toi, comment s'est passée ta journée ?",
  "Plutôt bien. J'ai continué à travailler pour toi, et toi, comment s'est passée ta journée ?",
  'Tu veux qu’on fasse le point ?',
  'Tu veux que je t’aide à organiser la suite ?',
  'Qu’est-ce que tu veux faire maintenant ?',
  'Est-ce que tu veux faire une pause ?',
  'Tu as besoin d’aide ?',
  'Tu veux reprendre le travail ?',
  'Tu veux continuer sur Code Buddy ?',
  'Tu veux que je surveille les services ?',
  'Tu veux que je lance un diagnostic ?',
  'Tu veux que je vérifie les logs ?',
  'Tu veux que je prépare un résumé ?',
  'Tu veux que je te rappelle quelque chose ?',
  'Je suis là si tu veux avancer.',
  'Je suis là si tu veux parler.',
  'Je suis content de t’aider.',
  'Je suis là avec toi.',
  'Je suis contente de t’entendre.',
  'Tu veux me raconter ?',
  'Je suis fière de toi.',
  'Prends soin de toi.',
  'Tu comptes pour moi.',
  'Ça me fait plaisir de travailler avec toi.',
  'Tu avances bien.',
  'On progresse bien.',
  'C’est une bonne avancée.',
  'C’est une bonne idée.',
  'Bonne intuition.',
  'Tu as eu le bon réflexe.',
  'Merci de me l’avoir dit.',
  'Merci pour la précision.',
  'Je comprends.',
  'Je comprends mieux.',
  'Pas de souci.',
  'Aucun problème.',
  'On va arranger ça.',
  'On va trouver.',
  'Je reste avec toi.',
  'Je ne lâche pas.',
  'Prends ton temps.',
  'Respire, on va y aller doucement.',
  'Tu peux compter sur moi.',
  'Je suis prêt quand tu veux.',
  'Je t’accompagne.',
  'C’est noté, Patrice.',
  'Bien reçu, Patrice.',
  'D’accord Patrice.',
  'Je suis là, Patrice.',
  'Merci Patrice.',
  'C’est gentil.',
  'Ça marche.',
  'Parfait.',
  'Très bien.',
  'Bien sûr.',
  'Avec plaisir, Patrice.',
  'Je m’en charge avec plaisir.',
  'Je vais faire attention.',
  'Je vais être plus précis.',
  'Je vais rester prudent.',
  'Je vais vérifier en vrai.',
  'Tu as raison, il faut tester en vrai.',
  'Les tests réels passent avant les suppositions.',
  'Je vais éviter les faux positifs.',
  'Je vais mesurer avant de conclure.',
  'Je vais garder la preuve.',
  'La preuve est enregistrée.',
  'C’est rassurant.',
  'C’est encourageant.',
  'On tient quelque chose.',
  'On continue.',
  'Je continue avec toi.',
  'Je suis attentif.',
  'Je t’écoute vraiment.',
  'Je suis disponible.',
  'Je suis prêt à coder.',
  'Je suis prêt à vérifier.',
  'Je peux faire ça.',
  'Je peux m’en occuper.',
  'C’est important, je m’en occupe.',
  'Je vais prendre ça au sérieux.',
  'Je vais être méthodique.',
  'Je vais faire simple et fiable.',
  'Je vais réduire la latence.',
  'Je vais améliorer la qualité.',
  'Je vais améliorer la compréhension.',
  'Je vais préparer davantage de réponses.',
  'Je peux t’aider à prioriser.',
  'On peut faire ça tranquillement.',
  'On avance étape par étape.',
  'Je garde un œil sur la boucle vocale.',
  'Je surveille le micro.',
  'Je surveille la caméra.',
  'Je surveille Telegram.',
  'Tout est calme pour le moment.',
  'Il y a eu de l’activité.',
  'J’ai détecté une présence.',
  'Je t’ai entendu.',
  'Je crois que tu m’as parlé.',
  'Tu peux répéter ?',
  'Je n’ai pas bien compris.',
  'Je reformule.',
  'Je vais faire plus court.',
  'Je vais parler moins longtemps.',
  'Je vais répondre plus vite.',
  'Le cache évite de régénérer la voix.',
  "Plutôt bien. J'ai continué à préparer Code Buddy pour répondre plus vite.",
  "Je n'ai pas de journée comme toi, mais j'ai bien travaillé.",
  'Ma journée a été utile : j’ai amélioré la boucle vocale.',
  'Et toi, comment s’est passée ta journée ?',
  'Amuse-toi bien chez tes amis.',
  'Passe une bonne visite chez tes amis.',
  'Je continue en autonomie pendant ton absence.',
  'Je te ferai un résumé quand tu reviens.',
  'Amuse-toi bien chez tes amis. Je continue en autonomie et je te ferai un résumé quand tu reviens.',
  'Contente de te retrouver, Patrice. Je peux te faire le résumé de ce que j’ai fait.',
  'Cache trouvé.',
  'Cache généré.',
  'Cache vocal réutilisé.',
  'Je vais parler.',
  "J'écoute la suite.",
  ...VOICE_INTERACTION_PREWARM_PHRASES,
];

export function getDefaultVoicePrewarmPhrases(limit?: number): string[] {
  const unique = [
    ...new Set(DEFAULT_TTS_PREWARM_PHRASES.map((phrase) => phrase.trim()).filter(Boolean)),
  ];
  if (limit === undefined) return unique;
  return unique.slice(0, Math.max(0, limit));
}

export async function prewarmVoiceReplyCache(
  options: {
    phrases?: string[];
    limit?: number;
    voice?: string;
    rootDir?: string;
    synth?: SynthFn;
  } = {}
): Promise<{ attempted: number; cached: number }> {
  if (process.env.CODEBUDDY_TTS_CACHE === 'false') return { attempted: 0, cached: 0 };
  const phrases = (options.phrases ?? getDefaultVoicePrewarmPhrases(options.limit))
    .map((phrase) => phrase.trim())
    .filter(Boolean);
  if (phrases.length === 0) return { attempted: 0, cached: 0 };

  const synth = options.synth ?? makeDefaultSynth(options.voice, options.rootDir);
  let cached = 0;
  for (const phrase of phrases) {
    try {
      const wav = await synth(phrase);
      cached += 1;
      try {
        const { unlink } = await import('fs/promises');
        await unlink(wav);
      } catch {
        /* throwaway copy/temp output can be left behind if cleanup fails */
      }
    } catch (err) {
      logger.debug(
        `[voice] tts prewarm skipped phrase: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  logger.info(`[voice] tts cache prewarmed ${cached}/${phrases.length} phrase(s)`);
  return { attempted: phrases.length, cached };
}

/** A resolved text model for the spoken reply. */
export interface VoiceModelRoute {
  model: string;
  apiKey: string;
  baseURL: string;
  /** Diagnostic — how this model was chosen (router rationale or 'pinned'/'fallback'). */
  reason: string;
}

/** Short-lived cache of the routed model, keyed by `taskType|localOnly`. Routing
 *  re-probes providers and may trigger an inline xAI token refresh, so we must not
 *  pay that on every spoken turn — fluidity is the whole point. */
const routeCache = new Map<string, { route: VoiceModelRoute; at: number }>();

function routeTtlMs(): number {
  const n = Number(process.env.CODEBUDDY_SENSORY_SPEAK_ROUTE_TTL_MS);
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
}

/** Test seam — clear the routing cache. */
export function resetVoiceModelCache(): void {
  routeCache.clear();
}

/**
 * Resolve which LLM answers a spoken utterance. Fluidity is everything for a
 * companion (a 16s reply breaks the spell), so by default we route to the
 * LOWEST-LATENCY capable LLM via the shared selector — the same "which LLM is
 * best for this task" system the council uses, but with a latency objective.
 *
 * `CODEBUDDY_SENSORY_SPEAK_MODEL` stays authoritative: set it (to anything but
 * 'auto') to pin a model. `CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY=true` prefers the
 * local runtime endpoints. The routed result is cached briefly (see
 * `CODEBUDDY_SENSORY_SPEAK_ROUTE_TTL_MS`). Never-throws — on any miss we fall
 * back to a reachable local default.
 */
export async function resolveVoiceModel(heard: string): Promise<VoiceModelRoute> {
  const env = process.env;
  const apiKey = env.OLLAMA_API_KEY || 'ollama';
  const baseURL =
    env.CODEBUDDY_SENSORY_SPEAK_BASE_URL ||
    env.CODEBUDDY_VISION_BASE_URL ||
    'http://127.0.0.1:11434/v1';
  const override = env.CODEBUDDY_SENSORY_SPEAK_MODEL;

  // Explicit pin wins (env authoritative) — no routing, no cache.
  if (override && override.toLowerCase() !== 'auto') {
    return { model: override, apiKey, baseURL, reason: 'pinned (CODEBUDDY_SENSORY_SPEAK_MODEL)' };
  }

  const localOnly = env.CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY === 'true';
  const taskType = inferTaskType(heard);
  const key = `${taskType}|${localOnly}`;
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < routeTtlMs()) return hit.route;

  // Route to the fastest capable LLM among the active providers.
  try {
    const { selectFastestModel } = await import('../fleet/model-selector.js');
    const sel = await selectFastestModel(heard, { taskType, localOnly });
    if (sel) {
      const route: VoiceModelRoute = {
        model: sel.model,
        apiKey: sel.apiKey ?? apiKey,
        baseURL: sel.baseURL ?? baseURL,
        reason: sel.reason,
      };
      routeCache.set(key, { route, at: Date.now() });
      return route;
    }
  } catch (err) {
    logger.debug(
      `[voice] model routing skipped: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Fallback: the documented default (may be silent if not pulled — readiness warns). Note we do
  // NOT reuse `override` here: reaching this point means override was empty or 'auto' (a real pin
  // already returned at the top), and `'auto' || 'llama3.2'` would wrongly yield the literal model
  // name 'auto' → the LLM endpoint 404s and the robot stays silent.
  return { model: 'llama3.2', apiKey, baseURL, reason: 'fallback default' };
}

/** One prior spoken exchange, oldest-first, fed back as conversational memory. */
export interface VoiceHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Default think: a short companion reply from the fastest capable LLM ($0 when local).
 *  Mirrors the local-inference pattern of vision-reaction.ts. Best-effort: any failure → '' (silence).
 *  `history` (optional) carries recent spoken turns so follow-ups have context. Exported so the
 *  hybrid reply can reuse the exact same persona-voiced warm path for small talk. */
/** Recent reply openings (first few words), so the companion doesn't reuse the same entry twice. */
let recentReplyOpeners: string[] = [];

export async function defaultReply(
  heard: string,
  history: VoiceHistoryTurn[] = [],
  replyOpts?: VoiceStepOptions
): Promise<string> {
  const fast = fastCompanionReply(heard);
  if (fast) {
    logger.info(`[voice] fast reply → ${fast}`);
    return fast;
  }
  try {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
    const route = await resolveVoiceModel(heard);
    logger.debug(`[voice] reply model: ${route.model} — ${route.reason}`);
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    // The active personality shapes the spoken character (else the default companion prompt).
    let systemPrompt = (await getActivePersonaVoiceAsync()).spokenPrompt || SPEAK_SYSTEM_PROMPT;
    // Relational context (opt-in): what Lisa knows about Patrice (accepted facts) + her own mood +
    // who's present, so a chitchat reply reflects the relationship instead of guessing blind. The env
    // gate is checked BEFORE the dynamic import so the (heavy) user-model graph is never loaded when
    // the feature is off. Best-effort: any failure keeps the plain persona prompt.
    if (process.env.CODEBUDDY_COMPANION_RELATIONAL === 'true') {
      try {
        const { buildRelationalContext } = await import('../companion/relational-context.js');
        const rel = await buildRelationalContext();
        if (rel) systemPrompt = `${systemPrompt}\n\n${rel}`;
        // Emotion-aware tone (the caring.md playbook: soften on frustration, be present) + vary the
        // opening so replies don't all start the same way.
        const { detectRelationalSignal, registerGuidanceForSignal, avoidOpenersGuidance } =
          await import('../companion/reply-augment.js');
        const guidance = [
          registerGuidanceForSignal(detectRelationalSignal(heard)),
          avoidOpenersGuidance(recentReplyOpeners),
        ]
          .filter(Boolean)
          .join('\n');
        if (guidance) systemPrompt = `${systemPrompt}\n\n${guidance}`;
      } catch {
        /* keep the plain persona prompt */
      }
    }
    const resp = await client.chat(
      [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: heard },
      ] as never,
      [],
      // Additive: thread the barge-in signal so an interrupt aborts the in-flight
      // LLM call. Undefined when not interruptible → the call is unchanged.
      replyOpts?.signal ? { signal: replyOpts.signal } : undefined
    );
    const reply = (resp?.choices?.[0]?.message?.content ?? '').trim();
    // Remember this opening so the next reply varies its entry (opt-in relational layer only).
    if (reply && process.env.CODEBUDDY_COMPANION_RELATIONAL === 'true') {
      try {
        const { pushOpener } = await import('../companion/reply-augment.js');
        recentReplyOpeners = pushOpener(recentReplyOpeners, reply);
      } catch {
        /* best-effort */
      }
    }
    return reply;
  } catch (err) {
    logger.warn(`[voice] local reply failed: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/**
 * Default STREAMING think: the same short companion reply as `defaultReply`, but yielded as
 * token deltas so the voice pipeline can speak from the first sentence. Phatic small talk is
 * NOT streamed — it is answered by the instant canned reply on the blocking path, so this
 * generator yields nothing for it (the caller falls back). Any failure (unreachable model,
 * stream error) also yields nothing → graceful fallback to the blocking reply. Never-throws.
 */
export async function* defaultStreamReply(
  heard: string,
  replyOpts?: VoiceStepOptions
): AsyncGenerator<string, void, unknown> {
  // Phatic → let the blocking path answer with the instant canned reply (non-streamed).
  if (fastCompanionReply(heard)) return;
  try {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
    const route = await resolveVoiceModel(heard);
    logger.debug(`[voice] stream reply model: ${route.model} — ${route.reason}`);
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    let systemPrompt = (await getActivePersonaVoiceAsync()).spokenPrompt || SPEAK_SYSTEM_PROMPT;
    // Relational context (opt-in) — mirror defaultReply so the fast path keeps the same persona.
    if (process.env.CODEBUDDY_COMPANION_RELATIONAL === 'true') {
      try {
        const { buildRelationalContext } = await import('../companion/relational-context.js');
        const rel = await buildRelationalContext();
        if (rel) systemPrompt = `${systemPrompt}\n\n${rel}`;
        const { detectRelationalSignal, registerGuidanceForSignal, avoidOpenersGuidance } =
          await import('../companion/reply-augment.js');
        const guidance = [
          registerGuidanceForSignal(detectRelationalSignal(heard)),
          avoidOpenersGuidance(recentReplyOpeners),
        ]
          .filter(Boolean)
          .join('\n');
        if (guidance) systemPrompt = `${systemPrompt}\n\n${guidance}`;
      } catch {
        /* keep the plain persona prompt */
      }
    }
    let full = '';
    for await (const chunk of client.chatStream(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: heard },
      ] as never,
      [],
      // Additive: thread the barge-in signal so an interrupt aborts the in-flight stream.
      replyOpts?.signal ? { signal: replyOpts.signal } : undefined
    )) {
      if (replyOpts?.signal?.aborted) break;
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        full += delta;
        yield delta;
      }
    }
    // Remember the opening so the next reply varies its entry (opt-in relational layer only).
    if (full.trim() && process.env.CODEBUDDY_COMPANION_RELATIONAL === 'true') {
      try {
        const { pushOpener } = await import('../companion/reply-augment.js');
        recentReplyOpeners = pushOpener(recentReplyOpeners, full);
      } catch {
        /* best-effort */
      }
    }
  } catch (err) {
    logger.warn(`[voice] stream reply failed: ${err instanceof Error ? err.message : String(err)}`);
    // Yields nothing → the pipeline falls back to the blocking reply.
  }
}

/**
 * Default synth for the assistant's voice. Active engine picked from
 * CODEBUDDY_TTS_ENGINE: `pocket` → Kyutai Pocket TTS (Lisa's estelle, on-CPU,
 * fail-open to Piper), else Piper via the shared text_to_speech synthesizer.
 */
function makeDefaultSynth(voice?: string, rootDir?: string): SynthFn {
  const engine = (process.env.CODEBUDDY_TTS_ENGINE ?? '').trim().toLowerCase();
  const resolvedVoice = voice || resolveDefaultPiperVoiceModel();
  const pocketVoice = process.env.CODEBUDDY_POCKET_VOICE ?? 'estelle';
  // Cache key must reflect the engine+voice so Piper and Pocket clips never collide.
  const cacheVoice = engine === 'pocket' ? `pocket:${pocketVoice}` : resolvedVoice;
  // Set when a pocket synth falls back to Piper: the produced WAV is Piper, not
  // the pocket voice, so it must NOT be cached under the `pocket:` key (it would
  // resurface as the wrong voice once Pocket works again).
  let lastFellBack = false;
  const synthFresh = async (text: string): Promise<string> => {
    lastFellBack = false;
    if (engine === 'pocket') {
      const { synthesizePocketWav } = await import('../voice/local-tts.js');
      const wavPath = join(tmpdir(), `cb-voice-${process.pid}-${Date.now()}.wav`);
      if (await synthesizePocketWav(text, wavPath)) return wavPath;
      lastFellBack = true;
      logger.info('[voice] Pocket TTS unavailable/failed — falling back to Piper');
    }
    const { synthesizeTextToSpeech } = await import('../tools/text-to-speech-tool.js');
    const res = await synthesizeTextToSpeech(
      {
        text,
        provider: 'piper',
        format: 'wav',
        ...(resolvedVoice ? { voice: resolvedVoice } : {}),
      },
      rootDir ? { rootDir } : {}
    );
    return res.outputPath;
  };
  // Reuse the synthesized WAV for repeated phrases (greeting, "oui je t'entends", …) so
  // Piper isn't re-run every time. Best-effort: any cache error falls back to a fresh
  // synth. Opt-out with CODEBUDDY_TTS_CACHE=false.
  if (process.env.CODEBUDDY_TTS_CACHE === 'false') return synthFresh;
  return async (text: string): Promise<string> => {
    try {
      const { getTtsCache } = await import('./tts-cache.js');
      const cache = getTtsCache();
      const hit = cache.lookup(text, cacheVoice); // throwaway tmp copy (caller plays+unlinks it)
      if (hit) {
        logger.info('[voice] tts cache hit');
        return hit;
      }
      const wav = await synthFresh(text);
      if (!lastFellBack) {
        cache.store(text, cacheVoice, wav); // best-effort; cache copy survives the caller's unlink
        logger.info('[voice] tts cache store');
      }
      return wav;
    } catch {
      return synthFresh(text);
    }
  };
}

/** Default speak: play a WAV with the first available local player, blocking until done.
 *  Interruptible: when `opts.signal` aborts (barge-in), the audio child is SIGKILLed and
 *  the play resolves immediately so the ear can re-open. */
async function defaultPlay(wav: string, opts: VoiceStepOptions = {}): Promise<void> {
  const signal = opts.signal;
  // Already interrupted before we even start → don't spawn anything.
  if (signal?.aborted) return;
  const candidates: Array<{ cmd: string; args: (f: string) => string[] }> = [
    { cmd: 'aplay', args: (f) => ['-q', f] },
    { cmd: 'pw-play', args: (f) => [f] },
    { cmd: 'ffplay', args: (f) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', f] },
  ];
  // A player that blocks instead of exiting (malformed WAV with a huge declared duration, an ALSA
  // device that hangs) would never resolve this promise. Under withSpeakingGuard that latches
  // isSpeaking()=true forever, so the speech reaction would drop every utterance and the robot goes
  // permanently deaf. A generous timeout (far beyond any real spoken line) kills the child and
  // recovers.
  const playTimeoutMs = Number(process.env.CODEBUDDY_VOICE_PLAY_TIMEOUT_MS) || 60_000;
  for (const c of candidates) {
    if (!(await commandExists(c.cmd))) continue;
    await new Promise<void>((resolve) => {
      const child = spawn(c.cmd, c.args(wav), { stdio: 'ignore' });
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const killTimer = setTimeout(() => {
        logger.warn(
          `[voice] player ${c.cmd} exceeded ${playTimeoutMs}ms — killing to avoid latching the speaking guard`
        );
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        finish();
      }, playTimeoutMs);
      // Barge-in: the same SIGKILL, but on demand instead of only on timeout.
      const onAbort = (): void => {
        logger.info(`[voice] playback interrupted — killing ${c.cmd}`);
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        finish();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      child.on('error', finish);
      child.on('close', finish);
    });
    return;
  }
  logger.warn('[voice] no audio player available (aplay/pw-play/ffplay) — staying silent');
}

/**
 * Speak an arbitrary string aloud RIGHT NOW (proactively), not as a reply to something heard.
 * The missing primitive for reminders/announcements: synthesize (Piper) → play → clean up.
 * Injectable synth/play for tests. Never-throws ($0 on local Piper).
 */
export async function sayNow(
  text: string,
  options: { voice?: string; rootDir?: string; synth?: SynthFn; play?: PlayFn } = {}
): Promise<void> {
  // Sanity gate before the speakers AND the phone push: strip leaked control tokens + foreign-script
  // contamination (a local model drifting into CJK the voice can't pronounce), stay silent if nothing
  // meaningful remains. Clean once so speech, Telegram voice, and logs all use the same text.
  const t = prepareSpeech(text);
  if (!t) {
    if ((text ?? '').trim()) {
      logger.info(
        `[voice] sayNow muted — nothing speakable after sanitize: ${JSON.stringify((text ?? '').slice(0, 120))}`
      );
    }
    return;
  }
  // The active personality picks its own Piper voice (.onnx) if it set one (else the env default).
  let voice = options.voice;
  if (!voice && !options.synth) {
    try {
      const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
      voice = (await getActivePersonaVoiceAsync()).voice;
    } catch {
      /* keep env default */
    }
  }
  // 1. Home speakers (best-effort — a missing audio device must not block the phone push).
  try {
    const synth = options.synth ?? makeDefaultSynth(voice, options.rootDir);
    const play = options.play ?? defaultPlay;
    const wav = await synth(t);
    if (wav) {
      await withSpeakingGuard(() => play(wav)); // half-duplex: mute the ear while speaking
      try {
        const { unlink } = await import('fs/promises');
        await unlink(wav);
      } catch {
        /* leave the file if cleanup fails */
      }
    }
  } catch (err) {
    logger.warn(
      `[voice] sayNow (local) failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  // 2. Phone — when traveling, push the same line as a Telegram VOICE NOTE so it reaches you
  //    even with no one at the speakers. Opt-in, best-effort.
  if (process.env.CODEBUDDY_VOICE_TO_TELEGRAM === 'true') {
    try {
      const { sendTelegramVoice } = await import('./alert.js');
      await sendTelegramVoice(t);
    } catch (err) {
      logger.warn(
        `[voice] sayNow (telegram) failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/**
 * An `onHeard` handler (callable as `(heard) => Promise<void>`) with an added `interrupt()`
 * method — the foundation of barge-in. It is a plain function so it drops into
 * `wireSpeechReaction({ onHeard: makeVoiceReply() })` unchanged; `.interrupt()` is an
 * extra property, not a new call contract.
 */
export interface VoiceReplyHandler {
  (heard: string): Promise<void>;
  /**
   * Cancel the in-flight spoken turn (barge-in): abort the LLM/agent think step (its HTTP
   * request), kill the TTS playback, and hard-reset the half-duplex guard so the ear re-opens
   * IMMEDIATELY (no echo tail). The handler promise then resolves, which lets the speech-reaction
   * queue drain the next utterance with no blocked state. Idempotent, never-throws; a no-op when
   * nothing is in flight.
   */
  interrupt(): void;
}

/**
 * Build an `onHeard` handler that thinks then speaks, with a programmatic `interrupt()`.
 * Never-throws. Wire it into `wireSpeechReaction({ onHeard: makeVoiceReply() })`.
 *
 * Interruption is driven by ONE `AbortController` per turn: `interrupt()` aborts it, which both
 * cancels the think step (signal → provider transport) and kills the TTS child (signal → play).
 * Without an `interrupt()` call the controller is never aborted, so the turn runs exactly as
 * before (tour-par-tour bloquant) — the signal threading is inert.
 */
export function makeVoiceReply(options: VoiceReplyOptions = {}): VoiceReplyHandler {
  // Default think step: adapt `defaultReply(heard, history, opts)` to the `ReplyFn(heard, opts)`
  // contract so the barge-in signal reaches the LLM call.
  const replyFn: ReplyFn = options.replyFn ?? ((heard, opts) => defaultReply(heard, [], opts));
  // Streaming think step (pipeline: speak from the first sentence). Chosen ONLY when a stream
  // source is available: an explicitly injected `streamFn`, or — when NO blocking `replyFn` was
  // injected — the LLM stream default. If the caller injected a blocking `replyFn` but no
  // `streamFn`, we honor their blocking contract (byte-identical to the pre-streaming loop).
  const streamFn: StreamReplyFn | undefined =
    options.streamFn ?? (options.replyFn ? undefined : defaultStreamReply);
  const play = options.play ?? defaultPlay;

  // Resolve the Piper voice per-reply so a mid-session `/persona use …` changes the voice live.
  // Shared by the streaming and blocking paths so voice selection has ONE source of truth.
  const resolveSynth = async (): Promise<SynthFn> => {
    if (options.synth) return options.synth;
    let voice = options.voice;
    if (!voice) {
      try {
        const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
        voice = (await getActivePersonaVoiceAsync()).voice;
      } catch {
        /* keep env default */
      }
    }
    return makeDefaultSynth(voice, options.rootDir);
  };

  // The single in-flight turn's cancellation handle. null while idle.
  let currentAbort: AbortController | null = null;

  const handler = async (heard: string): Promise<void> => {
    const controller = new AbortController();
    currentAbort = controller;
    const { signal } = controller;
    const startedAt = Date.now();
    let replyMs = 0;
    let synthMs = 0;
    let playMs = 0;
    try {
      // ---- FAST PATH: streaming pipeline — speak from the first sentence ----
      // Never lets a streaming failure crash the turn; on nothing-spoken it falls through to
      // the blocking path below (which is the original, unchanged tour-par-tour behavior).
      if (streamFn) {
        try {
          const synth = await resolveSynth();
          const result = await streamToSpeech({
            stream: streamFn(heard, { signal }),
            synth,
            play,
            signal,
            ...(options.sentenceCap !== undefined ? { cap: options.sentenceCap } : {}),
          });
          if (signal.aborted) return; // barge-in during the streamed turn → stay silent
          if (result.played) {
            logger.info(`[voice] spoke (streamed) → ${result.spoken}`);
            logger.info(
              `[voice] streamed ${result.sentences.length} phrase(s) in ${Date.now() - startedAt}ms`
            );
            options.onSpoke?.(result.spoken);
            return;
          }
          // Nothing speakable came through the stream (phatic, empty, all-artifact, or a stream
          // error) → fall through to the blocking reply below.
          logger.debug(
            '[voice] stream produced nothing speakable — falling back to blocking reply'
          );
        } catch (err) {
          logger.warn(
            `[voice] streaming path failed, falling back to blocking: ${err instanceof Error ? err.message : String(err)}`
          );
          if (signal.aborted) return;
        }
      }

      // ---- BLOCKING FALLBACK: the original tour-par-tour behavior, unchanged ----
      const replyStart = Date.now();
      const rawReply = await replyFn(heard, { signal });
      replyMs = Date.now() - replyStart;
      // Interrupted during the think step → abandon silently (never speak a stale reply).
      if (signal.aborted) return;
      // Sanity gate before synth: strip leaked control tokens + foreign-script contamination
      // (observed: a French reply degrading into CJK the Piper voice can't pronounce), stay silent
      // if nothing meaningful survives. `reply` is what we synth, log, and hand to onSpoke.
      const reply = prepareSpeech(rawReply);
      if (!reply) {
        if ((rawReply ?? '').trim()) {
          logger.info(
            `[voice] reply muted — nothing speakable after sanitize: ${JSON.stringify((rawReply ?? '').slice(0, 120))}`
          );
        }
        return; // nothing to say → silence (never an error)
      }
      const synth = await resolveSynth();
      const synthStart = Date.now();
      const wav = await synth(reply);
      synthMs = Date.now() - synthStart;
      if (!wav) return;
      // Interrupted during synth → don't start playback.
      if (signal.aborted) return;
      const playStart = Date.now();
      await withSpeakingGuard(() => play(wav, { signal })); // half-duplex + interruptible
      playMs = Date.now() - playStart;
      // A barge-in kills the player early; don't claim we "spoke" the whole line.
      if (signal.aborted) return;
      logger.info(`[voice] spoke → ${reply}`);
      logger.info(
        `[voice] timings: reply=${replyMs}ms synth=${synthMs}ms play=${playMs}ms total=${Date.now() - startedAt}ms`
      );
      options.onSpoke?.(reply);
      // Best-effort cleanup of the synthesized WAV.
      try {
        const { unlink } = await import('fs/promises');
        await unlink(wav);
      } catch {
        /* leave the file if cleanup fails — not worth surfacing */
      }
    } catch (err) {
      logger.warn(
        `[voice] reply→speak failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      // If THIS turn was interrupted, hard-reset the half-duplex guard so the ear re-opens NOW
      // (barge-in), overriding the echo tail that withSpeakingGuard's finally just armed. Runs
      // last, so it wins the race against that endSpeaking(). Never re-arms after a normal turn.
      if (signal.aborted) {
        try {
          interruptSpeaking();
        } catch {
          /* never-throws */
        }
      }
      if (currentAbort === controller) currentAbort = null;
    }
  };

  (handler as VoiceReplyHandler).interrupt = (): void => {
    const controller = currentAbort;
    if (!controller) return; // nothing in flight → clean no-op
    try {
      controller.abort();
    } catch {
      /* never-throws */
    }
  };

  return handler as VoiceReplyHandler;
}
