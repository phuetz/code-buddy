/**
 * Voice assistant configuration core.
 *
 * The assistant daemon and Telegram companion both read plain `.env` files
 * through systemd. This module keeps edits conservative: only known assistant
 * keys are written, unrelated lines stay untouched, and all I/O is best-effort.
 *
 * @module companion/assistant-config
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { PocketTTSProvider, PRESET_VOICES } from '../talk-mode/providers/pocket-tts.js';

export type AssistantSettingGroup = 'voice' | 'speech' | 'behavior' | 'companion';
export type AssistantSettingType = 'toggle' | 'enum' | 'text' | 'voice';
export type AssistantEnvFile = 'vision' | 'lisa' | 'both';
export type AssistantEnvFileName = 'vision' | 'lisa';

export interface AssistantSetting {
  key: string;
  label: string;
  group: AssistantSettingGroup;
  type: AssistantSettingType;
  options?: string[];
  default: string;
  envFile: AssistantEnvFile;
  help: string;
}

export interface AssistantEnvPaths {
  vision?: string;
  lisa?: string;
}

export interface AssistantServiceRestartResult {
  service: string;
  ok: boolean;
  error?: string;
}

const MANAGED_MARKER = '# --- assistant config (managed) ---';
const execFileAsync = promisify(execFile);

export const ASSISTANT_SETTINGS: AssistantSetting[] = [
  {
    key: 'CODEBUDDY_TTS_ENGINE',
    label: 'TTS engine',
    group: 'voice',
    type: 'enum',
    options: ['piper', 'pocket'],
    default: 'piper',
    envFile: 'both',
    help: 'Selects the assistant speech synthesis engine.',
  },
  {
    key: 'CODEBUDDY_POCKET_VOICE',
    label: 'Pocket voice',
    group: 'voice',
    type: 'voice',
    default: 'estelle',
    envFile: 'both',
    help: 'Pocket TTS preset name or path to a short clone sample.',
  },
  {
    key: 'CODEBUDDY_POCKET_LANG',
    label: 'Pocket language',
    group: 'voice',
    type: 'text',
    default: 'french',
    envFile: 'both',
    help: 'Language token used by Pocket TTS.',
  },
  {
    key: 'CODEBUDDY_TTS_VOICE',
    label: 'Piper fallback voice',
    group: 'voice',
    type: 'text',
    default: '',
    envFile: 'both',
    help: 'Fallback Piper .onnx voice model path.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEAK',
    label: 'Speak responses',
    group: 'speech',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Enables spoken assistant responses on the vision daemon.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEAK_ACT',
    label: 'Speak actions',
    group: 'speech',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Allows the assistant to speak action feedback.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE',
    label: 'Speech permission mode',
    group: 'speech',
    type: 'enum',
    options: ['plan', 'dontAsk', 'bypassPermissions'],
    default: 'plan',
    envFile: 'vision',
    help: 'Permission mode used by spoken action flows.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEAK_MODEL',
    label: 'Speech model',
    group: 'speech',
    type: 'text',
    default: 'auto',
    envFile: 'vision',
    help: 'Model used for spoken assistant replies.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEECH',
    label: 'Listen for speech',
    group: 'behavior',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Enables speech input in the sensory daemon.',
  },
  {
    key: 'CODEBUDDY_ROBOT_NAME',
    label: 'Assistant name',
    group: 'behavior',
    type: 'text',
    default: 'Lisa',
    envFile: 'both',
    help: 'Name the voice assistant uses for itself.',
  },
  {
    key: 'CODEBUDDY_SENSORY_ALWAYS_RESPOND',
    label: 'Always respond',
    group: 'behavior',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Responds even when the utterance is not clearly addressed to the assistant.',
  },
  {
    key: 'CODEBUDDY_SENSORY_CHIME_IN',
    label: 'Chime in',
    group: 'behavior',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Allows opportunistic short interjections.',
  },
  {
    key: 'CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS',
    label: 'Engage window ms',
    group: 'behavior',
    type: 'text',
    default: '30000',
    envFile: 'vision',
    help: 'Time window during which follow-up speech stays engaged.',
  },
  {
    key: 'CODEBUDDY_SPEECH_LANG',
    label: 'Speech language',
    group: 'behavior',
    type: 'text',
    default: 'fr',
    envFile: 'vision',
    help: 'Primary language code for speech recognition.',
  },
  {
    key: 'CODEBUDDY_SENSORY_GREET',
    label: 'Greeting',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Enables assistant greetings.',
  },
  {
    key: 'CODEBUDDY_REMINDERS',
    label: 'Reminders',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Enables companion reminders.',
  },
  {
    key: 'CODEBUDDY_COMPANION_RELATIONAL',
    label: 'Relational memory',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'both',
    help: 'Injects relational context into companion replies.',
  },
  {
    key: 'CODEBUDDY_COMPANION_PROACTIVE',
    label: 'Proactive companion',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Allows proactive companion behaviors.',
  },
  {
    key: 'CODEBUDDY_VOICE_IMPROVE',
    label: 'Voice improvement',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Enables the voice assistant improvement loop.',
  },
];

function hasOwn(obj: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function readTextFile(path: string): string {
  try {
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function writeTextFile(path: string, content: string): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function resolveEnvFilePath(which: AssistantEnvFileName, paths?: AssistantEnvPaths): string {
  return paths?.[which] ?? envFilePath(which);
}

function validateSettingValue(setting: AssistantSetting, value: string): boolean {
  if (setting.type !== 'enum') return true;
  return setting.options?.includes(value) ?? false;
}

function validUpdateEntries(updates: Record<string, string>): Array<[AssistantSetting, string]> {
  const entries: Array<[AssistantSetting, string]> = [];
  for (const setting of ASSISTANT_SETTINGS) {
    if (!hasOwn(updates, setting.key)) continue;
    const value = updates[setting.key] ?? '';
    if (!validateSettingValue(setting, value)) continue;
    entries.push([setting, value]);
  }
  return entries;
}

export function envFilePath(which: AssistantEnvFileName): string {
  return join(homedir(), '.codebuddy', `${which}.env`);
}

export function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

export function mergeEnv(content: string, updates: Record<string, string>): string {
  const entries = Object.entries(updates).filter(([key]) => key.trim().length > 0);
  if (entries.length === 0) return content;

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = /\r?\n$/.test(content);
  const lines = content.length === 0 ? [] : content.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();

  const pending = new Map(entries);
  let markerSeen = false;
  const merged = lines.map((line) => {
    if (line.trim() === MANAGED_MARKER) markerSeen = true;
    const match = line.match(/^(\s*([^=\s#]+)\s*=\s*)(.*)$/);
    const key = match?.[2];
    if (!match || !key || !pending.has(key)) return line;
    const value = pending.get(key) ?? '';
    pending.delete(key);
    return `${match[1] ?? ''}${value}`;
  });

  const willAppend = pending.size > 0;
  if (willAppend) {
    if (!markerSeen) {
      if (merged.length > 0 && merged[merged.length - 1]?.trim() !== '') merged.push('');
      merged.push(MANAGED_MARKER);
    }
    for (const [key, value] of pending) merged.push(`${key}=${value}`);
  }

  return `${merged.join(newline)}${hadTrailingNewline || willAppend ? newline : ''}`;
}

export function readAssistantConfig(paths?: AssistantEnvPaths): Record<string, string> {
  try {
    const vision = parseEnv(readTextFile(resolveEnvFilePath('vision', paths)));
    const lisa = parseEnv(readTextFile(resolveEnvFilePath('lisa', paths)));
    const config: Record<string, string> = {};

    for (const setting of ASSISTANT_SETTINGS) {
      if (setting.envFile === 'vision') {
        config[setting.key] = hasOwn(vision, setting.key)
          ? (vision[setting.key] ?? setting.default)
          : setting.default;
      } else if (setting.envFile === 'lisa') {
        config[setting.key] = hasOwn(lisa, setting.key)
          ? (lisa[setting.key] ?? setting.default)
          : setting.default;
      } else {
        config[setting.key] = hasOwn(vision, setting.key)
          ? (vision[setting.key] ?? setting.default)
          : hasOwn(lisa, setting.key)
            ? (lisa[setting.key] ?? setting.default)
            : setting.default;
      }
    }

    return config;
  } catch {
    return Object.fromEntries(ASSISTANT_SETTINGS.map((setting) => [setting.key, setting.default]));
  }
}

export function writeAssistantConfig(
  updates: Record<string, string>,
  paths?: AssistantEnvPaths
): { vision: string[]; lisa: string[] } {
  const result: { vision: string[]; lisa: string[] } = { vision: [], lisa: [] };

  try {
    const byFile: Record<AssistantEnvFileName, Record<string, string>> = { vision: {}, lisa: {} };
    for (const [setting, value] of validUpdateEntries(updates)) {
      if (setting.envFile === 'vision' || setting.envFile === 'both') {
        byFile.vision[setting.key] = value;
      }
      if (setting.envFile === 'lisa' || setting.envFile === 'both') {
        byFile.lisa[setting.key] = value;
      }
    }

    for (const which of ['vision', 'lisa'] as const) {
      const fileUpdates = byFile[which];
      const keys = Object.keys(fileUpdates);
      if (keys.length === 0) continue;
      const path = resolveEnvFilePath(which, paths);
      const next = mergeEnv(readTextFile(path), fileUpdates);
      if (writeTextFile(path, next)) result[which] = keys;
    }
  } catch {
    return result;
  }

  return result;
}

export function listPocketVoices(): string[] {
  return [...PRESET_VOICES];
}

/** Default sentence used to test a voice (kept in sync with the Cowork panel's pre-fill). */
export const DEFAULT_VOICE_PREVIEW_TEXT =
  'Bonjour ! Voici un aperçu de ma voix. Est-ce qu’elle te plaît ?';

