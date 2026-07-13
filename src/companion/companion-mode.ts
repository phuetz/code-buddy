import { execFile as nodeExecFile } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getIdentityManager } from '../identity/identity-manager.js';
import {
  BUDDY_COMPANION_BOOT_MD,
  BUDDY_COMPANION_SOUL_MD,
  LISA_COMPANION_BOOT_MD,
  LISA_COMPANION_SOUL_MD,
} from '../identity/companion-identity.js';
import { getVoiceInputManager } from '../input/voice-input-enhanced.js';
import type { VoiceInputConfig } from '../input/voice-input-enhanced.js';
import { getTTSManager } from '../input/text-to-speech.js';
import type { TTSConfig } from '../input/text-to-speech.js';
import { describeVoiceReadiness, type VoiceReadiness } from '../sensory/voice-loop.js';
import {
  resolveSpeechRecognitionEngine,
  resolveParakeetModelDir,
  engineUsesParakeetModel,
} from '../sensory/speech-engine-config.js';
import { getActivePersonaVoiceAsync } from '../personas/persona-manager.js';
import { DEFAULT_WAKE_WORD_CONFIG } from '../voice/types.js';
import { hasCodexCredentials, getCodexAuthFilePath } from '../providers/codex-oauth.js';
import { commandExists } from '../utils/command-exists.js';
import { getSettingsManager } from '../utils/settings-manager.js';
import { checkCameraAvailability } from './camera.js';
import {
  getCompanionPerceptStats,
  recordCompanionPercept,
  type CompanionPercept,
  type CompanionPerceptStats,
} from './percepts.js';

export const COMPANION_DEFAULT_MODEL = 'gpt-5.6-sol';
export const COMPANION_DEFAULT_LANGUAGE = 'fr';
export const COMPANION_DEFAULT_TTS_VOICE = 'fr-FR-HenriNeural';

export interface CompanionSetupOptions {
  cwd?: string;
  forceIdentity?: boolean;
  configureVoice?: boolean;
  configureModel?: boolean;
  language?: string;
  sttProvider?: VoiceInputConfig['provider'];
  ttsProvider?: TTSConfig['provider'];
  ttsVoice?: string;
  model?: string;
}

export interface CompanionStatusOptions {
  cwd?: string;
}

export interface CompanionLiveRuntime {
  exists(path: string): boolean;
  checkPythonModule(pythonCommand: string, moduleName: string): Promise<boolean>;
  commandExists(command: string): Promise<boolean>;
  execFile?(command: string, args: string[], timeoutMs?: number): Promise<string>;
}

export interface CompanionLiveBriefOptions extends CompanionStatusOptions {
  record?: boolean;
  runtime?: CompanionLiveRuntime;
}

export interface CompanionListenCheckOptions extends CompanionStatusOptions {
  /** WAV to inspect. Defaults to the newest ~/.codebuddy/companion/utt-*.wav. */
  wav?: string;
  /** Injectable for tests/custom engines. Default: the live faster-whisper path. */
  transcribe?: (wav: string) => Promise<string>;
  /** Injectable clock for deterministic timing tests. */
  now?: () => number;
}

export interface CompanionSetupResult {
  cwd: string;
  wroteSoul: boolean;
  wroteBoot: boolean;
  skippedSoul: boolean;
  skippedBoot: boolean;
  voiceConfigured: boolean;
  modelConfigured: boolean;
  model?: string;
  status: CompanionStatus;
}

export interface CompanionStatus {
  cwd: string;
  authPath: string;
  chatGptCredentialsPresent: boolean;
  model: string;
  identity: {
    soulLoaded: boolean;
    soulSource?: string;
    soulIsCompanion: boolean;
    bootLoaded: boolean;
    bootSource?: string;
    bootIsCompanion: boolean;
  };
  voice: {
    enabled: boolean;
    available: boolean;
    reason?: string;
    provider: VoiceInputConfig['provider'];
    language?: string;
    autoSend?: boolean;
  };
  wakeWord: {
    available: boolean;
    engine: 'porcupine' | 'text-match';
    wakeWords: string[];
    picovoiceAccessKeyPresent: boolean;
  };
  tts: {
    enabled: boolean;
    available: boolean;
    reason?: string;
    provider: TTSConfig['provider'];
    voice?: string;
    autoSpeak?: boolean;
  };
  camera: {
    available: boolean;
    ffmpegAvailable: boolean;
    platform: string;
    commandPreview?: string;
    reason?: string;
  };
  percepts: CompanionPerceptStats;
}

export interface CompanionLiveCapability {
  id: string;
  label: string;
  ready: boolean;
  required: boolean;
  detail: string;
  next?: string;
}

export interface CompanionLiveCommand {
  label: string;
  command: string;
}

export interface CompanionListenCheck {
  ok: boolean;
  audioDir: string;
  wav?: string;
  transcript: string;
  sttMs: number;
  decision?: {
    respond: boolean;
    reason: string;
  };
  robotName: string;
  speechEngine: string;
  speechModel: string;
  speechLanguage: string;
  speechPython: string;
  parakeetModelDir?: string;
  error?: string;
}

interface CompanionVisionSidecarBrief {
  scriptPath: string;
  pythonCommand: string;
  backend: 'mediapipe' | 'yolo';
  backendModule: 'mediapipe' | 'ultralytics';
  scriptReady: boolean;
  websocketReady: boolean;
  backendModuleReady: boolean;
  yoloModel: string;
  yoloModelReady: boolean;
  ready: boolean;
  detail: string;
  next?: string;
}

interface CompanionSensoryBridgeBrief {
  cameraEnabled: boolean;
  serverTokenPresent: boolean;
  sidecarTokenPresent: boolean;
  tokensMatch: boolean;
  bridgeUrl: string;
  cameraIndex: string;
  ready: boolean;
  detail: string;
  next?: string;
}

type CompanionVoiceResponseMode = 'addressed+greeting' | 'chime-in' | 'always';

interface CompanionVoiceAssistantBrief {
  robotName: string;
  responseMode: CompanionVoiceResponseMode;
  readiness: VoiceReadiness;
  safeActionMode: boolean;
  piperBin: string;
  piperVoice: string;
  earScriptPath: string;
  earPython: string;
  earDevice: string;
  speechPython: string;
  playerCommand?: string;
  earDeviceAutoDetected: boolean;
  ready: boolean;
  detail: string;
  next?: string;
}

export interface AlsaCaptureDevice {
  cardIndex: string;
  cardId: string;
  cardName: string;
  deviceIndex: string;
  deviceName: string;
  alsaDevice: string;
  score: number;
}

export interface CompanionLiveBrief {
  cwd: string;
  timestamp: string;
  assistantName: string;
  status: CompanionStatus;
  requiredReady: number;
  requiredTotal: number;
  readinessScore: number;
  ready: boolean;
  capabilities: CompanionLiveCapability[];
  commands: CompanionLiveCommand[];
  perceptId?: string;
}

