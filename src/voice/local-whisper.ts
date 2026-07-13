/**
 * Local speech-to-text via faster-whisper ($0, offline).
 *
 * Wraps a self-hosted faster-whisper venv (the same local voice stack Cowork
 * uses — e.g. ~/DEV/ai-stack/voice/.venv) as a reusable `audioFile -> text`
 * helper. One-shot per call (model loads in ~1-2s on int8 CPU), which is fine
 * for occasional clips (Telegram voice notes, a CLI turn). No cloud, no key.
 *
 * Engine selection (first existing wins):
 *   CODEBUDDY_VOICE_PYTHON | COWORK_VOICE_PYTHON  (explicit interpreter)
 *   ~/.codebuddy/voice/.venv/bin/python
 *   ~/DEV/ai-stack/voice/.venv/bin/python
 *   ~/ai-stack/voice/.venv/bin/python
 *   python3 (PATH fallback)
 * Model: CODEBUDDY_WHISPER_MODEL | COWORK_WHISPER_MODEL | "base".
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function resolvePython(): string {
  const candidates = [
    process.env.CODEBUDDY_VOICE_PYTHON,
    process.env.COWORK_VOICE_PYTHON,
    join(homedir(), '.codebuddy/voice/.venv/bin/python'),
    join(homedir(), 'DEV/ai-stack/voice/.venv/bin/python'),
    join(homedir(), 'ai-stack/voice/.venv/bin/python'),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'python3';
}

const WHISPER_SCRIPT = `
import sys, json
from faster_whisper import WhisperModel
audio, model, lang = sys.argv[1], sys.argv[2], (sys.argv[3] or None)
m = WhisperModel(model, device="cpu", compute_type="int8")
segs, _info = m.transcribe(audio, language=lang, vad_filter=True, beam_size=1)
segments = [{"startSeconds": float(s.start), "endSeconds": float(s.end), "text": s.text.strip()} for s in segs if s.text.strip()]
print(json.dumps({"text": " ".join(s["text"] for s in segments).strip(), "segments": segments}))
`;

export interface LocalWhisperOptions {
  language?: string; // e.g. "fr"; empty/undefined = auto-detect
  model?: string; // faster-whisper size: tiny|base|small|medium|large
  timeoutMs?: number;
}

export interface LocalWhisperSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface LocalWhisperDetailedResult {
  text: string;
  segments: LocalWhisperSegment[];
}

/** Transcribe an audio file (wav/ogg/mp3/webm…) to text via local faster-whisper. */
export async function transcribeFile(
  audioPath: string,
  options: LocalWhisperOptions = {},
): Promise<string> {
  return (await transcribeFileDetailed(audioPath, options)).text;
}

/** Transcribe with local timestamps so downstream diarization can label real turns. */
export async function transcribeFileDetailed(
  audioPath: string,
  options: LocalWhisperOptions = {},
): Promise<LocalWhisperDetailedResult> {
  const language = options.language ?? 'fr';
  const model =
    options.model ||
    process.env.CODEBUDDY_WHISPER_MODEL ||
    process.env.COWORK_WHISPER_MODEL ||
    'base';
  const timeoutMs = options.timeoutMs ?? 120_000;

  if (!existsSync(audioPath)) {
    throw new Error(`local-whisper: audio file not found: ${audioPath}`);
  }

  return new Promise<LocalWhisperDetailedResult>((resolve, reject) => {
    const py = resolvePython();
    const proc = spawn(py, ['-c', WHISPER_SCRIPT, audioPath, model, language], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`local-whisper: timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`local-whisper: failed to spawn ${py}: ${e.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`local-whisper: exited ${code}: ${stderr.trim().slice(-300)}`));
        return;
      }
      try {
        const line = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
        const parsed = JSON.parse(line) as {
          text?: string;
          segments?: LocalWhisperSegment[];
        };
        const segments = Array.isArray(parsed.segments)
          ? parsed.segments.filter((segment) => (
              Number.isFinite(segment.startSeconds)
              && Number.isFinite(segment.endSeconds)
              && segment.endSeconds >= segment.startSeconds
              && typeof segment.text === 'string'
              && segment.text.trim().length > 0
            )).map((segment) => ({
              startSeconds: segment.startSeconds,
              endSeconds: segment.endSeconds,
              text: segment.text.trim(),
            }))
          : [];
        resolve({ text: (parsed.text || '').trim(), segments });
      } catch (e) {
        reject(new Error(`local-whisper: bad output: ${String(e)} :: ${stdout.slice(-200)}`));
      }
    });
  });
}

/** True if a local faster-whisper interpreter looks available. */
export function localWhisperAvailable(): boolean {
  const py = resolvePython();
  return py !== 'python3' || Boolean(process.env.CODEBUDDY_VOICE_PYTHON);
}