/** Tiny stable string hash (djb2, base36) — for keying the preview cache on the text. Pure. */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Stable on-disk path for a voice's preview sample, keyed on BOTH the voice and
 * the (hashed) test text so a custom sentence gets its own cache entry while the
 * default sentence stays stable (prewarm-friendly). Pure/testable.
 */
export function voicePreviewCachePath(
  name: string,
  text: string = DEFAULT_VOICE_PREVIEW_TEXT
): string {
  const safeName = name.trim().replace(/[^a-z0-9._-]/gi, '-') || 'voice';
  const effective = text.trim() || DEFAULT_VOICE_PREVIEW_TEXT;
  return join(
    homedir(),
    '.codebuddy',
    'companion',
    'voice-previews',
    `${safeName}-${hashText(effective)}.wav`
  );
}

/**
 * Synthesize (or reuse) a short voice preview WAV, returning its path. Cached at
 * a stable path per (voice, text) so re-listening the same sentence is instant
 * (Pocket `french_24l` costs ~4-8 s per synth on CPU). `force` regenerates.
 * never-throws.
 */
export async function previewVoice(
  name: string,
  text?: string,
  opts?: { force?: boolean }
): Promise<string | null> {
  try {
    const voiceName = name.trim();
    if (!voiceName) return null;
    const effectiveText = (text ?? '').trim() || DEFAULT_VOICE_PREVIEW_TEXT;
    const outPath = voicePreviewCachePath(voiceName, effectiveText);

    // Cache hit: a non-empty WAV already exists for this voice+text → return instantly.
    if (!opts?.force) {
      try {
        if (existsSync(outPath) && statSync(outPath).size > 44) return outPath;
      } catch {
        /* fall through to (re)synthesis */
      }
    }

    const provider = new PocketTTSProvider();
    await provider.initialize({
      provider: 'pocket',
      enabled: true,
      priority: 1,
      settings: { voice: voiceName, language: 'french' },
    });
    if (!(await provider.isAvailable())) return null;

    const result = await provider.synthesize(effectiveText, {
      voice: voiceName,
      language: 'french',
      format: 'wav',
    });
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, result.audio, { mode: 0o600 });
    return outPath;
  } catch {
    return null;
  }
}

