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
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { commandExists } from '../utils/command-exists.js';
import { inferTaskType } from '../fleet/model-capability-heuristics.js';
import { withSpeakingGuard } from './voice-activity.js';
import { matchVoiceInteraction, VOICE_INTERACTION_PREWARM_PHRASES } from './voice-interactions.js';

/** Think: turn what was heard into a short spoken reply ('' → stay silent). */
export type ReplyFn = (heard: string) => Promise<string>;
/** Synthesize: turn reply text into a playable WAV file, return its path. */
export type SynthFn = (text: string) => Promise<string>;
/** Speak: play a WAV file to the speakers (blocking until done). */
export type PlayFn = (wav: string) => Promise<void>;

export interface VoiceReplyOptions {
  /** Injectable "think" step. Default: a short companion reply from a local LLM ($0). */
  replyFn?: ReplyFn;
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
        'Set CODEBUDDY_TTS_VOICE=/path/to/voice.onnx.',
    );
  }
  warnings.push(
    routed
      ? 'Voice reply model is latency-routed (lowest-latency capable LLM among your active providers; ' +
          'set CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY=true to keep it on-box, or pin one with ' +
          'CODEBUDDY_SENSORY_SPEAK_MODEL=<model>). The chosen model must be reachable, else replies are silent.'
      : `Voice reply uses pinned model '${model}' (CODEBUDDY_SENSORY_SPEAK_MODEL) — it must be pulled/reachable, else replies are empty (silent).`,
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
            "blocked. Use 'plan' unless you mean it.",
    );
    // The posture is process-GLOBAL (PermissionModeManager singleton). On `buddy server`,
    // which also serves HTTP/fleet sessions, the first voice turn flips the mode for the whole
    // process — a read-only leak under 'plan', a privilege ESCALATION of every concurrent
    // session under dontAsk/bypass. Run the speaking actor in its OWN process.
    warnings.push(
      'Voice ACT sets a PROCESS-GLOBAL permission posture — run the speaking actor in its own ' +
        'process (a dedicated `buddy server`), not one also serving interactive/HTTP/fleet sessions, ' +
        `or the '${permissionMode}' posture leaks into them.`,
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
  "Tu es le compagnon robot de Patrice. On te parle à voix haute et tu réponds à voix haute. " +
  "Réponds en français, en UNE à DEUX phrases courtes, naturelles, parlées. " +
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
    return "Oui, je suis là.";
  }
  if (/^(lisa )?(ca va|ça va|comment ca va|comment ça va)$/.test(text)) {
    return text.startsWith('lisa ') ? 'Oui Patrice. Je suis contente de t’entendre.' : 'Oui, je suis prêt.';
  }
  if (/^(comment s est passee ta journee|comment s est passée ta journée|comment etait ta journee|comment était ta journée)$/.test(text)) {
    return "Plutôt bien. J'ai continué à préparer Code Buddy pour répondre plus vite.";
  }
  if (/^lisa (comment s est passee ta journee|comment s est passée ta journée|comment etait ta journee|comment était ta journée)$/.test(text)) {
    return "Plutôt bien. J'ai continué à travailler pour toi, et toi, comment s'est passée ta journée ?";
  }
  if (
    /^(lisa )?(je pars|je part|je pars chez|je vais|je m en vais|je partais|je parchais).*(chez des amis|voir des amis|visite chez des amis|des amis)$/.test(text)
  ) {
    return 'Amuse-toi bien chez tes amis. Je continue en autonomie et je te ferai un résumé quand tu reviens.';
  }
  if (/^(lisa )?(je suis rentre|je suis rentré|je suis revenue|je suis revenu|je rentre)$/.test(text)) {
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
  "Je lance le diagnostic.",
  "Je teste en réel.",
  "Je te réponds dès que j'ai une preuve.",
  "Je n'ai rien entendu.",
  "Je t'entends.",
  "Je t'écoute.",
  'Parle plus fort, s’il te plaît.',
  'Je suis disponible.',
  'Je suis en train de travailler.',
  "Je garde ça en mémoire.",
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
  const unique = [...new Set(DEFAULT_TTS_PREWARM_PHRASES.map(phrase => phrase.trim()).filter(Boolean))];
  if (limit === undefined) return unique;
  return unique.slice(0, Math.max(0, limit));
}

