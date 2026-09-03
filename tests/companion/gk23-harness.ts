/**
 * GK23 harness — isolated HOME, store paths, CLI spawn, fake aplay PATH.
 * Never points at the operator's real ~/.codebuddy/reminders.json.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, copyFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const GK23_ROOT = path.join(REPO_ROOT, '_qa', 'gk23');
export const APLAY_BIN = path.join(GK23_ROOT, 'bin', 'aplay');
export const PIPER_BIN = '/usr/local/bin/piper';
export const PIPER_MODEL = '/home/patrice/DEV/ai-stack/voice/voices/fr_FR-siwis-medium.onnx';
export const REAL_REMINDERS = '/home/patrice/.codebuddy/reminders.json';
export const REAL_PENDING = '/home/patrice/.codebuddy/companion/pending-acks.json';
export const REAL_LOG = '/home/patrice/.codebuddy/companion/reminder-log.jsonl';
export const REAL_SNOOZES = '/home/patrice/.codebuddy/companion/snoozes.json';

const KEYS = [
  'HOME',
  'TMPDIR',
  'PATH',
  'CODEBUDDY_REMINDERS_FILE',
  'CODEBUDDY_REMINDER_LOG_FILE',
  'CODEBUDDY_REMINDER_PENDING_FILE',
  'CODEBUDDY_REMINDER_SNOOZE_FILE',
  'CODEBUDDY_REMINDER_ACK_WINDOW_MS',
  'CODEBUDDY_REMINDER_RENAG_MS',
  'CODEBUDDY_REMINDER_RENAG_MAX',
  'CODEBUDDY_REMINDER_TICK_MS',
  'CODEBUDDY_REMINDERS',
  'CODEBUDDY_TTS_ENGINE',
  'CODEBUDDY_TTS_PIPER_MODEL',
  'CODEBUDDY_TTS_VOICE',
  'CODEBUDDY_PIPER_BIN',
  'CODEBUDDY_TTS_CACHE',
  'CODEBUDDY_USER_NAME',
  'CODEBUDDY_SENSORY_ALERT_TOKEN',
  'CODEBUDDY_SENSORY_ALERT_CHAT',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_API_BASE',
  'ELEVENLABS_API_KEY',
  'CODEBUDDY_VOICE_TO_TELEGRAM',
  'CODEBUDDY_DISABLE_MCP',
  'GK23_APLAY_LOG_DIR',
] as const;

export function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of KEYS) out[key] = process.env[key];
  return out;
}

export function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const key of KEYS) {
    const value = snap[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

export function ensureFakeAplay(): void {
  chmodSync(APLAY_BIN, 0o755);
  for (const alias of ['paplay', 'ffplay', 'play']) {
    const dest = path.join(GK23_ROOT, 'bin', alias);
    if (!existsSync(dest)) copyFileSync(APLAY_BIN, dest);
    chmodSync(dest, 0o755);
  }
}

export async function makeWorkDir(prefix: string): Promise<string> {
  const base = path.join(GK23_ROOT, 'work');
  mkdirSync(base, { recursive: true });
  mkdirSync(path.join(GK23_ROOT, 'tmp'), { recursive: true });
  mkdirSync(path.join(GK23_ROOT, 'artifacts'), { recursive: true });
  return mkdtemp(path.join(base, prefix));
}

export interface IsolatedStores {
  home: string;
  tmp: string;
  artifacts: string;
  remindersFile: string;
  logFile: string;
  pendingFile: string;
  snoozeFile: string;
}

/** Isolate every reminder store + HOME/TMPDIR. Paid TTS keys stripped. */
export function isolateStores(workDir: string, opts: { pendingEnv?: boolean } = {}): IsolatedStores {
  const home = path.join(workDir, 'home');
  const tmp = path.join(workDir, 'tmp');
  const artifacts = path.join(workDir, 'artifacts');
  const store = path.join(home, '.codebuddy');
  mkdirSync(path.join(store, 'companion'), { recursive: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  ensureFakeAplay();

  const remindersFile = path.join(store, 'reminders.json');
  const logFile = path.join(store, 'companion', 'reminder-log.jsonl');
  const pendingFile = path.join(store, 'companion', 'pending-acks.json');
  const snoozeFile = path.join(store, 'companion', 'snoozes.json');

  process.env.HOME = home;
  process.env.TMPDIR = tmp;
  process.env.PATH = `${path.join(GK23_ROOT, 'bin')}:${process.env.PATH ?? ''}`;
  process.env.GK23_APLAY_LOG_DIR = artifacts;
  process.env.CODEBUDDY_REMINDERS_FILE = remindersFile;
  process.env.CODEBUDDY_REMINDER_LOG_FILE = logFile;
  if (opts.pendingEnv !== false) {
    process.env.CODEBUDDY_REMINDER_PENDING_FILE = pendingFile;
    process.env.CODEBUDDY_REMINDER_SNOOZE_FILE = snoozeFile;
  } else {
    delete process.env.CODEBUDDY_REMINDER_PENDING_FILE;
    delete process.env.CODEBUDDY_REMINDER_SNOOZE_FILE;
  }
  process.env.CODEBUDDY_REMINDERS = 'true';
  process.env.CODEBUDDY_TTS_ENGINE = 'piper';
  process.env.CODEBUDDY_TTS_PIPER_MODEL = PIPER_MODEL;
  process.env.CODEBUDDY_PIPER_BIN = PIPER_BIN;
  delete process.env.CODEBUDDY_TTS_VOICE;
  delete process.env.ELEVENLABS_API_KEY;
  process.env.CODEBUDDY_TTS_CACHE = 'false';
  process.env.CODEBUDDY_USER_NAME = 'Patrice';
  process.env.CODEBUDDY_VOICE_TO_TELEGRAM = 'false';
  process.env.CODEBUDDY_DISABLE_MCP = 'true';

  return { home, tmp, artifacts, remindersFile, logFile, pendingFile, snoozeFile };
}

export function localDateKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function runBuddy(
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
  timeoutMs = 30_000,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const cleanEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...extraEnv }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs'), path.join(REPO_ROOT, 'src/index.ts'), ...args],
      {
        cwd: REPO_ROOT,
        env: { ...cleanEnv, CODEBUDDY_DISABLE_MCP: 'true', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out: buddy ${args.join(' ')}\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}