export async function restartAssistantServices(
  which: Array<'buddy-vision-brain' | 'lisa-telegram'> = ['buddy-vision-brain']
): Promise<AssistantServiceRestartResult[]> {
  const results: AssistantServiceRestartResult[] = [];
  for (const service of which) {
    try {
      await execFileAsync('systemctl', ['--user', 'restart', `${service}.service`]);
      results.push({ service, ok: true });
    } catch (error) {
      results.push({
        service,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

// ============================================================================
// System output volume (live control — applies immediately, not an env var)
// ============================================================================

/** Extract the first "NN%" from `pactl`/`amixer` output → clamped 0..150. Pure. */
export function parseVolumePercent(output: string): number | null {
  const match = output.match(/(\d+)\s*%/);
  if (!match) return null;
  return Math.max(0, Math.min(150, Number(match[1])));
}

/** Read the current default-sink volume percent (pactl, falling back to amixer). null if unavailable. */
export async function getSystemVolume(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
    return parseVolumePercent(stdout);
  } catch {
    try {
      const { stdout } = await execFileAsync('amixer', ['sget', 'Master']);
      return parseVolumePercent(stdout);
    } catch {
      return null;
    }
  }
}

/** Set the default-sink volume (unmutes first). Clamped 0..150. never-throws. */
export async function setSystemVolume(percent: number): Promise<boolean> {
  const pct = Math.max(0, Math.min(150, Math.round(percent)));
  try {
    await execFileAsync('pactl', ['set-sink-mute', '@DEFAULT_SINK@', '0']);
    await execFileAsync('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${pct}%`]);
    return true;
  } catch {
    try {
      await execFileAsync('amixer', ['-q', 'sset', 'Master', 'unmute']);
      await execFileAsync('amixer', ['-q', 'sset', 'Master', `${pct}%`]);
      return true;
    } catch {
      return false;
    }
  }
}