function isCompanionText(content: string | undefined): boolean {
  return Boolean(content?.includes('Buddy Companion') || content?.includes('Lisa Companion'));
}

function companionIdentityText(): { soul: string; boot: string } {
  const robotName = process.env.CODEBUDDY_ROBOT_NAME?.trim().toLowerCase();
  if (robotName === 'lisa') {
    return { soul: LISA_COMPANION_SOUL_MD, boot: LISA_COMPANION_BOOT_MD };
  }
  return { soul: BUDDY_COMPANION_SOUL_MD, boot: BUDDY_COMPANION_BOOT_MD };
}

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

function resolveCompanionSttProvider(
  provider: VoiceInputConfig['provider'] | undefined,
): VoiceInputConfig['provider'] {
  if (!provider || provider === 'system') return 'whisper-local';
  return provider;
}

function isTruthyEnv(name: string): boolean {
  const value = process.env[name];
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveYoloModelPath(): string {
  return expandHome(
    process.env.BUDDY_VISION_YOLO_MODEL
      || process.env.CODEBUDDY_YOLO_MODEL
      || '~/vision_tests/yolov8n.onnx',
  );
}

function resolveVisionPython(runtime: CompanionLiveRuntime): string {
  const configured = process.env.BUDDY_VISION_PYTHON
    || process.env.CODEBUDDY_VISION_PYTHON
    || process.env.CODEBUDDY_YOLO_PYTHON;
  if (configured?.trim()) return expandHome(configured.trim());

  const visionTestsPython = expandHome('~/vision_tests/venv/bin/python');
  return runtime.exists(visionTestsPython) ? visionTestsPython : 'python3';
}

function resolveEarPython(runtime: CompanionLiveRuntime): string {
  const configured = process.env.BUDDY_EAR_PYTHON;
  if (configured?.trim()) return expandHome(configured.trim());
  return resolveVisionPython(runtime);
}

function resolveSpeechPython(runtime: CompanionLiveRuntime): string {
  const configured = process.env.CODEBUDDY_SPEECH_PYTHON
    || process.env.CODEBUDDY_VOICE_PYTHON
    || process.env.COWORK_VOICE_PYTHON
    || process.env.CODEBUDDY_PYTHON_BIN;
  if (configured?.trim()) return expandHome(configured.trim());

  const candidates = [
    '~/.codebuddy/voice/.venv/bin/python',
    '~/DEV/ai-stack/voice/.venv/bin/python',
    '~/ai-stack/voice/.venv/bin/python',
    '~/vision_tests/venv/bin/python',
  ].map(expandHome);
  return candidates.find(candidate => runtime.exists(candidate)) || 'python3';
}

function resolveSpeechModel(): string {
  return process.env.CODEBUDDY_SPEECH_MODEL?.trim() || 'base';
}

function resolveSpeechLanguage(): string {
  return process.env.CODEBUDDY_SPEECH_LANG?.trim()
    || process.env.CODEBUDDY_COMPANION_LANGUAGE?.trim()
    || COMPANION_DEFAULT_LANGUAGE;
}

function resolveCompanionAudioDir(): string {
  return expandHome(process.env.CODEBUDDY_COMPANION_AUDIO_DIR?.trim() || '~/.codebuddy/companion');
}

function newestCompanionUtterance(audioDir: string): string | undefined {
  try {
    return readdirSync(audioDir)
      .filter(name => /^utt-\d+\.wav$/i.test(name))
      .map(name => {
        const fullPath = path.join(audioDir, name);
        return { fullPath, mtimeMs: statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.fullPath;
  } catch {
    return undefined;
  }
}

function resolveVisionBackend(yoloModelReady: boolean): 'mediapipe' | 'yolo' {
  const configured = process.env.BUDDY_VISION_PERSON_BACKEND?.trim().toLowerCase();
  if (configured === 'mediapipe' || configured === 'yolo') return configured;
  return yoloModelReady ? 'yolo' : 'mediapipe';
}

function resolveSenseBridgeUrl(): string {
  return process.env.BUDDY_SENSE_BRIDGE_URL?.trim() || 'ws://127.0.0.1:8129';
}

function resolveSenseCameraIndex(): string {
  return process.env.BUDDY_SENSE_CAMERA_INDEX?.trim() || '0';
}

const WEBCAM_MIC_KEYWORDS = [
  'brio',
  'webcam',
  'camera',
  'c920',
  'c922',
  'logitech',
  'usb video',
  'hd pro webcam',
  'integrated camera',
];

const LOW_PRIORITY_MIC_KEYWORDS = ['monitor', 'hdmi', 'displayport'];

function scoreAlsaCaptureDevice(cardId: string, cardName: string, deviceName: string): number {
  const text = `${cardId} ${cardName} ${deviceName}`.toLowerCase();
  let score = 0;
  if (WEBCAM_MIC_KEYWORDS.some(keyword => text.includes(keyword))) score += 100;
  if (text.includes('usb')) score += 20;
  if (LOW_PRIORITY_MIC_KEYWORDS.some(keyword => text.includes(keyword))) score -= 100;
  return score;
}

export function parseAlsaCaptureDevices(output: string): AlsaCaptureDevice[] {
  const devices: AlsaCaptureDevice[] = [];
  const pattern = /^card\s+(\d+):\s*([^\s]+)\s*\[([^\]]+)\],\s*device\s+(\d+):\s*[^[]*\[([^\]]+)\]/i;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = pattern.exec(line);
    if (!match) continue;
    const [, cardIndex, cardId, cardName, deviceIndex, deviceName] = match;
    const score = scoreAlsaCaptureDevice(cardId!, cardName!, deviceName!);
    devices.push({
      cardIndex: cardIndex!,
      cardId: cardId!,
      cardName: cardName!,
      deviceIndex: deviceIndex!,
      deviceName: deviceName!,
      alsaDevice: `plughw:CARD=${cardId},DEV=${deviceIndex}`,
      score,
    });
  }
  return devices;
}

export function selectPreferredAlsaCaptureDevice(output: string): AlsaCaptureDevice | undefined {
  const devices = parseAlsaCaptureDevices(output);
  return devices.sort((a, b) => b.score - a.score)[0];
}

async function resolveEarDevice(runtime: CompanionLiveRuntime): Promise<{ device: string; autoDetected: boolean }> {
  const configured = process.env.BUDDY_EAR_DEVICE?.trim();
  if (configured && configured.toLowerCase() !== 'auto') {
    return { device: configured, autoDetected: false };
  }
  if (runtime.execFile) {
    try {
      const output = await runtime.execFile('arecord', ['-l'], 3000);
      const selected = selectPreferredAlsaCaptureDevice(output);
      if (selected) {
        return { device: selected.alsaDevice, autoDetected: true };
      }
    } catch {
      // Fall through to ear.py auto mode; the sidecar has the same fallback logic.
    }
  }
  return { device: 'auto', autoDetected: false };
}

async function resolveRobotName(): Promise<string> {
  const configured = process.env.CODEBUDDY_ROBOT_NAME?.trim();
  if (configured) return configured;
  const personaName = (await getActivePersonaVoiceAsync()).robotName?.trim();
  if (personaName) return personaName;
  return 'Buddy';
}

export async function buildCompanionListenCheck(
  options: CompanionListenCheckOptions = {},
): Promise<CompanionListenCheck> {
  const runtime = createDefaultLiveRuntime();
  const audioDir = resolveCompanionAudioDir();
  const wav = options.wav ? expandHome(options.wav) : newestCompanionUtterance(audioDir);
  const robotName = await resolveRobotName();
  const speechEngine = resolveSpeechRecognitionEngine();
  const speechModel = resolveSpeechModel();
  const speechLanguage = resolveSpeechLanguage();
  const speechPython = resolveSpeechPython(runtime);
  const parakeetModelDir = resolveParakeetModelDir();
  const now = options.now ?? (() => Date.now());
  const parakeetFields = engineUsesParakeetModel(speechEngine) ? { parakeetModelDir } : {};

  if (!wav) {
    return {
      ok: false,
      audioDir,
      transcript: '',
      sttMs: 0,
      robotName,
      speechEngine,
      speechModel,
      speechLanguage,
      speechPython,
      ...parakeetFields,
      error: `No companion utterance WAV found in ${audioDir}`,
    };
  }

  if (!existsSync(wav)) {
    return {
      ok: false,
      audioDir,
      wav,
      transcript: '',
      sttMs: 0,
      robotName,
      speechEngine,
      speechModel,
      speechLanguage,
      speechPython,
      ...parakeetFields,
      error: `WAV file not found: ${wav}`,
    };
  }

  try {
    const transcribe = options.transcribe ?? (async (file: string) => {
      const { transcribeWav } = await import('../sensory/speech-reaction.js');
      const previousWorker = process.env.CODEBUDDY_SPEECH_WORKER;
      if (previousWorker === undefined) process.env.CODEBUDDY_SPEECH_WORKER = 'false';
      try {
        return await transcribeWav(file);
      } finally {
        if (previousWorker === undefined) delete process.env.CODEBUDDY_SPEECH_WORKER;
        else process.env.CODEBUDDY_SPEECH_WORKER = previousWorker;
      }
    });
    const started = now();
    const transcript = (await transcribe(wav)).trim();
    const sttMs = Math.max(0, now() - started);
    let decision: CompanionListenCheck['decision'];
    if (transcript) {
      const { createResponseDecider } = await import('../sensory/respond-decider.js');
      decision = await createResponseDecider({ robotName, recentContext: async () => [] }).decide(transcript);
    }
    return {
      ok: Boolean(transcript),
      audioDir,
      wav,
      transcript,
      sttMs,
      ...(decision ? { decision } : {}),
      robotName,
      speechEngine,
      speechModel,
      speechLanguage,
      speechPython,
      ...parakeetFields,
      ...(transcript ? {} : { error: 'STT returned an empty transcript' }),
    };
  } catch (err) {
    return {
      ok: false,
      audioDir,
      wav,
      transcript: '',
      sttMs: 0,
      robotName,
      speechEngine,
      speechModel,
      speechLanguage,
      speechPython,
      ...parakeetFields,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function formatCompanionListenCheck(check: CompanionListenCheck): string {
  const sttLabel = check.speechEngine === 'parakeet'
    ? 'Parakeet/sherpa-onnx'
    : check.speechEngine === 'sherpa-rs'
      ? 'sherpa-rs (in-process Rust)'
      : check.speechEngine === 'auto'
        ? `auto (${check.parakeetModelDir ? 'Parakeet preferred' : 'faster-whisper'})`
        : `faster-whisper ${check.speechModel}`;
  const lines = [
    `${check.robotName} Listen Check`,
    '='.repeat(50),
    `Status: ${check.ok ? 'heard' : 'needs attention'}`,
    `Audio dir: ${homeRelative(check.audioDir)}`,
    `WAV: ${check.wav ? homeRelative(check.wav) : 'not found'}`,
    `STT: ${sttLabel} (${check.speechLanguage}) via ${homeRelative(check.speechPython)}`,
    `Latency: ${check.sttMs}ms`,
    `Transcript: ${check.transcript || '(empty)'}`,
  ];

  if (check.parakeetModelDir) {
    lines.splice(6, 0, `Parakeet model: ${homeRelative(check.parakeetModelDir)}`);
  }

  if (check.decision) {
    lines.push(`Response gate: ${check.decision.respond ? 'respond' : 'silent'} (${check.decision.reason})`);
  } else {
    lines.push('Response gate: not evaluated');
  }

  if (check.error) {
    lines.push('', `Issue: ${check.error}`);
  }

  return lines.join('\n');
}

function resolveVoiceResponseMode(): CompanionVoiceResponseMode {
  if (isTruthyEnv('CODEBUDDY_SENSORY_ALWAYS_RESPOND')) return 'always';
  if (isTruthyEnv('CODEBUDDY_SENSORY_CHIME_IN')) return 'chime-in';
  return 'addressed+greeting';
}

function resolvePiperVoicePath(status: CompanionStatus): string {
  return resolveConfiguredPiperVoice(status)
    || '/path/to/fr_FR-siwis-medium.onnx';
}

function resolveDetectedPiperVoice(): string {
  const roots = [
    path.join(os.homedir(), 'DEV', 'ai-stack', 'voice'),
    path.join(os.homedir(), 'ai-stack', 'voice'),
    path.join(os.homedir(), '.codebuddy', 'voice'),
  ];
  const names = [
    'fr_FR-siwis-medium.onnx',
    'fr_FR-tom-medium.onnx',
  ];
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, 'voices', name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return '';
}

function resolveConfiguredPiperVoice(status: CompanionStatus): string {
  const candidate = process.env.CODEBUDDY_TTS_VOICE
    || process.env.CODEBUDDY_TTS_PIPER_MODEL
    || process.env.COWORK_PIPER_VOICE
    || process.env.CODEBUDDY_PIPER_VOICE
    || (status.tts.provider === 'piper' && status.tts.voice?.endsWith('.onnx') ? status.tts.voice : '');
  return candidate ? expandHome(candidate) : resolveDetectedPiperVoice();
}

function resolvePiperBin(): string {
  return expandHome(process.env.CODEBUDDY_PIPER_BIN || process.env.COWORK_PIPER_BIN || 'piper');
}

function looksLikePath(value: string): boolean {
  return path.isAbsolute(value) || value.includes(path.sep);
}

async function executableReady(command: string, runtime: CompanionLiveRuntime): Promise<boolean> {
  return looksLikePath(command) ? runtime.exists(command) : runtime.commandExists(command);
}

function homeRelative(value: string): string {
  if (value === os.homedir()) return '~';
  if (value.startsWith(`${os.homedir()}${path.sep}`)) {
    return `~/${path.relative(os.homedir(), value)}`;
  }
  return value;
}

function shellArg(value: string): string {
  const display = homeRelative(value);
  if (/^[A-Za-z0-9_./:=,+@%~-]+$/.test(display)) return display;
  return `'${display.replace(/'/g, "'\\''")}'`;
}

function checkPythonModule(pythonCommand: string, moduleName: string): Promise<boolean> {
  return new Promise(resolve => {
    nodeExecFile(
      pythonCommand,
      ['-c', `import ${moduleName}`],
      { timeout: 3000, windowsHide: true },
      error => resolve(!error),
    );
  });
}

function createDefaultLiveRuntime(): CompanionLiveRuntime {
  return {
    exists: existsSync,
    checkPythonModule,
    commandExists,
    execFile: (command, args, timeoutMs = 3000) => new Promise(resolve => {
      nodeExecFile(
        command,
        args,
        { timeout: timeoutMs, windowsHide: true },
        (_error, stdout) => resolve(String(stdout ?? '')),
      );
    }),
  };
}

function buildSensoryBridgeBrief(): CompanionSensoryBridgeBrief {
  const cameraEnabled = isTruthyEnv('CODEBUDDY_SENSORY_CAMERA');
  const serverToken = process.env.CODEBUDDY_SENSORY_TOKEN?.trim() || '';
  const sidecarToken = process.env.BUDDY_SENSE_TOKEN?.trim() || '';
  const serverTokenPresent = serverToken.length > 0;
  const sidecarTokenPresent = sidecarToken.length > 0;
  const tokensMatch = serverTokenPresent && sidecarTokenPresent && serverToken === sidecarToken;
  const ready = cameraEnabled && tokensMatch;

  const missing: string[] = [];
  if (!cameraEnabled) {
    missing.push('CODEBUDDY_SENSORY_CAMERA is not true');
  }
  if (!serverTokenPresent) {
    missing.push('CODEBUDDY_SENSORY_TOKEN is missing');
  }
  if (!sidecarTokenPresent) {
    missing.push('BUDDY_SENSE_TOKEN is missing');
  }
  if (serverTokenPresent && sidecarTokenPresent && !tokensMatch) {
    missing.push('CODEBUDDY_SENSORY_TOKEN and BUDDY_SENSE_TOKEN do not match');
  }

  return {
    cameraEnabled,
    serverTokenPresent,
    sidecarTokenPresent,
    tokensMatch,
    bridgeUrl: resolveSenseBridgeUrl(),
    cameraIndex: resolveSenseCameraIndex(),
    ready,
    detail: ready
      ? 'Camera reactions are token-gated and the sidecar token matches the server token.'
      : missing.join('; '),
    next: ready
      ? undefined
      : 'Set CODEBUDDY_SENSORY_CAMERA=true, CODEBUDDY_SENSORY_TOKEN=<secret>, and pass the same value as BUDDY_SENSE_TOKEN to buddy-vision.',
  };
}

async function buildVoiceAssistantBrief(
  status: CompanionStatus,
  speechEnabled: boolean,
  speakEnabled: boolean,
  runtime: CompanionLiveRuntime,
): Promise<CompanionVoiceAssistantBrief> {
  const earScriptPath = path.join(status.cwd, 'buddy-vision', 'ear.py');
  const earPython = resolveEarPython(runtime);
  const earDeviceSelection = await resolveEarDevice(runtime);
  const earDevice = earDeviceSelection.device;
  const speechPython = resolveSpeechPython(runtime);
  const piperBin = resolvePiperBin();
  const piperVoice = resolveConfiguredPiperVoice(status);
  const [
    earScriptReady,
    earCaptureReady,
    earNumpyReady,
    earWebsocketReady,
    sttReady,
    piperBinReady,
    aplayReady,
    pwPlayReady,
    ffplayReady,
  ] = await Promise.all([
    Promise.resolve(runtime.exists(earScriptPath)),
    runtime.commandExists('arecord'),
    runtime.checkPythonModule(earPython, 'numpy'),
    runtime.checkPythonModule(earPython, 'websocket'),
    runtime.checkPythonModule(speechPython, 'faster_whisper'),
    executableReady(piperBin, runtime),
    runtime.commandExists('aplay'),
    runtime.commandExists('pw-play'),
    runtime.commandExists('ffplay'),
  ]);
  const playerCommand = aplayReady ? 'aplay' : pwPlayReady ? 'pw-play' : ffplayReady ? 'ffplay' : undefined;
  const robotName = await resolveRobotName();
  const env = {
    ...process.env,
    CODEBUDDY_ROBOT_NAME: robotName,
    CODEBUDDY_TTS_VOICE: piperVoice,
  };
  const readiness = describeVoiceReadiness(env);
  const permissionMode = readiness.permissionMode?.toLowerCase();
  const safeActionMode = !readiness.act || permissionMode === 'default';
  const responseMode = resolveVoiceResponseMode();
  const ready = speechEnabled
    && speakEnabled
    && readiness.speakReady
    && safeActionMode
    && piperBinReady
    && Boolean(piperVoice)
    && runtime.exists(piperVoice)
    && earScriptReady
    && earCaptureReady
    && earNumpyReady
    && earWebsocketReady
    && sttReady
    && Boolean(playerCommand);
  const missing: string[] = [];

  if (!speechEnabled) {
    missing.push('CODEBUDDY_SENSORY_SPEECH is not true');
  }
  if (!speakEnabled) {
    missing.push('CODEBUDDY_SENSORY_SPEAK is not true');
  }
  if (!readiness.speakReady) {
    missing.push('CODEBUDDY_TTS_VOICE or CODEBUDDY_TTS_PIPER_MODEL must point to a Piper .onnx model');
  }
  if (!safeActionMode) {
    missing.push(`voice action mode is unsafe (${permissionMode}); use CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE=default`);
  }
  if (!piperBinReady) {
    missing.push(`Piper binary not found: ${piperBin}`);
  }
  if (piperVoice && !runtime.exists(piperVoice)) {
    missing.push(`Piper voice model not found: ${piperVoice}`);
  }
  if (!earScriptReady) {
    missing.push(`buddy-vision/ear.py missing under ${status.cwd}`);
  }
  if (!earCaptureReady) {
    missing.push('arecord is missing for live microphone capture');
  }
  if (!earNumpyReady) {
    missing.push(`numpy missing for ${earPython}`);
  }
  if (!earWebsocketReady) {
    missing.push(`websocket-client missing for ${earPython}`);
  }
  if (!sttReady) {
    missing.push(`faster-whisper missing for ${speechPython}`);
  }
  if (!playerCommand) {
    missing.push('no local audio player found (aplay, pw-play, or ffplay)');
  }

  const actionDetail = readiness.act
    ? `spoken commands use agent mode ${readiness.permissionMode}`
    : 'spoken commands use short voice replies';

  return {
    robotName: env.CODEBUDDY_ROBOT_NAME,
    responseMode,
    readiness,
    safeActionMode,
    piperBin,
    piperVoice,
    earScriptPath,
    earPython,
    earDevice,
    speechPython,
    ...(playerCommand ? { playerCommand } : {}),
    earDeviceAutoDetected: earDeviceSelection.autoDetected,
    ready,
    detail: ready
      ? `Voice assistant loop ready: piper=${piperBin}, voice=${piperVoice}, ear=${earPython} (${earDevice}${earDeviceSelection.autoDetected ? ', webcam mic auto-selected' : ''}), STT=${speechPython}, player=${playerCommand}; responds as "${env.CODEBUDDY_ROBOT_NAME}" in ${responseMode} mode; model=${readiness.model}; ${actionDetail}.`
      : missing.join('; '),
    next: ready
      ? undefined
      : 'Enable CODEBUDDY_SENSORY_SPEECH=true CODEBUDDY_SENSORY_SPEAK=true, set CODEBUDDY_TTS_VOICE, install arecord plus an audio player, install websocket-client/numpy for ear.py, install faster-whisper for CODEBUDDY_SPEECH_PYTHON, and keep resident voice actions in CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE=default.',
  };
}

export async function setupCompanionMode(
  options: CompanionSetupOptions = {},
): Promise<CompanionSetupResult> {
  const cwd = resolveCwd(options.cwd);
  const configureVoice = options.configureVoice !== false;
  const configureModel = options.configureModel !== false;
  const model = options.model || COMPANION_DEFAULT_MODEL;

  const identity = getIdentityManager();
  await identity.load(cwd);

  const existingSoul = identity.get('SOUL.md');
  const existingBoot = identity.get('BOOT.md');
  const shouldWriteSoul = options.forceIdentity || !existingSoul;
  const shouldWriteBoot = options.forceIdentity || !existingBoot;
  const companionIdentity = companionIdentityText();

  if (shouldWriteSoul) {
    await identity.set('SOUL.md', companionIdentity.soul);
  }
  if (shouldWriteBoot) {
    await identity.set('BOOT.md', companionIdentity.boot);
  }

  if (configureVoice) {
    const language = options.language || COMPANION_DEFAULT_LANGUAGE;
    const voiceInput = getVoiceInputManager();
    const voiceConfig = voiceInput.getConfig();
    voiceInput.setConfig({
      enabled: true,
      provider: options.sttProvider || resolveCompanionSttProvider(voiceConfig.provider),
      language,
      autoSend: true,
      hotkey: voiceConfig.hotkey || 'ctrl+shift+v',
    });

    const tts = getTTSManager();
    const ttsConfig = tts.getConfig();
    tts.updateConfig({
      enabled: true,
      provider: options.ttsProvider || ttsConfig.provider || 'edge-tts',
      voice: options.ttsVoice || ttsConfig.voice || COMPANION_DEFAULT_TTS_VOICE,
      autoSpeak: true,
    });
  }

  let modelConfigured = false;
  if (configureModel && hasCodexCredentials()) {
    getSettingsManager().setCurrentModel(model);
    modelConfigured = true;
  }

  return {
    cwd,
    wroteSoul: shouldWriteSoul,
    wroteBoot: shouldWriteBoot,
    skippedSoul: !shouldWriteSoul,
    skippedBoot: !shouldWriteBoot,
    voiceConfigured: configureVoice,
    modelConfigured,
    model: modelConfigured ? model : undefined,
    status: await getCompanionStatus({ cwd }),
  };
}

export async function getCompanionStatus(
  options: CompanionStatusOptions = {},
): Promise<CompanionStatus> {
  const cwd = resolveCwd(options.cwd);
  const identity = getIdentityManager();
  await identity.load(cwd);

  const soul = identity.get('SOUL.md');
  const boot = identity.get('BOOT.md');
  const voiceInput = getVoiceInputManager();
  const tts = getTTSManager();
  const [voiceAvailable, ttsAvailable, camera, percepts] = await Promise.all([
    voiceInput.isAvailable(),
    tts.isAvailable(),
    checkCameraAvailability(),
    getCompanionPerceptStats({ cwd }),
  ]);

  const voiceConfig = voiceInput.getConfig();
  const ttsConfig = tts.getConfig();

  return {
    cwd,
    authPath: getCodexAuthFilePath(),
    chatGptCredentialsPresent: hasCodexCredentials(),
    model: getSettingsManager().getCurrentModel(),
    identity: {
      soulLoaded: Boolean(soul),
      soulSource: soul?.source,
      soulIsCompanion: isCompanionText(soul?.content),
      bootLoaded: Boolean(boot),
      bootSource: boot?.source,
      bootIsCompanion: isCompanionText(boot?.content),
    },
    voice: {
      enabled: voiceConfig.enabled,
      available: voiceAvailable.available,
      reason: voiceAvailable.reason,
      provider: voiceConfig.provider,
      language: voiceConfig.language,
      autoSend: voiceConfig.autoSend,
    },
    wakeWord: {
      available: true,
      engine: process.env.PICOVOICE_ACCESS_KEY ? 'porcupine' : 'text-match',
      wakeWords: DEFAULT_WAKE_WORD_CONFIG.wakeWords,
      picovoiceAccessKeyPresent: Boolean(process.env.PICOVOICE_ACCESS_KEY),
    },
    tts: {
      enabled: ttsConfig.enabled,
      available: ttsAvailable.available,
      reason: ttsAvailable.reason,
      provider: ttsConfig.provider,
      voice: ttsConfig.voice,
      autoSpeak: ttsConfig.autoSpeak,
    },
    camera,
    percepts,
  };
}

export async function recordCompanionSelfState(
  options: CompanionStatusOptions = {},
): Promise<CompanionPercept> {
  const status = await getCompanionStatus(options);
  return recordCompanionPercept({
    modality: 'self',
    source: 'companion_status',
    summary: `Buddy self-state recorded: model ${status.model}, voice ${
      status.voice.enabled && status.voice.available ? 'ready' : 'not ready'
    }, camera ${status.camera.available ? 'ready' : 'not ready'}`,
    confidence: 1,
    payload: {
      model: status.model,
      chatGptCredentialsPresent: status.chatGptCredentialsPresent,
      identityReady: status.identity.soulIsCompanion && status.identity.bootIsCompanion,
      voiceReady: status.voice.enabled && status.voice.available,
      ttsReady: status.tts.enabled && status.tts.available,
      cameraReady: status.camera.available,
      wakeWordEngine: status.wakeWord.engine,
      perceptTotal: status.percepts.total,
    },
    tags: ['self', 'proprioception', 'companion'],
  }, { cwd: status.cwd });
}

async function buildVisionSidecarBrief(
  status: CompanionStatus,
  runtime: CompanionLiveRuntime,
): Promise<CompanionVisionSidecarBrief> {
  const scriptPath = path.join(status.cwd, 'buddy-vision', 'watch.py');
  const scriptReady = runtime.exists(scriptPath);
  const pythonCommand = resolveVisionPython(runtime);
  const yoloModel = resolveYoloModelPath();
  const yoloModelReady = runtime.exists(yoloModel);
  const backend = resolveVisionBackend(yoloModelReady);
  const backendModule = backend === 'yolo' ? 'ultralytics' : 'mediapipe';
  const [websocketReady, backendModuleReady] = await Promise.all([
    runtime.checkPythonModule(pythonCommand, 'websocket'),
    runtime.checkPythonModule(pythonCommand, backendModule),
  ]);
  const ready = scriptReady
    && websocketReady
    && backendModuleReady
    && (backend !== 'yolo' || yoloModelReady);

  const missing: string[] = [];
  if (!scriptReady) {
    missing.push(`buddy-vision/watch.py missing under ${status.cwd}`);
  }
  if (!websocketReady) {
    missing.push(`websocket-client missing for ${pythonCommand}`);
  }
  if (!backendModuleReady) {
    missing.push(`${backendModule} missing for ${pythonCommand}`);
  }
  if (backend === 'yolo' && !yoloModelReady) {
    missing.push(`YOLO model missing at ${yoloModel}`);
  }

  const installPackages = ['websocket-client', backendModule];
  const next = ready
    ? undefined
    : `Install with \`${shellArg(pythonCommand)} -m pip install ${installPackages.join(' ')}\` and run from a repo containing buddy-vision/watch.py.`;

  return {
    scriptPath,
    pythonCommand,
    backend,
    backendModule,
    scriptReady,
    websocketReady,
    backendModuleReady,
    yoloModel,
    yoloModelReady,
    ready,
    detail: ready
      ? `${backend} sidecar ready via ${pythonCommand}; script ${scriptPath}.`
      : missing.join('; '),
    next,
  };
}

function buildLiveCommands(
  status: CompanionStatus,
  sidecar: CompanionVisionSidecarBrief,
  bridge: CompanionSensoryBridgeBrief,
  assistant: CompanionVoiceAssistantBrief,
): CompanionLiveCommand[] {
  const voice = assistant.piperVoice || resolvePiperVoicePath(status);
  const tokenFallback = "${CODEBUDDY_SENSORY_TOKEN:-'<shared-sensory-token>'}";
  const sidecarTokenFallback = "${BUDDY_SENSE_TOKEN:-${CODEBUDDY_SENSORY_TOKEN:-'<shared-sensory-token>'}}";
  const voiceModel = process.env.CODEBUDDY_SENSORY_SPEAK_MODEL || assistant.readiness.model || 'auto';
  const speechEngine = resolveSpeechRecognitionEngine();
  const speechModel = resolveSpeechModel();
  const speechLanguage = resolveSpeechLanguage();
  const parakeetModelDir = resolveParakeetModelDir();
  const speechHotwordsFile = process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE?.trim();
  const speechHotwordsFileEnv = speechHotwordsFile
    ? `CODEBUDDY_SPEECH_HOTWORDS_FILE=${shellArg(speechHotwordsFile)} `
    : '';
  const parakeetEnv = speechEngine === 'parakeet' || speechEngine === 'auto'
    ? `CODEBUDDY_PARAKEET_MODEL_DIR=${shellArg(parakeetModelDir)} `
    : '';

  return [
    {
      label: 'Run the integrated companion server',
      command: [
        'JWT_SECRET=... \\',
        `CODEBUDDY_SENSORY_TOKEN=${tokenFallback} CODEBUDDY_SENSORY=true CODEBUDDY_SENSORY_CAMERA=true \\`,
        'CODEBUDDY_SENSORY_SPEECH=true CODEBUDDY_SENSORY_SPEAK=true \\',
        `CODEBUDDY_ROBOT_NAME=${shellArg(assistant.robotName)} CODEBUDDY_SENSORY_CHIME_IN=true \\`,
        `CODEBUDDY_SENSORY_SPEAK_MODEL=${shellArg(voiceModel)} CODEBUDDY_SENSORY_SPEAK_ACT=true CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE=default \\`,
        `${speechHotwordsFileEnv}${parakeetEnv}CODEBUDDY_SPEECH_ENGINE=${shellArg(speechEngine)} CODEBUDDY_SPEECH_PYTHON=${shellArg(assistant.speechPython)} CODEBUDDY_SPEECH_MODEL=${shellArg(speechModel)} CODEBUDDY_SPEECH_LANG=${shellArg(speechLanguage)} \\`,
        `CODEBUDDY_PIPER_BIN=${shellArg(assistant.piperBin)} \\`,
        `CODEBUDDY_TTS_VOICE=${shellArg(voice)} \\`,
        'CODEBUDDY_SENSORY_GREET=true CODEBUDDY_COMPANION_PRESENCE=true CODEBUDDY_COMPANION_IDLE=true \\',
        'CODEBUDDY_REMINDERS=true \\',
        'buddy server',
      ].join('\n'),
    },
    {
      label: 'Run the microphone sidecar',
      command: [
        `BUDDY_SENSE_BRIDGE_URL=${shellArg(bridge.bridgeUrl)} BUDDY_SENSE_TOKEN=${sidecarTokenFallback} \\`,
        `BUDDY_EAR_DEVICE=${shellArg(assistant.earDevice)} \\`,
        `${shellArg(assistant.earPython)} buddy-vision/ear.py`,
      ].join('\n'),
    },
    {
      label: 'Run the camera sidecar',
      command: [
        `BUDDY_SENSE_BRIDGE_URL=${shellArg(bridge.bridgeUrl)} BUDDY_SENSE_TOKEN=${sidecarTokenFallback} \\`,
        `BUDDY_SENSE_CAMERA_INDEX=${shellArg(bridge.cameraIndex)} \\`,
        'BUDDY_VISION_DETECTORS=person \\',
        `BUDDY_VISION_PERSON_BACKEND=${sidecar.backend} \\`,
        `BUDDY_VISION_YOLO_MODEL=${shellArg(sidecar.yoloModel)} \\`,
        `${shellArg(sidecar.pythonCommand)} buddy-vision/watch.py`,
      ].join('\n'),
    },
    {
      label: 'Check the live sensory journal',
      command: 'buddy companion percepts recent --limit 10',
    },
    {
      label: 'Ask the fleet once the server is up',
      command: 'buddy council --fleet "resume l etat du compagnon et les risques du lancement live"',
    },
  ];
}

export async function buildCompanionLiveBrief(
  options: CompanionLiveBriefOptions = {},
): Promise<CompanionLiveBrief> {
  const runtime = options.runtime || createDefaultLiveRuntime();
  const status = await getCompanionStatus(options);
  const sidecar = await buildVisionSidecarBrief(status, runtime);
  const bridge = buildSensoryBridgeBrief();
  const identityReady = status.identity.soulIsCompanion && status.identity.bootIsCompanion;
  const voiceReady = status.voice.enabled && status.voice.available;
  const ttsReady = status.tts.enabled && status.tts.available;
  const sensoryEnabled = isTruthyEnv('CODEBUDDY_SENSORY');
  const speechEnabled = isTruthyEnv('CODEBUDDY_SENSORY_SPEECH');
  const speakEnabled = isTruthyEnv('CODEBUDDY_SENSORY_SPEAK');
  const resolvedTtsVoice = resolveConfiguredPiperVoice(status);
  const ttsVoicePresent = Boolean(resolvedTtsVoice);
  const voiceAssistant = await buildVoiceAssistantBrief(status, speechEnabled, speakEnabled, runtime);
  const telegramVoiceReady = isTruthyEnv('CODEBUDDY_VOICE_TO_TELEGRAM')
    && hasEnv('CODEBUDDY_SENSORY_ALERT_TOKEN')
    && hasEnv('CODEBUDDY_SENSORY_ALERT_CHAT');
  const fleetToolReady = hasEnv('CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT');
  const yoloModel = sidecar.yoloModel;
  const yoloReady = sidecar.yoloModelReady;

  const capabilities: CompanionLiveCapability[] = [
    {
      id: 'identity',
      label: 'Companion identity',
      ready: identityReady,
      required: true,
      detail: identityReady ? 'SOUL.md and BOOT.md are companion-aware.' : 'Companion identity files are missing or stale.',
      next: identityReady ? undefined : 'Run `buddy companion setup`.',
    },
    {
      id: 'brain',
      label: 'ChatGPT brain',
      ready: status.chatGptCredentialsPresent,
      required: true,
      detail: status.chatGptCredentialsPresent ? `OAuth credentials present at ${status.authPath}.` : 'ChatGPT OAuth credentials are missing.',
      next: status.chatGptCredentialsPresent ? undefined : 'Run `buddy login`.',
    },
    {
      id: 'voice_input',
      label: 'CLI voice input surface',
      ready: voiceReady,
      required: false,
      detail: voiceReady ? `${status.voice.provider} ready in ${status.voice.language || 'auto'} mode.` : status.voice.reason || 'CLI voice input is disabled or unavailable.',
      next: voiceReady ? undefined : 'Run `buddy companion setup` and install the local STT dependency.',
    },
    {
      id: 'voice_output',
      label: 'TTS manager surface',
      ready: ttsReady && ttsVoicePresent,
      required: false,
      detail: ttsReady && ttsVoicePresent
        ? `${status.tts.provider} ready with ${resolvedTtsVoice}.`
        : status.tts.reason || 'TTS manager is disabled, unavailable, or has no voice configured.',
      next: ttsReady && ttsVoicePresent ? undefined : 'Set CODEBUDDY_TTS_VOICE or configure TTS in companion setup.',
    },
    {
      id: 'camera',
      label: 'Camera bridge',
      ready: status.camera.available,
      required: true,
      detail: status.camera.available ? `${status.camera.platform} camera path available.` : status.camera.reason || 'Camera bridge unavailable.',
      next: status.camera.available ? undefined : 'Run `buddy companion camera status` and fix ffmpeg/camera permissions.',
    },
    {
      id: 'sensory_server',
      label: 'Sensory server loop',
      ready: sensoryEnabled && speechEnabled && speakEnabled,
      required: true,
      detail: sensoryEnabled && speechEnabled && speakEnabled
        ? 'CODEBUDDY_SENSORY, SPEECH, and SPEAK are enabled.'
        : 'The server loop flags are not all enabled.',
      next: sensoryEnabled && speechEnabled && speakEnabled ? undefined : 'Start `buddy server` with CODEBUDDY_SENSORY=true CODEBUDDY_SENSORY_SPEECH=true CODEBUDDY_SENSORY_SPEAK=true.',
    },
    {
      id: 'voice_assistant',
      label: 'Voice assistant behavior',
      ready: voiceAssistant.ready,
      required: true,
      detail: voiceAssistant.detail,
      next: voiceAssistant.next,
    },
    {
      id: 'sensory_camera_auth',
      label: 'Sensory camera auth',
      ready: bridge.ready,
      required: true,
      detail: bridge.detail,
      next: bridge.next,
    },
    {
      id: 'vision_sidecar',
      label: 'Vision sidecar process',
      ready: sidecar.ready,
      required: true,
      detail: sidecar.detail,
      next: sidecar.next,
    },
    {
      id: 'greeting_presence_idle',
      label: 'Greeting, presence, idle work',
      ready: isTruthyEnv('CODEBUDDY_SENSORY_GREET')
        && isTruthyEnv('CODEBUDDY_COMPANION_PRESENCE')
        && isTruthyEnv('CODEBUDDY_COMPANION_IDLE'),
      required: false,
      detail: [
        `greet=${isTruthyEnv('CODEBUDDY_SENSORY_GREET') ? 'on' : 'off'}`,
        `presence=${isTruthyEnv('CODEBUDDY_COMPANION_PRESENCE') ? 'on' : 'off'}`,
        `idle=${isTruthyEnv('CODEBUDDY_COMPANION_IDLE') ? 'on' : 'off'}`,
      ].join(', '),
      next: 'Enable these only for a deliberate live companion session.',
    },
    {
      id: 'reminders',
      label: 'Reminder runner',
      ready: isTruthyEnv('CODEBUDDY_REMINDERS'),
      required: false,
      detail: isTruthyEnv('CODEBUDDY_REMINDERS') ? 'Medication/reminder loop enabled.' : 'Reminder loop disabled.',
      next: 'Set CODEBUDDY_REMINDERS=true when reminders should run.',
    },
    {
      id: 'telegram_voice',
      label: 'Remote voice alerts',
      ready: telegramVoiceReady,
      required: false,
      detail: telegramVoiceReady ? 'Telegram voice notes can be sent.' : 'Telegram voice alerts are not fully configured.',
      next: 'Set CODEBUDDY_VOICE_TO_TELEGRAM=true plus CODEBUDDY_SENSORY_ALERT_TOKEN and CODEBUDDY_SENSORY_ALERT_CHAT.',
    },
    {
      id: 'vision_yolo',
      label: 'YOLO vision backend',
      ready: yoloReady,
      required: false,
      detail: yoloReady ? `YOLO model found at ${yoloModel}.` : `YOLO model not found at ${yoloModel}; MediaPipe remains usable.`,
      next: yoloReady ? undefined : 'Use BUDDY_VISION_PERSON_BACKEND=mediapipe or install the YOLO model.',
    },
    {
      id: 'fleet_tools',
      label: 'Fleet read-only tools',
      ready: fleetToolReady,
      required: false,
      detail: fleetToolReady ? 'Peer tool workspace root is configured.' : 'Peer read-only tools are fail-closed until a workspace root is set.',
      next: 'Set CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT before exposing peer.tool.invoke.',
    },
    {
      id: 'memory',
      label: 'Percept memory',
      ready: status.percepts.exists && status.percepts.total > 0,
      required: false,
      detail: `${status.percepts.total} percept(s) in ${status.percepts.storePath}.`,
      next: status.percepts.total > 0 ? undefined : 'Run `buddy companion self` or capture camera/voice percepts.',
    },
  ];

  const required = capabilities.filter(capability => capability.required);
  const requiredReady = required.filter(capability => capability.ready).length;
  const requiredTotal = required.length;
  const readinessScore = requiredTotal > 0 ? Math.round((requiredReady / requiredTotal) * 100) : 100;

  let perceptId: string | undefined;
  if (options.record !== false) {
    const percept = await recordCompanionPercept({
      modality: 'self',
      source: 'companion_live_brief',
      summary: `Companion live brief: ${readinessScore}% ready (${requiredReady}/${requiredTotal} required checks).`,
      confidence: 1,
      payload: {
        readinessScore,
        requiredReady,
        requiredTotal,
        ready: requiredReady === requiredTotal,
        missingRequired: required.filter(capability => !capability.ready).map(capability => capability.id),
        optionalReady: capabilities.filter(capability => !capability.required && capability.ready).map(capability => capability.id),
      },
      tags: ['self', 'companion', 'live', 'preflight'],
    }, { cwd: status.cwd });
    perceptId = percept.id;
  }

  return {
    cwd: status.cwd,
    timestamp: new Date().toISOString(),
    assistantName: voiceAssistant.robotName,
    status,
    requiredReady,
    requiredTotal,
    readinessScore,
    ready: requiredReady === requiredTotal,
    capabilities,
    commands: buildLiveCommands(status, sidecar, bridge, voiceAssistant),
    perceptId,
  };
}

function mark(ok: boolean): string {
  return ok ? '[ok]' : '[todo]';
}

export function formatCompanionStatus(status: CompanionStatus): string {
  const lines = [
    'Buddy Companion Status',
    '='.repeat(50),
    '',
    `Workspace: ${status.cwd}`,
    `Brain: ${mark(status.chatGptCredentialsPresent)} ChatGPT OAuth credentials ${
      status.chatGptCredentialsPresent ? 'present' : 'missing'
    }`,
    `Auth file: ${status.authPath}`,
    `Model: ${status.model}`,
    '',
    `Identity: ${mark(status.identity.soulIsCompanion)} SOUL.md ${
      status.identity.soulLoaded ? `loaded from ${status.identity.soulSource}` : 'not loaded'
    }`,
    `Boot: ${mark(status.identity.bootIsCompanion)} BOOT.md ${
      status.identity.bootLoaded ? `loaded from ${status.identity.bootSource}` : 'not loaded'
    }`,
    '',
    `Voice input: ${mark(status.voice.enabled && status.voice.available)} ${
      status.voice.enabled ? 'enabled' : 'disabled'
    } / ${status.voice.provider} / ${status.voice.language || 'auto'} / auto-send ${
      status.voice.autoSend ? 'on' : 'off'
    }`,
    `Wake word: ${mark(status.wakeWord.available)} ${status.wakeWord.engine} / ${
      status.wakeWord.wakeWords.join(', ')
    }`,
    `TTS: ${mark(status.tts.enabled && status.tts.available)} ${
      status.tts.enabled ? 'enabled' : 'disabled'
    } / ${status.tts.provider} / ${status.tts.voice || 'auto'} / auto-speak ${
      status.tts.autoSpeak ? 'on' : 'off'
    }`,
    `Camera: ${mark(status.camera.available)} ${
      status.camera.ffmpegAvailable ? 'ffmpeg available' : 'ffmpeg missing'
    } / ${status.camera.platform}`,
    `Percepts: ${mark(status.percepts.exists)} ${status.percepts.total} recorded / ${status.percepts.storePath}`,
  ];

  const next: string[] = [];
  if (!status.chatGptCredentialsPresent) {
    next.push('Run `buddy login` to connect the ChatGPT subscription brain.');
  }
  if (!status.identity.soulIsCompanion || !status.identity.bootIsCompanion) {
    next.push('Run `buddy companion setup` to install companion identity files.');
  }
  if (!status.voice.available && status.voice.reason) {
    next.push(`Voice input setup: ${status.voice.reason}`);
  }
  if (!status.tts.available && status.tts.reason) {
    next.push(`TTS setup: ${status.tts.reason}`);
  }
  if (!status.camera.available && status.camera.reason) {
    next.push(`Camera setup: ${status.camera.reason}`);
  }

  if (next.length > 0) {
    lines.push('', 'Next steps:', ...next.map(item => `- ${item}`));
  }

  return lines.join('\n');
}

export function formatCompanionLiveBrief(brief: CompanionLiveBrief): string {
  const requiredMissing = brief.capabilities.filter(capability => capability.required && !capability.ready);
  const optionalTodos = brief.capabilities.filter(capability => !capability.required && !capability.ready);
  const lines = [
    `${brief.assistantName || 'Buddy'} Companion Live Brief`,
    '='.repeat(50),
    '',
    `Workspace: ${brief.cwd}`,
    `Timestamp: ${brief.timestamp}`,
    `Required readiness: ${brief.readinessScore}% (${brief.requiredReady}/${brief.requiredTotal})`,
    `Live session: ${brief.ready ? 'ready to try' : 'not ready yet'}`,
    brief.perceptId ? `Percept recorded: ${brief.perceptId}` : 'Percept recording: skipped',
    '',
    'Required checks:',
    ...brief.capabilities
      .filter(capability => capability.required)
      .map(capability => `${mark(capability.ready)} ${capability.label}: ${capability.detail}`),
  ];

  if (requiredMissing.length > 0) {
    lines.push(
      '',
      'Fix before a real evening:',
      ...requiredMissing.map(capability => `- ${capability.next || capability.detail}`),
    );
  }

  lines.push(
    '',
    'Optional live layers:',
    ...brief.capabilities
      .filter(capability => !capability.required)
      .map(capability => `${mark(capability.ready)} ${capability.label}: ${capability.detail}`),
  );

  if (optionalTodos.length > 0) {
    lines.push(
      '',
      'Optional next steps:',
      ...optionalTodos
        .map(capability => capability.next)
        .filter((item): item is string => Boolean(item))
        .map(item => `- ${item}`),
    );
  }

  lines.push('', 'Launch commands:');
  for (const command of brief.commands) {
    lines.push('', `${command.label}:`, command.command);
  }

  return lines.join('\n');
}
