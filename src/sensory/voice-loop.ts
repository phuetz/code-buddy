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
import { logger } from '../utils/logger.js';
import { commandExists } from '../utils/command-exists.js';
import { inferTaskType } from '../fleet/model-capability-heuristics.js';

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

  // Fallback: the documented default (may be silent if not pulled — readiness warns).
  return { model: override || 'llama3.2', apiKey, baseURL, reason: 'fallback default' };
}

/** Default think: a short companion reply from the fastest capable LLM ($0 when local).
 *  Mirrors the local-inference pattern of vision-reaction.ts. Best-effort: any failure → '' (silence). */
async function defaultReply(heard: string): Promise<string> {
  try {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const route = await resolveVoiceModel(heard);
    logger.debug(`[voice] reply model: ${route.model} — ${route.reason}`);
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    const resp = await client.chat(
      [
        { role: 'system', content: SPEAK_SYSTEM_PROMPT },
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
  return async (text: string) => {
    const { synthesizeTextToSpeech } = await import('../tools/text-to-speech-tool.js');
    const res = await synthesizeTextToSpeech(
      { text, provider: 'piper', format: 'wav', ...(voice ? { voice } : {}) },
      rootDir ? { rootDir } : {},
    );
    return res.outputPath;
  };
}

/** Default speak: play a WAV with the first available local player, blocking until done. */
async function defaultPlay(wav: string): Promise<void> {
  const candidates: Array<{ cmd: string; args: (f: string) => string[] }> = [
    { cmd: 'aplay', args: (f) => ['-q', f] },
    { cmd: 'pw-play', args: (f) => [f] },
    { cmd: 'ffplay', args: (f) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', f] },
  ];
  for (const c of candidates) {
    if (!(await commandExists(c.cmd))) continue;
    await new Promise<void>((resolve) => {
      const child = spawn(c.cmd, c.args(wav), { stdio: 'ignore' });
      child.on('error', () => resolve());
      child.on('close', () => resolve());
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
  // 1. Home speakers (best-effort — a missing audio device must not block the phone push).
  try {
    const synth = options.synth ?? makeDefaultSynth(options.voice, options.rootDir);
    const play = options.play ?? defaultPlay;
    const wav = await synth(t);
    if (wav) {
      await play(wav);
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
  const synth = options.synth ?? makeDefaultSynth(options.voice, options.rootDir);
  const play = options.play ?? defaultPlay;

  return async (heard: string): Promise<void> => {
    try {
      const reply = (await replyFn(heard)).trim();
      if (!reply) return; // nothing to say → silence (never an error)
      const wav = await synth(reply);
      if (!wav) return;
      await play(wav);
      logger.info(`[voice] spoke → ${reply}`);
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