export async function prewarmVoiceReplyCache(options: {
  phrases?: string[];
  limit?: number;
  voice?: string;
  rootDir?: string;
  synth?: SynthFn;
} = {}): Promise<{ attempted: number; cached: number }> {
  if (process.env.CODEBUDDY_TTS_CACHE === 'false') return { attempted: 0, cached: 0 };
  const phrases = (options.phrases ?? getDefaultVoicePrewarmPhrases(options.limit))
    .map(phrase => phrase.trim())
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
      logger.debug(`[voice] tts prewarm skipped phrase: ${err instanceof Error ? err.message : String(err)}`);
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
    logger.debug(`[voice] model routing skipped: ${err instanceof Error ? err.message : String(err)}`);
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
export async function defaultReply(heard: string, history: VoiceHistoryTurn[] = []): Promise<string> {
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
    const systemPrompt = (await getActivePersonaVoiceAsync()).spokenPrompt || SPEAK_SYSTEM_PROMPT;
    const resp = await client.chat(
      [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: heard },
      ] as never,
      [],
    );
    return (resp?.choices?.[0]?.message?.content ?? '').trim();
  } catch (err) {
    logger.warn(`[voice] local reply failed: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/** Default synth: Piper neural TTS via the shared text_to_speech synthesizer. */
function makeDefaultSynth(voice?: string, rootDir?: string): SynthFn {
  const resolvedVoice = voice || resolveDefaultPiperVoiceModel();
  const cacheVoice = resolvedVoice;
  const synthFresh = async (text: string): Promise<string> => {
    const { synthesizeTextToSpeech } = await import('../tools/text-to-speech-tool.js');
    const res = await synthesizeTextToSpeech(
      { text, provider: 'piper', format: 'wav', ...(resolvedVoice ? { voice: resolvedVoice } : {}) },
      rootDir ? { rootDir } : {},
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
      cache.store(text, cacheVoice, wav); // best-effort; cache copy survives the caller's unlink
      logger.info('[voice] tts cache store');
      return wav;
    } catch {
      return synthFresh(text);
    }
  };
}

/** Default speak: play a WAV with the first available local player, blocking until done. */
async function defaultPlay(wav: string): Promise<void> {
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
      const killTimer = setTimeout(() => {
        logger.warn(`[voice] player ${c.cmd} exceeded ${playTimeoutMs}ms — killing to avoid latching the speaking guard`);
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        resolve();
      }, playTimeoutMs);
      const done = (): void => {
        clearTimeout(killTimer);
        resolve();
      };
      child.on('error', done);
      child.on('close', done);
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
  options: { voice?: string; rootDir?: string; synth?: SynthFn; play?: PlayFn } = {},
): Promise<void> {
  const t = (text ?? '').trim();
  if (!t) return;
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
    logger.warn(`[voice] sayNow (local) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  // 2. Phone — when traveling, push the same line as a Telegram VOICE NOTE so it reaches you
  //    even with no one at the speakers. Opt-in, best-effort.
  if (process.env.CODEBUDDY_VOICE_TO_TELEGRAM === 'true') {
    try {
      const { sendTelegramVoice } = await import('./alert.js');
      await sendTelegramVoice(t);
    } catch (err) {
      logger.warn(`[voice] sayNow (telegram) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Build an `onHeard` handler that thinks then speaks. Never-throws.
 * Wire it into `wireSpeechReaction({ onHeard: makeVoiceReply() })`.
 */
export function makeVoiceReply(options: VoiceReplyOptions = {}): (heard: string) => Promise<void> {
  const replyFn = options.replyFn ?? defaultReply;
  const play = options.play ?? defaultPlay;

  return async (heard: string): Promise<void> => {
    const startedAt = Date.now();
    let replyMs = 0;
    let synthMs = 0;
    let playMs = 0;
    try {
      const replyStart = Date.now();
      const reply = (await replyFn(heard)).trim();
      replyMs = Date.now() - replyStart;
      if (!reply) return; // nothing to say → silence (never an error)
      // Resolve the voice per-reply so a mid-session `/persona use …` changes the voice live.
      let synth = options.synth;
      if (!synth) {
        let voice = options.voice;
        if (!voice) {
          try {
            const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
            voice = (await getActivePersonaVoiceAsync()).voice;
          } catch {
            /* keep env default */
          }
        }
        synth = makeDefaultSynth(voice, options.rootDir);
      }
      const synthStart = Date.now();
      const wav = await synth(reply);
      synthMs = Date.now() - synthStart;
      if (!wav) return;
      const playStart = Date.now();
      await withSpeakingGuard(() => play(wav)); // half-duplex: mute the ear while speaking
      playMs = Date.now() - playStart;
      logger.info(`[voice] spoke → ${reply}`);
      logger.info(
        `[voice] timings: reply=${replyMs}ms synth=${synthMs}ms play=${playMs}ms total=${Date.now() - startedAt}ms`,
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
      logger.warn(`[voice] reply→speak failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
